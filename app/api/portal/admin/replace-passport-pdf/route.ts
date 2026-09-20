import { NextRequest, NextResponse } from "next/server";
import { PassThrough } from "stream";
import { createHash } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import {
  getDriveClient,
  getOrCreateFolder,
  ROOT_FOLDER_ID,
  makeDrivePublic,
} from "@/lib/passport-pdf";
import { r2Configured, r2Put, candidateKey } from "@/lib/r2";
import { scheduleCandidateMirror } from "@/lib/scheduleMirror";
import { archivedCopyOf } from "@/lib/documentArchive";
import { detectDocKind, mimeForKind } from "@/lib/docBytes";
import { isHeicUpload, HEIC_CODE, HEIC_MESSAGE } from "@/lib/heic";
import {
  PASSPORT_REPLACE_MAX_BYTES,
  isPassportReplaceKind,
  passportReplaceFileName,
  PASSPORT_REPLACE_REFUSAL_TEXT,
  type PassportReplaceRefusal,
} from "@/lib/passportReplace";

/**
 * A refusal the admin can act on, in all three portal languages (LAW #19).
 *
 * The `code` is what the panel translates; `error` is the English fallback for
 * everything that shows the raw body — a curl while debugging, a log line, an
 * older client. Before this, three of these sentences existed in German only
 * and one in French only, on a screen a French-speaking sub-admin reads.
 */
function refuse(code: PassportReplaceRefusal, status: number) {
  return NextResponse.json({ error: PASSPORT_REPLACE_REFUSAL_TEXT[code].en, code }, { status });
}

/**
 * POST /api/portal/admin/replace-passport-pdf
 *
 * Supreme-admin-ONLY. Replaces ONLY the passport SCAN on the candidate's
 * existing passport `documents` row — a clearer re-scan, or a photograph of
 * the page — WITHOUT:
 *   • running any OCR / passport scanning,
 *   • touching `candidate_profiles` (no field changes, passport_status kept),
 *   • changing the doc's review status / feedback (green stays green),
 *   • firing any admin/candidate notification.
 *
 * Use case: passport DATA is already correct/approved but the uploaded scan
 * is unreadable, so the admin just swaps in a clean copy. The old Drive file
 * is ARCHIVED (LAW #33), never deleted.
 *
 * ACCEPTS A PHOTOGRAPH, exactly like /api/portal/upload's passport box. It did
 * not, and that was only half-visible: a candidate could photograph her
 * passport from her phone, and then the one role that exists to fix a bad
 * document could not swap it for a better one. The bytes are stored verbatim —
 * no decode, no re-encode, no pdf-lib anywhere in this file (LAW #39), which is
 * why widening the format costs nothing here.
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
    return refuse("file_missing", 400);
  }
  const file = fileRaw as Blob & { name?: string };
  // HEIC gets its own answer and it comes first, for the same reason
  // /api/portal/upload gives it one: an iPhone picked through Files hands over
  // raw HEIC, and "not a PDF or a photo" is a false sentence about a photo. The
  // code lets the panel show the two-tap way out (re-pick from Photos) in her
  // language. lib/heic.ts explains why we refuse rather than transcode.
  if (isHeicUpload(file.type, file.name)) {
    return NextResponse.json({ error: HEIC_MESSAGE, code: HEIC_CODE }, { status: 415 });
  }
  // Size BEFORE buffering: the ceiling is what keeps a 25 MB read bounded.
  if (file.size > PASSPORT_REPLACE_MAX_BYTES) return refuse("too_large", 413);

  const db = getServiceSupabase();

  // The target row must be THIS candidate's passport scan doc.
  const { data: docRow } = await db
    .from("documents")
    // r2_key / file_sha256 / status are read so the OUTGOING scan can be
    // preserved on an archived row before this one is overwritten (LAW #33).
    .select("id, user_id, file_name, file_type, drive_file_id, r2_key, file_sha256, status, feedback, rotation, uploaded_at, file_path")
    .eq("id", docId)
    .maybeSingle();
  if (!docRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const d = docRow as {
    id: string; user_id: string; file_name: string;
    file_type: string; drive_file_id: string | null;
    r2_key: string | null; file_sha256: string | null;
    status: string | null; feedback: string | null;
    rotation: number | null; uploaded_at: string | null;
    file_path: string | null;
  };
  if (d.user_id !== userId) {
    return NextResponse.json({ error: "Mismatch" }, { status: 403 });
  }
  // Ownership (docId belongs to userId) + supreme-admin gate is sufficient.
  // No file_type/"pass" string guard — legacy/aliased passport rows don't
  // always contain "pass" and that brittle check silently 400'd the replace.

  const buffer = Buffer.from(await file.arrayBuffer());
  // HEIC again, on the BYTES. The check above reads the declared type and the
  // file name, and a pick out of the Files app can supply neither — it arrives
  // as application/octet-stream named "image". Without this the same photo
  // falls through to the generic "neither a PDF nor a photo" below, which does
  // not tell anyone to re-pick it from Photos.
  if (isHeicUpload(null, null, buffer.subarray(0, 64))) {
    return NextResponse.json({ error: HEIC_MESSAGE, code: HEIC_CODE }, { status: 415 });
  }
  // The BYTES decide, not `file.type` and not the extension. Both are
  // browser-supplied and routinely wrong or absent; these twelve bytes are the
  // only thing that cannot be. Anything unrecognised is refused outright: it
  // would be swapped onto the passport row and break the preview permanently
  // while the real scan sat archived behind it.
  const kind = detectDocKind(buffer);
  if (!isPassportReplaceKind(kind)) return refuse("format", 415);
  // The row is renamed to match what actually arrived. AdminDocPreviewModal
  // picks its renderer from this extension and expectedBodyFor() refuses a
  // body that disagrees with it, so a JPEG left on a ".pdf" name would open as
  // an error on a document the admin had just been told was replaced.
  const newName = passportReplaceFileName(d.file_name, kind);
  const newMime = mimeForKind(kind);

  // ── Drive: new file in the candidate folder, archive the old one ──────────
  let newDriveId: string | null = null;
  try {
    const drive  = await getDriveClient();
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

    // Keep the existing structured filename so the naming convention holds —
    // with the extension of the bytes that actually arrived.
    const stream = new PassThrough();
    stream.end(buffer);
    const created = await drive.files.create({
      requestBody: { name: newName, parents: [candidateFolderId] },
      // The real type, not "application/pdf". Drive believes what it is told:
      // a JPEG declared as a PDF is a file the agency cannot open and a
      // thumbnail that never renders, in the folder we share with them.
      media:       { mimeType: newMime, body: stream },
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
    // Non-fatal: Google Drive is legacy. R2 (below) is the store of record, so a
    // suspended/erroring Google account must NOT block the passport replace.
    console.error("[replace-passport-pdf] Drive (legacy) error — ignored, R2 is primary:", err instanceof Error ? err.message : err);
  }

  // ── R2 dual-write (best-effort). On a REPLACE we set r2_key to the NEW key
  //    (or null if R2 fails) — never leave the old, now-stale R2 copy linked,
  //    or the serve route would show the previous scan. ──
  let r2Key: string | null = null;
  if (r2Configured()) {
    try {
      const key = candidateKey(userId, `${Date.now()}_${newName}`);
      // The stored content type is what lib/driveMirror hands the agency's copy
      // (`obj.contentType || "application/pdf"`), so a photo written as a PDF
      // would arrive there unopenable. The file proxy sniffs the bytes and
      // would have survived it; the mirror does not.
      await r2Put(key, buffer, newMime);
      r2Key = key;
    } catch { r2Key = null; }
  }

  // ── LAW #33: preserve the OUTGOING scan before its pointer is overwritten ──
  //
  // The swap below is in-place by design (LAW #37 — the approved status,
  // feedback and OCR-derived passport data must survive an admin override), but
  // that meant `r2_key` was reassigned to the new object and the previous scan's
  // key was gone. The bytes stayed in the bucket, unreferenced and unreachable
  // from the portal — deleted in every sense the law cares about, and the only
  // code that ever archived anything here is the Drive block above, which is
  // inert without GOOGLE_DRIVE_FOLDER_ID.
  //
  // So: clone the old pointer onto an archived sibling row first. It is hidden
  // from every live list (superseded_at) but still opens through the normal
  // preview/download machinery, so a bad replace is recoverable.
  //
  // Done BEFORE the update on purpose. If the clone fails we stop and change
  // nothing, rather than proceeding and losing the old scan; a retry is cheap.
  const archived = archivedCopyOf(d);
  if (archived) {
    const { error: archErr } = await db.from("documents").insert(archived);
    if (archErr) {
      console.error("[replace-passport-pdf] could not archive the old scan — aborting:", archErr);
      return refuse("archive_failed", 500);
    }
  }

  // ── Swap the file IN PLACE — keep status/feedback/passport data intact ────
  // rotation reset to 0: the new scan starts un-rotated; a stale rotation
  // from the old file must not be baked into the fresh one.
  // The sha MUST be recomputed: the agency Drive mirror skips any doc whose
  // file_sha256 still matches its mirrored copy, so leaving the old hash here
  // meant a replaced passport was never re-copied — the agency kept seeing the
  // OLD scan forever. Same reason `rotation` resets: the row now describes new bytes.
  //
  // `file_name` moves with the bytes. A replace may change the FORMAT now (a
  // photograph swapped in for a scan, or the other way round), and the row's
  // name is what the preview picks its renderer from — leaving ".pdf" on a
  // JPEG produces a passport that will not open, after a replace the panel
  // reported as successful. The stem is untouched, so LAW #35 naming holds.
  const newSha = createHash("sha256").update(buffer).digest("hex");
  const baseUpd = { drive_file_id: newDriveId, r2_key: r2Key, rotation: 0, file_name: newName, uploaded_at: new Date().toISOString() };
  let { error: updErr } = await db.from("documents").update({ ...baseUpd, file_sha256: newSha }).eq("id", docId);
  if (updErr && /file_sha256|column .* does not exist|schema cache/i.test((updErr as { message?: string })?.message ?? "")) {
    // Schema-tolerant (older deployments without the sha column): the swap
    // itself must never fail just because the mirror optimisation can't record.
    ({ error: updErr } = await db.from("documents").update(baseUpd).eq("id", docId));
  }
  if (updErr) {
    console.error("[replace-passport-pdf] DB update failed:", updErr);
    return refuse("save_failed", 500);
  }

  // Refresh the Storage cache backup (LAW #39 fallback, keyed by driveFileId) —
  // legacy Drive path only. R2 serves byte-identical originals, so no fallback
  // is needed there. Best-effort, non-fatal.
  if (newDriveId) {
    try {
      await db.storage.from("sign-documents").upload(
        `doc-cache/${newDriveId}`,
        buffer,
        // The recovery copy the LAW #39 audit falls back to. It must be stored
        // as what it is, or the one path that exists to rescue a corrupted
        // passport hands back a photo labelled as a PDF.
        { contentType: newMime, upsert: true },
      );
    } catch (cacheErr) {
      console.warn("[replace-passport-pdf] Storage cache backup failed (non-fatal):", cacheErr);
    }
  }

  // AUTO-MIRROR: the passport is a pre-match dossier doc and its BYTES just changed
  // (sha recomputed above), so the agency's Drive copy must refresh. Copying raw
  // bytes is LAW #39-safe — the mirror never load+saves passport scans, it streams
  // them verbatim, whatever format they are in.
  scheduleCandidateMirror(userId);

  return NextResponse.json({ success: true, driveFileId: newDriveId, fileName: newName });
}
