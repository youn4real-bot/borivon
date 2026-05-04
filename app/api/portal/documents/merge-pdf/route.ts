import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { PDFDocument } from "pdf-lib";
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

async function fetchPdfBuffer(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  const stream = res.data as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

async function isAuthorised(
  req: NextRequest,
  origId: string,
  transId: string,
): Promise<boolean> {
  const db = getServiceSupabase();

  const adminAuth = await requireAdminRole(req);
  if (adminAuth.ok) {
    if (adminAuth.role === "admin") return true;
    // Sub-admin: both files must belong to a candidate they manage
    const { data: origDoc } = await db
      .from("documents")
      .select("user_id")
      .eq("drive_file_id", origId)
      .maybeSingle();
    if (!origDoc) return false;
    return canActOnCandidate(adminAuth.role, adminAuth.email, origDoc.user_id);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const jwt = authHeader.slice(7);

  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !user) return false;

  // Candidate must own BOTH files
  const { count: origCount } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("drive_file_id", origId)
    .eq("user_id", user.id);
  if (!origCount) return false;

  const { count: transCount } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("drive_file_id", transId)
    .eq("user_id", user.id);
  return !!transCount;
}

export async function GET(req: NextRequest) {
  const origId  = req.nextUrl.searchParams.get("origId");
  const transId = req.nextUrl.searchParams.get("transId");
  if (!origId || !transId)
    return new NextResponse("Missing origId or transId", { status: 400 });

  const allowed = await isAuthorised(req, origId, transId);
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  try {
    // Fetch both PDFs in parallel
    const [transBytes, origBytes] = await Promise.all([
      fetchPdfBuffer(transId),
      fetchPdfBuffer(origId),
    ]);

    // Merge: translated pages first, then original pages
    const merged = await PDFDocument.create();

    const transPdf = await PDFDocument.load(transBytes);
    const origPdf  = await PDFDocument.load(origBytes);

    const transPages = await merged.copyPages(transPdf, transPdf.getPageIndices());
    transPages.forEach(p => merged.addPage(p));

    const origPages = await merged.copyPages(origPdf, origPdf.getPageIndices());
    origPages.forEach(p => merged.addPage(p));

    const mergedBytes = await merged.save();

    return new NextResponse(Buffer.from(mergedBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[merge-pdf] error:", msg);
    return new NextResponse("Merge failed", { status: 500 });
  }
}
