import { NextRequest } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { buildRows, insertRows, readTrack, type InEvent } from "@/lib/track/server";

/**
 * POST /api/t: the page-side analytics beacon (public/pflege/assets/t.js, lib/track/client), sent only
 * after the visitor accepted on the consent banner.
 * Body: { ...visit context, events: [{ type, name, value, ago }] }. Always answers 204, so a
 * page never waits on analytics and a probe learns nothing; junk is dropped, not reported.
 */
export const dynamic = "force-dynamic";

const NO_CONTENT = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "track", { limit: 240, windowMs: 60_000 });
  if (!rl.ok) return NO_CONTENT();
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > 40_000) return NO_CONTENT();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NO_CONTENT(); }
  if (!body || typeof body !== "object" || !Array.isArray(body.events)) return NO_CONTENT();
  // Browser-side measurement exists ONLY with consent (§ 25 TDDDG): the banner sets c:1. Anything else is dropped.
  if (body.c !== 1) return NO_CONTENT();
  try {
    await insertRows(await buildRows(req.headers, readTrack(body), body.events as InEvent[]));
  } catch (e) {
    console.error("[track] beacon insert failed:", e instanceof Error ? e.message : e);
  }
  return NO_CONTENT();
}
