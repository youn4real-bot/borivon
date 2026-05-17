import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";

/**
 * Transient store for the CV-builder's just-generated PDF.
 *
 * The CV is generated CLIENT-SIDE as a blob — iOS can neither preview a
 * blob: URL (WebKit) nor download one. So on iOS we POST the generated PDF
 * here (one slot per user, overwritten every generate → no cleanup needed),
 * then reuse the SAME iOS-safe paths as every other doc:
 *   - preview  → IosPdfFrame iframe → GET (inline)
 *   - download → in-gesture anchor → GET ?dl=1 (octet-stream attachment)
 *
 * Auth: Bearer header (POST) OR ?access_token query (GET — iOS navigations
 * can't send a header). Stored in the existing `sign-documents` bucket under
 * `cv-preview/<userId>.pdf`; responses are no-store.
 */
const BUCKET = "sign-documents";
const objectPath = (userId: string) => `cv-preview/${userId}.pdf`;

export async function POST(req: NextRequest) {
  const header = req.headers.get("authorization");
  const jwt = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!jwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Bad size" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(objectPath(user.id), buf, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    console.error("[cv preview-file] upload failed:", upErr);
    return NextResponse.json({ error: "Store failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization");
  const headerJwt = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const queryJwt = req.nextUrl.searchParams.get("access_token") ?? "";
  const jwt = headerJwt || queryJwt;
  if (!jwt) return new NextResponse("Unauthorized", { status: 401 });
  const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(jwt);
  if (error || !user) return new NextResponse("Unauthorized", { status: 401 });

  const db = getServiceSupabase();
  const { data: blob, error: dlErr } = await db.storage
    .from(BUCKET)
    .download(objectPath(user.id));
  if (dlErr || !blob) return new NextResponse("Not found", { status: 404 });

  const dl = req.nextUrl.searchParams.get("dl") === "1";
  const name = (req.nextUrl.searchParams.get("name") || "lebenslauf.pdf")
    .replace(/[\r\n"]/g, "").slice(0, 200);
  const bytes = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(bytes, {
    headers: {
      // octet-stream on download so iOS Safari saves instead of previewing.
      "Content-Type": dl ? "application/octet-stream" : "application/pdf",
      "Content-Disposition": dl ? `attachment; filename="${name}"` : "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
