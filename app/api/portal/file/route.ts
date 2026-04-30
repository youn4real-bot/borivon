import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

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

/**
 * Returns true if the request is authorised to access this fileId.
 *
 * Two valid paths (both use Authorization: Bearer <jwt>):
 *  A) Admin  — JWT user.email is ADMIN_EMAIL → unconditional access.
 *      Sub-admin → only if the file belongs to one of their assigned candidates.
 *  B) Candidate — JWT user owns a documents row with this drive_file_id.
 */
async function isAuthorised(req: NextRequest, fileId: string): Promise<boolean> {
  const db = getServiceSupabase();

  // ── A) Admin / sub-admin via Bearer JWT ───────────────────────────────────
  // requireAdminRole reads Authorization: Bearer <jwt> and verifies it.
  // We "peek" — if the JWT belongs to admin / sub-admin we use it; otherwise
  // we fall through to the candidate-ownership check below.
  const adminAuth = await requireAdminRole(req);
  if (adminAuth.ok) {
    if (adminAuth.role === "admin") return true;
    // Sub-admin: file must belong to one of their assigned candidates
    const { data: doc } = await db
      .from("documents")
      .select("user_id")
      .eq("drive_file_id", fileId)
      .maybeSingle();
    if (!doc) return false;
    const { data: assigned } = await db
      .from("sub_admin_assignments")
      .select("candidate_user_id")
      .eq("sub_admin_email", adminAuth.email)
      .eq("candidate_user_id", doc.user_id)
      .maybeSingle();
    return !!assigned;
  }

  // ── B) Candidate Bearer token ─────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const jwt = authHeader.slice(7);

  // Verify JWT with the cached anon client (validates signature server-side)
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !user) return false;

  // Check this file ID actually belongs to this user in the documents table
  const { data: doc } = await db
    .from("documents")
    .select("id")
    .eq("drive_file_id", fileId)
    .eq("user_id", user.id)
    .maybeSingle();

  return !!doc;
}

export async function GET(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("id");
  if (!fileId) return new NextResponse("Missing id", { status: 400 });

  // ── Auth gate ─────────────────────────────────────────────────────────────
  const allowed = await isAuthorised(req, fileId);
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

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
