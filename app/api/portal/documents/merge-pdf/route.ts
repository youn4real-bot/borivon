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

async function resolveFileMeta(
  db: ReturnType<typeof getServiceSupabase>,
  driveId: string | null,
  docId: string | null,
): Promise<{ fileId: string | null; rotation: number }> {
  const { data } = await db
    .from("documents")
    .select("drive_file_id, rotation")
    .eq(driveId ? "drive_file_id" : "id", driveId ?? docId!)
    .maybeSingle();
  if (!data) return { fileId: driveId, rotation: 0 };
  const row = data as { drive_file_id: string | null; rotation: number | null };
  const rot = ((row.rotation ?? 0) % 360 + 360) % 360;
  return { fileId: driveId ?? row.drive_file_id ?? null, rotation: rot };
}

async function isAuthorised(
  req: NextRequest,
  origDriveId: string | null,
  transDriveId: string | null,
  origDocId: string | null,
  transDocId: string | null,
): Promise<boolean> {
  const db = getServiceSupabase();

  const adminAuth = await requireAdminRole(req);
  if (adminAuth.ok) {
    if (adminAuth.role === "admin") return true;
    const { data: origDoc } = await db
      .from("documents")
      .select("user_id")
      .eq(origDriveId ? "drive_file_id" : "id", origDriveId ?? origDocId!)
      .maybeSingle();
    if (!origDoc) return false;
    return canActOnCandidate(adminAuth.role, adminAuth.email, origDoc.user_id);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const jwt = authHeader.slice(7);
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !user) return false;

  const { count: origCount } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq(origDriveId ? "drive_file_id" : "id", origDriveId ?? origDocId!)
    .eq("user_id", user.id);
  if (!origCount) return false;

  const { count: transCount } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq(transDriveId ? "drive_file_id" : "id", transDriveId ?? transDocId!)
    .eq("user_id", user.id);
  return !!transCount;
}

export async function GET(req: NextRequest) {
  const origId    = req.nextUrl.searchParams.get("origId");
  const transId   = req.nextUrl.searchParams.get("transId");
  const origDocId = req.nextUrl.searchParams.get("origDocId");
  const transDocId = req.nextUrl.searchParams.get("transDocId");

  if (!origId && !origDocId)
    return new NextResponse("Missing origId or origDocId", { status: 400 });
  if (!transId && !transDocId)
    return new NextResponse("Missing transId or transDocId", { status: 400 });

  const allowed = await isAuthorised(req, origId, transId, origDocId, transDocId);
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  // Resolve doc IDs to drive file IDs + per-doc rotation.
  const db = getServiceSupabase();
  const [origMeta, transMeta] = await Promise.all([
    resolveFileMeta(db, origId, origDocId),
    resolveFileMeta(db, transId, transDocId),
  ]);
  if (!origMeta.fileId || !transMeta.fileId)
    return new NextResponse("File not found", { status: 404 });

  try {
    // Fetch both PDFs in parallel (übersetzt first, then original)
    const [transBytes, origBytes] = await Promise.all([
      fetchPdfBuffer(transMeta.fileId),
      fetchPdfBuffer(origMeta.fileId),
    ]);

    // Merge: translated pages first, then original pages
    const merged = await PDFDocument.create();

    const transPdf = await PDFDocument.load(transBytes);
    const origPdf  = await PDFDocument.load(origBytes);

    const transPages = await merged.copyPages(transPdf, transPdf.getPageIndices());
    transPages.forEach(p => {
      if (transMeta.rotation) {
        const cur = p.getRotation().angle;
        p.setRotation(degrees((cur + transMeta.rotation) % 360));
      }
      merged.addPage(p);
    });

    const origPages = await merged.copyPages(origPdf, origPdf.getPageIndices());
    origPages.forEach(p => {
      if (origMeta.rotation) {
        const cur = p.getRotation().angle;
        p.setRotation(degrees((cur + origMeta.rotation) % 360));
      }
      merged.addPage(p);
    });

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
