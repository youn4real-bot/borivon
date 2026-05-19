import { NextRequest, NextResponse } from "next/server";
import { PassThrough } from "stream";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import {
  getDriveClient,
  getOrCreateFolder,
  ROOT_FOLDER_ID,
  makeDrivePublic,
} from "@/lib/passport-pdf";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/portal/admin/replace-passport-pdf
 *
 * Supreme-admin-ONLY. Replaces ONLY the passport SCAN PDF on the candidate's
 * existing passport `documents` row — a clearer re-scan — WITHOUT:
 *   • running any OCR / passport scanning,
 *   • touching `candidate_profiles` (no field changes, passport_status kept),
 *   • changing the doc's review status / feedback (green stays green),
 *   • firing any admin/candidate notification.
 *
 * Use case: passport DATA is already correct/approved but the uploaded scan
 * is unreadable, so the admin just swaps in a clean PDF. The old Drive file
 * is ARCHIVED (LAW #33), never deleted.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Supreme admin only (the three-dots "PDF ersetzen" is supreme-only).
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const fileRaw = form.get("file");
  const userId  = String(form.get("userId") ?? "");
  const docId   = String(form.get("docId") ?? "");

  if (!UUID_RE.test(userId) || !UUID_RE.test(docId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  // Runtime-agnostic: in Next's Node runtime `form.get("file")` is an undici
  // Blob whose `instanceof File` is unreliable. Treat anything with
  // arrayBuffer() as the file (same approach as /api/portal/upload).
  if (!fileRaw || typeof fileRaw === "string" || typeof (fileRaw as Blob).arrayBuffer !== "function") {
    return NextResponse.json({ error: "Datei erforderlich." }, { status: 400 });
  }
  const file = fileRaw as Blob & { name?: string };
  const fname = (file.name ?? "").toLowerCase();
  const isPdf = file.type === "application/pdf" || fname.endsWith(".pdf");
  if (!isPdf) return NextResponse.json({ error: "Nur PDF." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Max. 10 MB." }, { status: 400 });

  const db = getServiceSupabase();

  // The target row must be THIS candidate's passport scan doc.
  const { data: docRow } = await db
    .from("documents")
    .select("id, user_id, file_name, file_type, drive_file_id")
    .eq("id", docId)
    .maybeSingle();
  if (!docRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = docRow as {
    id: string; user_id: string; file_name: string;
    file_type: string; drive_file_id: string | null;
  };
  if (d.user_id !== userId) {
    return NextResponse.json({ error: "Mismatch" }, { status: 403 });
  }
  // Ownership (docId belongs to userId) + supreme-admin gate is sufficient.
  // No file_type/"pass" string guard — legacy/aliased passport rows don't
  // always contain "pass" and that brittle check silently 400'd the replace.

  const buffer = Buffer.from(await file.arrayBuffer());
  // Magic-bytes check — a non-PDF renamed ".pdf" would be swapped onto the
  // passport row and (since passports always render via the native PDF
  // frame) permanently break the preview while the real scan is archived.
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "Keine gültige PDF-Datei." }, { status: 400 });
  }

  // ── Drive: new file in the candidate folder, archive the old one ──────────
  let newDriveId: string | null = null;
  try {
    const drive  = getDriveClient();
    const rootId = ROOT_FOLDER_ID();

    const { data: profile } = await db
      .from("candidate_profiles")
      .select("first_name, last_name")
      .eq("user_id", userId)
      .maybeSingle();
    const p = profile as { first_name?: string | null; last_name?: string | null } | null;
    const folderName =
      [p?.first_name?.trim(), p?.last_name?.trim()].filter(Boolean).join(" ") || userId;

    const candidateFolderId = await getOrCreateFolder(drive, folderName, rootId);

    // Keep the existing structured filename so the naming convention holds.
    const name = d.file_name || "reisepass.pdf";
    const stream = new PassThrough();
    stream.end(buffer);
    const created = await drive.files.create({
      requestBody: { name, parents: [candidateFolderId] },
      media:       { mimeType: "application/pdf", body: stream },
      fields:      "id",
      supportsAllDrives: true,
    });
    newDriveId = created.data.id ?? null;
    if (!newDriveId) throw new Error("Drive create returned no id");
    await makeDrivePublic(drive, newDriveId);

    // LAW #33: archive the OLD scan — never delete.
    if (d.drive_file_id) {
      try {
        const archiveId = await getOrCreateFolder(drive, "archive", candidateFolderId);
        await drive.files.update({
          fileId:        d.drive_file_id,
          addParents:    archiveId,
          removeParents: candidateFolderId,
          supportsAllDrives: true,
          fields: "id",
        });
      } catch (archErr) {
        console.warn("[replace-passport-pdf] archive old file failed (non-fatal):", archErr);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[replace-passport-pdf] Drive error:", msg);
    return NextResponse.json({ error: `Upload failed: ${msg}` }, { status: 500 });
  }

  // ── Swap the file IN PLACE — keep status/feedback/passport data intact ────
  // rotation reset to 0: the new scan starts un-rotated; a stale rotation
  // from the old file must not be baked into the fresh one.
  const { error: updErr } = await db
    .from("documents")
    .update({ drive_file_id: newDriveId, rotation: 0, uploaded_at: new Date().toISOString() })
    .eq("id", docId);
  if (updErr) {
    console.error("[replace-passport-pdf] DB update failed:", updErr);
    return NextResponse.json({ error: "Erreur d'enregistrement." }, { status: 500 });
  }

  // Refresh the Storage cache backup so the file proxy + fallback serve the
  // clear PDF (best-effort, non-fatal).
  try {
    await db.storage.from("sign-documents").upload(
      `doc-cache/${newDriveId}`,
      buffer,
      { contentType: "application/pdf", upsert: true },
    );
  } catch (cacheErr) {
    console.warn("[replace-passport-pdf] Storage cache backup failed (non-fatal):", cacheErr);
  }

  return NextResponse.json({ success: true, driveFileId: newDriveId });
}
