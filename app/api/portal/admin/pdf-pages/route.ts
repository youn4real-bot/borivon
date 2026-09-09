import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { PDFDocument, degrees } from "pdf-lib";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { r2GetObject, r2Put, candidateKey } from "@/lib/r2";
import { UUID_RE } from "@/lib/uuid";
import { isPassportFileType } from "@/lib/passportFile";
import { archivedCopyOf } from "@/lib/documentArchive";
import { scheduleCandidateMirror } from "@/lib/scheduleMirror";
import { validatePageOrder, isUnchanged } from "@/lib/pdfPageOrder";

/**
 * PDF PAGE ORGANISER — reorder / rotate / drop pages of an uploaded document.
 *
 * Scans arrive shuffled, sideways, or with a blank sheet in the middle. The admin
 * fixes the arrangement in the browser and saves; the rewritten file becomes THE
 * document everywhere — the portal, the agency's Drive folder, the partner API —
 * because it replaces the bytes on the same row.
 *
 * THREE THINGS THIS MUST NOT DO:
 *
 * 1. LAW #39 — never touch a passport. pdf-lib's load+save silently drops content
 *    streams on scanner-produced passport PDFs: the photo survives, the MRZ and
 *    printed data vanish, and the file size barely moves, so the damage is
 *    invisible until an embassy rejects it. Passports are refused outright here;
 *    rotation for them stays client-side/CSS as it already is.
 * 2. LAW #33 — never destroy the previous version. The outgoing pointer is cloned
 *    onto an archived sibling row BEFORE the swap, and we abort if that fails.
 * 3. Never silently lose a page. The arrangement is validated against the real
 *    page count first (lib/pdfPageOrder): duplicates, out-of-range indices and
 *    "delete everything" are rejected before a single byte is written.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({})) as { docId?: string; order?: unknown };
  const docId = typeof body.docId === "string" ? body.docId.trim() : "";
  if (!UUID_RE.test(docId)) return NextResponse.json({ error: "Invalid docId" }, { status: 400 });

  const db = getServiceSupabase();
  const { data: row, error: rowErr } = await db
    .from("documents")
    .select("id, user_id, file_name, file_type, status, feedback, r2_key, drive_file_id, file_sha256, rotation, uploaded_at")
    .eq("id", docId)
    .maybeSingle();
  if (rowErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = row as {
    id: string; user_id: string; file_name: string | null; file_type: string | null;
    status: string | null; feedback: string | null; r2_key: string | null;
    drive_file_id: string | null; file_sha256: string | null; rotation: number | null; uploaded_at: string | null;
  };

  // LAW #25 — per-candidate scope.
  if (!(await canActOnCandidate(auth.role, auth.email, doc.user_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // LAW #39 — passports are never rewritten. Not a soft warning: a rewritten
  // passport looks fine and is unusable.
  if (isPassportFileType(doc.file_type)) {
    return NextResponse.json(
      { error: "Passports cannot be re-arranged — rewriting the file destroys the machine-readable data." },
      { status: 400 },
    );
  }

  if (!doc.r2_key) return NextResponse.json({ error: "Document has no stored file" }, { status: 400 });
  const obj = await r2GetObject(doc.r2_key);
  if (!obj) return NextResponse.json({ error: "Stored file is unreadable" }, { status: 404 });
  const srcBytes = obj.body; // r2GetObject already resolves to a Buffer

  let src: PDFDocument;
  try {
    src = await PDFDocument.load(srcBytes);
  } catch {
    return NextResponse.json({ error: "Not a readable PDF" }, { status: 400 });
  }
  const pageCount = src.getPageCount();

  const plan = validatePageOrder(body.order, pageCount);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });
  if (isUnchanged(plan.pages, pageCount)) {
    return NextResponse.json({ ok: true, unchanged: true, pageCount });
  }

  // Build a FRESH document and copy pages into it, rather than mutating the
  // source: copyPages carries each page's own resources, so the result can't
  // inherit a half-removed object graph.
  let outBytes: Uint8Array;
  try {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, plan.pages.map(p => p.from));
    copied.forEach((page, i) => {
      const extra = plan.pages[i].rotate;
      if (extra) {
        const current = page.getRotation().angle ?? 0;
        page.setRotation(degrees((current + extra) % 360));
      }
      out.addPage(page);
    });
    outBytes = await out.save();
  } catch (e) {
    console.error("[pdf-pages] rebuild failed:", e);
    return NextResponse.json({ error: "Could not rebuild the PDF" }, { status: 500 });
  }
  if (!outBytes?.length) return NextResponse.json({ error: "Rebuild produced an empty file" }, { status: 500 });

  const buffer = Buffer.from(outBytes);
  const key = candidateKey(doc.user_id, `${Date.now()}_${doc.file_name || "dokument.pdf"}`);
  try {
    await r2Put(key, buffer, "application/pdf");
  } catch (e) {
    console.error("[pdf-pages] R2 put failed:", e);
    return NextResponse.json({ error: "Could not store the rebuilt file" }, { status: 500 });
  }

  // LAW #33 — preserve the outgoing bytes BEFORE the row stops pointing at them.
  // If this fails we stop: losing the original is worse than not reordering.
  const archived = archivedCopyOf(doc);
  if (archived) {
    const { error: archErr } = await db.from("documents").insert(archived);
    if (archErr) {
      console.error("[pdf-pages] archive insert failed — aborting:", archErr.message);
      return NextResponse.json({ error: "Could not archive the previous version" }, { status: 500 });
    }
  }

  // Swap the bytes onto the SAME row so status, feedback and every reference to
  // this document id survive. New sha so the Drive mirror sees a real change.
  const newSha = createHash("sha256").update(buffer).digest("hex");
  const baseUpd: Record<string, unknown> = { r2_key: key, uploaded_at: new Date().toISOString() };
  let { error: updErr } = await db.from("documents").update({ ...baseUpd, file_sha256: newSha }).eq("id", docId);
  if (updErr && /file_sha256|column .* does not exist|schema cache/i.test(updErr.message ?? "")) {
    ({ error: updErr } = await db.from("documents").update(baseUpd).eq("id", docId));
  }
  if (updErr) {
    console.error("[pdf-pages] DB update failed:", updErr.message);
    return NextResponse.json({ error: "Could not save the new arrangement" }, { status: 500 });
  }

  // Push the corrected file to the agency's Drive folder (idempotent, off the
  // critical path — a Drive outage must not fail the save).
  scheduleCandidateMirror(doc.user_id);

  return NextResponse.json({
    ok: true,
    pageCount: plan.pages.length,
    removed: plan.removed.length,
    was: pageCount,
  });
}
