import { NextRequest } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";

/**
 * The map under the arrival plan: OpenStreetMap tiles, fetched by OUR server and cached at the edge,
 * so the visitor's browser never talks to a third party (no IP to anyone else, no consent needed).
 * Attribution "© OpenStreetMap" is shown on the map. Zoom 5–17 only; per-IP rate limit.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Borivon/1.0 (+https://borivon.com; contact@borivon.com)";
const WEEK = 7 * 86400;

type CacheLike = { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> };
const edgeCache = (): CacheLike | null => {
  const c = (globalThis as unknown as { caches?: { default?: CacheLike } }).caches;
  return c?.default ?? null;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await params;
  const z = Number(p.z), x = Number(p.x), y = Number(String(p.y).replace(/\.png$/, ""));
  const n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 5 || z > 17 || x < 0 || y < 0 || x >= n || y >= n) return new Response("bad tile", { status: 400 });
  const key = new Request(`https://borivon.com/__tile/${z}/${x}/${y}.png`);
  const cache = edgeCache();
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
  if (hit) return hit;
  const rl = await enforceRateLimitDistributed(req, "fx-tile", { limit: 600, windowMs: 3_600_000 });
  if (!rl.ok) return new Response("too many", { status: 429 });
  const up = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: { "User-Agent": UA, Referer: "https://borivon.com/" } }).catch(() => null);
  if (!up || !up.ok) return new Response("tile unavailable", { status: 502 });
  const res = new Response(await up.arrayBuffer(), {
    headers: { "Content-Type": "image/png", "Cache-Control": `public, max-age=${WEEK}`, "X-Content-Type-Options": "nosniff" },
  });
  if (cache) await cache.put(key, res.clone()).catch(() => {});
  return res;
}
