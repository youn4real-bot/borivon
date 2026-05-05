import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
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

  // If only docId provided, resolve to drive_file_id
  if (!fileId && docId) {
    const db = getServiceSupabase();
    const { data } = await db.from("documents").select("drive_file_id").eq("id", docId).maybeSingle();
    fileId = data?.drive_file_id ?? null;
    if (!fileId) return new NextResponse("File not found", { status: 404 });
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

    return new NextResponse(Buffer.concat(chunks), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("File proxy error:", msg);
    return new NextResponse("File not found", { status: 404 });
  }
}
