import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";

/** GET /api/portal/qr?data=<url>&label=<label>
 *  Proxies the QR image from api.qrserver.com so the browser can download it
 *  without CORS issues (cross-origin fetch → blob download).
 *
 *  Auth-gated: any signed-in portal user can request a QR for arbitrary data.
 *  This is a soft gate to prevent the route being used as an open relay /
 *  abuse vector against api.qrserver.com — it does not restrict WHAT data
 *  callers can encode.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const data = req.nextUrl.searchParams.get("data");
  const label = req.nextUrl.searchParams.get("label") ?? "invite";
  if (!data) return NextResponse.json({ error: "Missing data" }, { status: 400 });

  const qrUrl =
    `https://api.qrserver.com/v1/create-qr-code/?size=400x400` +
    `&bgcolor=1a1a18&color=d4af37` +
    `&data=${encodeURIComponent(data)}`;

  const imgRes = await fetch(qrUrl);
  if (!imgRes.ok) return NextResponse.json({ error: "QR fetch failed" }, { status: 502 });

  const buf = await imgRes.arrayBuffer();
  const filename = label.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") + "_qr.png";

  return new Response(buf, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
