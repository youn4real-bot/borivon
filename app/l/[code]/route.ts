import { NextRequest, NextResponse } from "next/server";
import { trackDb, trackServer } from "@/lib/track/server";

/**
 * borivon.com/l/<code>: a tracked link for a post, a video, a mail (made in the portal under
 * "Besucher & Quellen"). Counts the click (bots and link previews are skipped), then sends the
 * visitor to the link's page with ?src=<code>, so every later step is credited to this link.
 * An unknown code still lands on the Fahrplan: a typo must never cost the visitor.
 */
export const dynamic = "force-dynamic";

const CODE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toLowerCase();
  const base = new URL(req.url);
  let target = "/fahrplan";
  if (CODE.test(code)) {
    try {
      const db = await trackDb();
      const row = db ? (await db.run(`SELECT target FROM track_links WHERE code = ? AND archived = 0`, [code])).results[0] : undefined;
      const t = typeof row?.target === "string" ? row.target : "";
      if (t.startsWith("/") && !t.startsWith("//")) target = t;
    } catch (e) {
      console.error("[track] link lookup failed:", e instanceof Error ? e.message : e);
    }
    await trackServer(req, { path: `/l/${code}`, src: code, ref: req.headers.get("referer") ?? "" }, [{ type: "click", name: code }]);
  }
  const url = new URL(target, base.origin);
  if (CODE.test(code)) url.searchParams.set("src", code);
  // pass on any utm_* the link itself carried (e.g. a paid boost adds its own)
  for (const [k, v] of base.searchParams) if (k.startsWith("utm_")) url.searchParams.set(k, v);
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
