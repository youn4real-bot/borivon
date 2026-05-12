import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET  = "documents";

export async function GET(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return new NextResponse("Unauthorized", { status: 401 });

  const { data: authData, error: authErr } = await getAnonVerifyClient().auth.getUser(m[1].trim());
  if (authErr || !authData?.user) return new NextResponse("Unauthorized", { status: 401 });

  const slotId = req.nextUrl.searchParams.get("slotId");
  if (!slotId || !UUID_RE.test(slotId))
    return new NextResponse("slotId required", { status: 400 });

  const db   = getServiceSupabase();
  const path = `slot-templates/${slotId}.pdf`;

  const { data: blob, error } = await db.storage.from(BUCKET).download(path);
  if (error || !blob) return new NextResponse("Not found", { status: 404 });

  const buf = Buffer.from(await blob.arrayBuffer());
  return new NextResponse(buf, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline", "Cache-Control": "private, no-store" },
  });
}
