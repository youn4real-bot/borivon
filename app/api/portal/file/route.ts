import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { PDFDocument, degrees } from "pdf-lib";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

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

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const jwt = authHeader.slice(7);
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

export async function GET(req: NextRequest) {
  let fileId = req.nextUrl.searchParams.get("id");
  const docId = req.nextUrl.searchParams.get("docId");
  if (!fileId && !docId) return new NextResponse("Missing id", { status: 400 });

  // ── Auth gate ─────────────────────────────────────────────────────────────
  const allowed = await isAuthorised(req, fileId, docId);
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  // Resolve drive_file_id + rotation in one shot.
  const db = getServiceSupabase();
  let rotation = 0;
  {
    const { data } = await db
      .from("documents")
      .select("drive_file_id, rotation")
      .eq(fileId ? "drive_file_id" : "id", fileId ?? docId!)
      .maybeSingle();
    if (data) {
      const row = data as { drive_file_id: string | null; rotation: number | null };
      if (!fileId) fileId = row.drive_file_id ?? null;
      rotation = ((row.rotation ?? 0) % 360 + 360) % 360;
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
        "Content-Type": mimeType,
        "Content-Disposition": "inline",
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
          "Content-Type": "application/pdf",
          "Content-Disposition": "inline",
          "Cache-Control": "private, no-store, must-revalidate",
        },
      });
    } catch (fallbackErr) {
      console.error("[file proxy] Both Drive and Storage failed:", fallbackErr);
      return new NextResponse("File not found", { status: 404 });
    }
  }
}
