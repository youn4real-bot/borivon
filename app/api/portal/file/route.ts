import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { PDFDocument, degrees } from "pdf-lib";
import { createHash } from "crypto";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate, roleByUserId } from "@/lib/admin-auth";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { dlTokenUserId } from "@/lib/dlToken";
import { isPassportFileType } from "@/lib/passportFile";

const BUCKET = "sign-documents";

/**
 * LAW #39 belt-and-suspenders. Verify the served bytes match the sha256
 * snapshotted at upload time. If they DIVERGE — i.e. some future code
 * path silently mutated the passport — we transparently fall back to the
 * Supabase Storage backup (doc-cache/<driveFileId>) which holds the
 * original upload bytes, and we log a critical error naming the served
 * source so the regression is findable in the Vercel logs.
 *
 * Only called for passport docs. Other doctypes legitimately get
 * rotated server-side and their served bytes won't match upload hash.
 *
 * Returns the verified bytes (original if hash matched, storage backup
 * otherwise). If the storage backup is also broken or unavailable, the
 * original served bytes come back unchanged — the user always gets
 * SOMETHING; the log is how we find the corrupting code path.
 */
async function ensurePassportIntegrity(
  served: Buffer,
  storedHash: string | null,
  driveFileId: string | null,
  source: string,
): Promise<Buffer> {
  if (!storedHash || !driveFileId) return served;
  const actual = createHash("sha256").update(served).digest("hex");
  if (actual === storedHash) return served;

  console.error(
    `[file-proxy] LAW #39 hash mismatch on passport — source=${source} ` +
    `driveFileId=${driveFileId} stored=${storedHash.slice(0, 12)}… ` +
    `served=${actual.slice(0, 12)}… falling back to Storage backup`,
  );

  try {
    const db = getServiceSupabase();
    const { data: blob } = await db.storage
      .from(BUCKET)
      .download(`doc-cache/${driveFileId}`);
    if (blob) {
      const backup = Buffer.from(await blob.arrayBuffer());
      const backupHash = createHash("sha256").update(backup).digest("hex");
      if (backupHash === storedHash) return backup;
      console.error(
        `[file-proxy] LAW #39 storage backup ALSO mismatches — ` +
        `driveFileId=${driveFileId} backup=${backupHash.slice(0, 12)}…`,
      );
    }
  } catch (e) {
    console.error("[file-proxy] LAW #39 fallback fetch threw:", e);
  }
  return served; // last-resort: something > nothing
}

/**
 * Apply a view rotation to a PDF — but NEVER at the cost of the file's
 * content. pdf-lib's load()→save() round-trip silently drops page content
 * for some scanner-produced PDFs (object-stream/incremental-update layouts
 * common in phone passport scans) → the candidate's passport rendered blank
 * ("the data got erased"). This bug is intermittent because it only triggers
 * on those specific PDFs once a rotation is set.
 *
 * Rule: the uploaded PDF must come back EXACTLY as uploaded. If the rotate
 * re-save throws, OR yields an empty/degenerate result (no pages, or the
 * byte size collapsed — the tell-tale of dropped image/content streams),
 * we return the ORIGINAL bytes untouched. Worst case: that one view isn't
 * rotated; the passport is never erased.
 */
async function safeRotatePdf(original: Buffer, rotation: number): Promise<Buffer> {
  if (rotation === 0) return original;
  try {
    const pdfDoc = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
    const pages = pdfDoc.getPages();
    if (pages.length === 0) return original;
    for (const page of pages) {
      const cur = page.getRotation().angle;
      page.setRotation(degrees((cur + rotation) % 360));
    }
    const out = Buffer.from(await pdfDoc.save());
    // Degenerate-output guard: a correct rotate-only re-save is ~the same
    // size (images are kept by reference). A large size collapse means
    // pdf-lib dropped content → serve the untouched original instead.
    if (out.length < 1024 || out.length < original.length * 0.5) return original;
    return out;
  } catch {
    return original; // encrypted / unsupported / parse failure → never erase
  }
}

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

async function isAuthorised(
  req: NextRequest,
  fileId: string | null,
  docId: string | null,
): Promise<boolean> {
  const db = getServiceSupabase();

  const adminAuth = await requireAdminRole(req);
  if (adminAuth.ok) {
    if (adminAuth.role === "admin") return true;
    // Sub-admin: file must belong to a candidate they manage.
    const { data: doc } = await db
      .from("documents")
      .select("user_id")
      .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
      .maybeSingle();
    if (!doc) return false;
    return canActOnCandidate(adminAuth.role, adminAuth.email, doc.user_id);
  }

  // Candidate auth: Bearer header (desktop/Android fetch) OR — for iOS, which
  // can't attach a header to a top-level navigation / <iframe src> — a
  // short-lived signed download token (?dlt=). The raw Supabase JWT is NEVER
  // accepted from the URL anymore (it would leak into logs/referrer as a
  // ~1h full-API credential).
  const authHeader = req.headers.get("authorization");
  const headerJwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let actorId: string | null = null;
  if (headerJwt) {
    const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(headerJwt);
    if (!error && user && !isSoftDeletedAuthUser(user)) actorId = user.id;
  } else {
    actorId = dlTokenUserId(req);
  }
  if (!actorId) return false;

  // The token/header holder may be an ADMIN or SUB-ADMIN viewing a
  // candidate's doc (e.g. the passport preview now uses the native iframe =
  // token path, which previously only authorised the doc OWNER → "Forbidden"
  // for admins after a PDF replace). Resolve their role by user id and apply
  // the SAME rule as the header-admin path. Plain candidates → roleByUserId
  // is not ok → fall through to the owner check (unchanged).
  const r = await roleByUserId(actorId);
  if (r.ok) {
    if (r.role === "admin") return true;
    const { data: sdoc } = await db
      .from("documents")
      .select("user_id")
      .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
      .maybeSingle();
    if (!sdoc) return false;
    return canActOnCandidate(r.role, r.email, sdoc.user_id);
  }

  const { data: doc } = await db
    .from("documents")
    .select("id")
    .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
    .eq("user_id", actorId)
    .maybeSingle();
  return !!doc;
}

// Build a Content-Disposition. `dl=1` forces a real download (attachment)
// — required so iOS Safari saves the file to Files instead of just showing
// it. Filename comes from the client (?name=), ASCII-sanitised + RFC 5987
// UTF-8 fallback so it can't break the header.
function wantsDl(req: NextRequest): boolean {
  return req.nextUrl.searchParams.get("dl") === "1";
}
function disposition(req: NextRequest, fallbackName: string): string {
  if (!wantsDl(req)) return "inline";
  const raw = (req.nextUrl.searchParams.get("name") || fallbackName || "document")
    .replace(/[\r\n"]/g, "").slice(0, 200);
  const ascii = raw.replace(/[^\x20-\x7E]/g, "_") || "document";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}
// iOS Safari force-previews known types (PDF/JPEG/PNG) even with an
// attachment disposition — the only reliable way to make iPhones (iPhone X
// / iOS 13 → today) ACTUALLY download like PC/Android is to serve the bytes
// as a generic binary so WebKit can't preview it and must hand it to the
// download manager → Files. Only applied on explicit ?dl=1 downloads;
// inline previews keep their real mime.
function ctype(req: NextRequest, realMime: string): string {
  return wantsDl(req) ? "application/octet-stream" : realMime;
}

export async function GET(req: NextRequest) {
  let fileId = req.nextUrl.searchParams.get("id");
  const docId = req.nextUrl.searchParams.get("docId");
  if (!fileId && !docId) return new NextResponse("Missing id", { status: 400 });

  // ── Auth gate ─────────────────────────────────────────────────────────────
  const allowed = await isAuthorised(req, fileId, docId);
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  // Resolve drive_file_id + rotation + signed_storage_path + file_type + sha256
  // in one shot. file_sha256 may not exist in older deployments — wrap the
  // select so a missing column degrades gracefully (integrity check just
  // skips until the supabase/add_file_sha256.sql migration is applied).
  const db = getServiceSupabase();
  let rotation = 0;
  let signedStoragePath: string | null = null;
  let fileType: string | null = null;
  let fileSha256: string | null = null;
  {
    type Row = {
      drive_file_id: string | null;
      rotation: number | null;
      signed_storage_path: string | null;
      file_type: string | null;
      file_sha256?: string | null;
    };
    let data: Row | null = null;
    {
      const res = await db
        .from("documents")
        .select("drive_file_id, rotation, signed_storage_path, file_type, file_sha256")
        .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
        .maybeSingle();
      if (res.error && /file_sha256|column .* does not exist|schema cache/i.test(res.error.message ?? "")) {
        const res2 = await db
          .from("documents")
          .select("drive_file_id, rotation, signed_storage_path, file_type")
          .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
          .maybeSingle();
        data = (res2.data as Row | null) ?? null;
      } else {
        data = (res.data as Row | null) ?? null;
      }
    }
    if (data) {
      if (!fileId) fileId = data.drive_file_id ?? null;
      rotation = ((data.rotation ?? 0) % 360 + 360) % 360;
      signedStoragePath = data.signed_storage_path ?? null;
      fileType = data.file_type ?? null;
      fileSha256 = data.file_sha256 ?? null;
    }
  }

  // LAW #39: passport PDFs are NEVER server-side mutated. pdf-lib's
  // load → save round-trip silently drops content streams on
  // scanner-produced PDFs (Moroccan passport scans hit this hard — the
  // photo + holograms survive but the MRZ + printed VIZ text come back
  // blank). The 50% size guard doesn't catch this case because the photo
  // is by far the largest stream → size stays close to original even
  // when every text stream is dropped. Rotation for passports is purely
  // client-side (IosPdfFrame toolbar applies a CSS transform); the bytes
  // we serve are ALWAYS exactly what came out of Drive / Storage.
  const effectiveRotation = isPassportFileType(fileType) ? 0 : rotation;

  // If a signed version exists in Supabase Storage, serve it directly — skip Drive entirely.
  if (signedStoragePath) {
    const { data: blob, error: dlErr } = await db.storage
      .from(BUCKET)
      .download(signedStoragePath);
    if (!dlErr && blob) {
      const srcBuf = Buffer.from(await blob.arrayBuffer());
      const outBuf = await safeRotatePdf(srcBuf, effectiveRotation);
      // LAW #39 integrity audit on signed-storage-path passport serves.
      // (Signed paths are usually post-signature flows, not passport scans,
      // but we check anyway — costs ~1ms on a passport-sized PDF.)
      const verified = isPassportFileType(fileType)
        ? await ensurePassportIntegrity(outBuf, fileSha256, fileId, "signed-storage")
        : outBuf;
      return new NextResponse(new Uint8Array(verified), {
        headers: {
          "Content-Type": ctype(req, "application/pdf"),
          "Content-Disposition": disposition(req, "document"),
          "Cache-Control": "private, no-store, must-revalidate",
        },
      });
    }
  }

  if (!fileId) return new NextResponse("File not found", { status: 404 });

  try {
    const drive = getDriveClient();

    const meta = await drive.files.get({
      fileId,
      fields: "mimeType,name",
      supportsAllDrives: true,
    });
    const mimeType = meta.data.mimeType ?? "application/octet-stream";

    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );

    const stream = res.data as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const srcBuf = Buffer.concat(chunks);

    // If this is a PDF with a saved rotation, apply it — but safeRotatePdf
    // guarantees the original is returned untouched if the re-save would
    // corrupt/blank it (the scanned-passport "data erased" bug).
    // effectiveRotation is 0 for passport files so they never re-save.
    const outBuf = mimeType === "application/pdf"
      ? await safeRotatePdf(srcBuf, effectiveRotation)
      : srcBuf;

    // LAW #39 integrity audit on Drive-sourced passport serves. If the
    // bytes don't match the hash we recorded on upload, fall back to the
    // Storage backup and log loudly so the corrupting code path is
    // findable in the server log.
    const verified = isPassportFileType(fileType) && mimeType === "application/pdf"
      ? await ensurePassportIntegrity(outBuf, fileSha256, fileId, "drive")
      : outBuf;

    return new NextResponse(new Uint8Array(verified), {
      headers: {
        "Content-Type": ctype(req, mimeType),
        "Content-Disposition": disposition(req, "document"),
        // Don't cache — rotation can change at any time.
        "Cache-Control": "private, no-store, must-revalidate",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[file proxy] Drive fetch failed, trying Storage fallback:", msg);

    // Storage fallback — uploads route mirrors PDFs to sign-documents/doc-cache/{driveFileId}
    // so the file is still retrievable when the Drive file is deleted/inaccessible.
    try {
      const { data: blob, error: dlErr } = await db.storage
        .from("sign-documents")
        .download(`doc-cache/${fileId}`);
      if (dlErr || !blob) {
        console.error("[file proxy] Storage fallback also failed:", dlErr);
        return new NextResponse("File not found", { status: 404 });
      }
      const srcBuf = Buffer.from(await blob.arrayBuffer());
      const outBuf = await safeRotatePdf(srcBuf, effectiveRotation);
      // LAW #39: even in the Drive-failed fallback, audit passport bytes.
      // The storage backup SHOULD match the upload hash (mirrored at
      // upload time); a divergence here would mean even the backup got
      // corrupted, which is the kind of edge we want to know about loudly.
      const verified = isPassportFileType(fileType)
        ? await ensurePassportIntegrity(outBuf, fileSha256, fileId, "storage-fallback")
        : outBuf;
      return new NextResponse(new Uint8Array(verified), {
        headers: {
          "Content-Type": ctype(req, "application/pdf"),
          "Content-Disposition": disposition(req, "document"),
          "Cache-Control": "private, no-store, must-revalidate",
        },
      });
    } catch (fallbackErr) {
      console.error("[file proxy] Both Drive and Storage failed:", fallbackErr);
      return new NextResponse("File not found", { status: 404 });
    }
  }
}
