import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { PDFDocument, degrees } from "pdf-lib";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate, roleByUserId } from "@/lib/admin-auth";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { dlTokenUserId } from "@/lib/dlToken";

const BUCKET = "sign-documents";

/**
 * Apply a view rotation to a PDF — conservatively, so the file's content
 * survives the round-trip. pdf-lib's default save() rewrites object streams
 * and can drop content for some scanner-produced PDFs. The fix is twofold:
 *
 *  1. **Conservative save**: `useObjectStreams: false` keeps each object as
 *     its own stream — preserves image / content streams that the compacted
 *     default save sometimes loses. Output is slightly larger than the
 *     original but content is intact.
 *  2. **Sanity guard only on degenerate output**: if pdf-lib produced an
 *     empty/parse-failure result we return the original. We do NOT compare
 *     against `original.length * 0.5` anymore — that guard tripped on
 *     normal PDFs whose conservative re-save legitimately shrinks the file
 *     (object-stream PDFs are bigger than their flat re-save), which meant
 *     the server stored the new rotation in the DB but returned UNROTATED
 *     bytes → user clicked rotate, file looked rotated until reopen, then
 *     came back sideways. The user could never persist a rotation.
 *
 * For passport docs (LAW #39), this function is NEVER called — the call
 * sites bypass safeRotatePdf entirely for passports and let IosPdfFrame
 * handle rotation as a client-side CSS transform.
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
    const out = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
    if (out.length < 1024) return original; // degenerate / empty result only
    return out;
  } catch {
    return original; // encrypted / unsupported / parse failure → never erase
  }
}

/** LAW #39: passport docs are NEVER server-mutated. Match on stored file_type. */
function isPassportDoc(fileType: string | null | undefined): boolean {
  return !!fileType && /pass/i.test(fileType);
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

  // Resolve drive_file_id + rotation + signed_storage_path + file_type in one shot.
  // file_type is needed for the LAW #39 passport bypass on safeRotatePdf.
  const db = getServiceSupabase();
  let rotation = 0;
  let signedStoragePath: string | null = null;
  let fileType: string | null = null;
  {
    const { data } = await db
      .from("documents")
      .select("drive_file_id, rotation, signed_storage_path, file_type")
      .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
      .maybeSingle();
    if (data) {
      const row = data as { drive_file_id: string | null; rotation: number | null; signed_storage_path: string | null; file_type: string | null };
      if (!fileId) fileId = row.drive_file_id ?? null;
      rotation = ((row.rotation ?? 0) % 360 + 360) % 360;
      signedStoragePath = row.signed_storage_path ?? null;
      fileType = row.file_type ?? null;
    }
  }
  // LAW #39: passports are pristine — server-side rotation is forbidden.
  // The viewer (IosPdfFrame) rotates passport previews via CSS only.
  const effectiveRotation = isPassportDoc(fileType) ? 0 : rotation;

  // If a signed version exists in Supabase Storage, serve it directly — skip Drive entirely.
  if (signedStoragePath) {
    const { data: blob, error: dlErr } = await db.storage
      .from(BUCKET)
      .download(signedStoragePath);
    if (!dlErr && blob) {
      const srcBuf = Buffer.from(await blob.arrayBuffer());
      const outBuf = await safeRotatePdf(srcBuf, effectiveRotation);
      return new NextResponse(new Uint8Array(outBuf), {
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
    const outBuf = mimeType === "application/pdf"
      ? await safeRotatePdf(srcBuf, effectiveRotation)
      : srcBuf;

    return new NextResponse(new Uint8Array(outBuf), {
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
      return new NextResponse(new Uint8Array(outBuf), {
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
