import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { encodeQr, qrPng } from "@/lib/qr";

/** GET /api/portal/qr?data=<url>&label=<label>
 *  The invite QR as a PNG download, generated in-process (lib/qr). It used to
 *  proxy api.qrserver.com, which handed every single-use invite token to a
 *  third party.
 *
 *  Auth-gated: any signed-in portal user can request a QR for an http(s) URL.
 *  The gate, length cap and rate limit keep it from being a free image
 *  service — they do not restrict WHAT URL callers can encode.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const data = req.nextUrl.searchParams.get("data");
  const label = req.nextUrl.searchParams.get("label") ?? "invite";
  if (!data) return NextResponse.json({ error: "Missing data" }, { status: 400 });

  // Audit fix: `data` is attacker-controlled and proxied to a third party.
  // This route only ever encodes portal invite URLs — cap the length and
  // require a well-formed http(s) URL so it can't be abused as an open
  // text/redirect relay against api.qrserver.com.
  if (data.length > 512) {
    return NextResponse.json({ error: "data too long" }, { status: 400 });
  }
  let parsed: URL;
  try { parsed = new URL(data); } catch {
    return NextResponse.json({ error: "data must be a URL" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "Unsupported URL scheme" }, { status: 400 });
  }

  const rl = await enforceUserRateLimit("qr", `u:${auth.userId}`, { limit: 30, windowMs: 60000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  // drawn here (lib/qr) — this route must never fetch: the URL is a single-use invite token
  const buf = await qrPng(encodeQr(data));
  const filename = label.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") + "_qr.png";

  return new Response(buf, {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
