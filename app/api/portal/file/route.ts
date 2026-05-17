import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { PDFDocument, degrees } from "pdf-lib";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const BUCKET = "sign-documents";

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

  // Candidate auth: Bearer header (desktop/Android fetch) OR ?access_token=
  // query param. iOS cannot attach an Authorization header to a top-level
  // navigation / window.open, so the query token is the ONLY way the file
  // can be opened directly in Safari's viewer. Same JWT, same user — just a
  // different transport. Responses are no-store so it isn't cached.
  const authHeader = req.headers.get("authorization");
  const headerJwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const queryJwt = req.nextUrl.searchParams.get("access_token") ?? "";
  const jwt = headerJwt || queryJwt;
  if (!jwt) return false;
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !user) return false;

  const { data: doc } = await db
    .from("documents")
    .select("id")
    .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
    .eq("user_id", user.id)
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

  // Resolve drive_file_id + rotation + signed_storage_path in one shot.
  const db = getServiceSupabase();
  let rotation = 0;
  let signedStoragePath: string | null = null;
  {
    const { data } = await db
      .from("documents")
      .select("drive_file_id, rotation, signed_storage_path")
      .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
      .maybeSingle();
    if (data) {
      const row = data as { drive_file_id: string | null; rotation: number | null; signed_storage_path: string | null };
      if (!fileId) fileId = row.drive_file_id ?? null;
      rotation = ((row.rotation ?? 0) % 360 + 360) % 360;
      signedStoragePath = row.signed_storage_path ?? null;
    }
  }

  // If a signed version exists in Supabase Storage, serve it directly — skip Drive entirely.
  if (signedStoragePath) {
    const { data: blob, error: dlErr } = await db.storage
      .from(BUCKET)
      .download(signedStoragePath);
    if (!dlErr && blob) {
      let outBuf = Buffer.from(await blob.arrayBuffer());
      if (rotation !== 0) {
        try {
          const pdfDoc = await PDFDocument.load(outBuf);
          for (const page of pdfDoc.getPages()) {
            const cur = page.getRotation().angle;
            page.setRotation(degrees((cur + rotation) % 360));
          }
          outBuf = Buffer.from(await pdfDoc.save());
        } catch { /* serve original on rotate failure */ }
      }
      return new NextResponse(outBuf, {
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

    let outBuf = Buffer.concat(chunks);

    // If this is a PDF with a saved rotation, bake it into the file so both
    // previews and downloads reflect the new orientation.
    if (rotation !== 0 && mimeType === "application/pdf") {
      try {
        const pdfDoc = await PDFDocument.load(outBuf);
        for (const page of pdfDoc.getPages()) {
          const cur = page.getRotation().angle;
          page.setRotation(degrees((cur + rotation) % 360));
        }
        outBuf = Buffer.from(await pdfDoc.save());
      } catch (e) {
        console.warn("[file proxy] pdf rotate failed, serving original:", e);
      }
    }

    return new NextResponse(outBuf, {
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
      let outBuf = Buffer.from(await blob.arrayBuffer());
      // Apply rotation for PDFs (same as Drive path)
      if (rotation !== 0) {
        try {
          const pdfDoc = await PDFDocument.load(outBuf);
          for (const page of pdfDoc.getPages()) {
            const cur = page.getRotation().angle;
            page.setRotation(degrees((cur + rotation) % 360));
          }
          outBuf = Buffer.from(await pdfDoc.save());
        } catch { /* serve original on rotate failure */ }
      }
      return new NextResponse(outBuf, {
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
