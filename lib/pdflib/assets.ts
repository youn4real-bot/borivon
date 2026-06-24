/**
 * lib/pdflib/assets.ts — cross-platform loader for files under /public.
 *
 * The pure-pdf-lib PDF renderers (lib/pdflib/*) need the bundled .ttf fonts (and
 * org logos) at render time. Those live in /public. How we read them depends on
 * the runtime:
 *   • Node / Vercel  → read straight off disk (process.cwd()/public/...).
 *   • Cloudflare Workers (no disk) → the ASSETS binding, which serves the worker's
 *     OWN bundled static assets (.open-next/assets) LOCALLY — no external network,
 *     so it can't be throttled or fail mid-flight. Declared in wrangler.jsonc
 *     ("assets": { "binding": "ASSETS", "directory": ".open-next/assets" }) and
 *     reached via OpenNext's getCloudflareContext().env.ASSETS, exactly like the
 *     R2 binding in lib/r2.ts.
 *
 * Bytes are cached per-isolate (fonts never change between requests), so the
 * fetch/read happens at most once per worker.
 */
import path from "path";
import fs from "fs";

const ON_WORKERS =
  typeof navigator !== "undefined" &&
  (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

type AssetsBindingLike = { fetch(input: Request | string): Promise<Response> };

const _cache = new Map<string, Uint8Array>();

/** Fetch a public asset from the worker's local ASSETS binding (no network). */
async function fromAssetsBinding(relPath: string): Promise<Uint8Array | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as Record<string, unknown> | undefined;
    const assets = env?.ASSETS as AssetsBindingLike | undefined;
    if (!assets) return null;
    const url = "https://assets.local/" + relPath.replace(/^\/+/, "");
    const res = await assets.fetch(new Request(url));
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Load a file from the app's /public directory, cross-platform + cached.
 * `relPath` is relative to /public (e.g. "fonts/Lato-Regular.ttf").
 * Throws if the asset can't be found on any path — callers treat that as a
 * hard render failure (same as @react-pdf would on a missing font).
 */
export async function loadPublicAsset(relPath: string): Promise<Uint8Array> {
  const key = relPath.replace(/^\/+/, "");
  const hit = _cache.get(key);
  if (hit) return hit;

  let bytes: Uint8Array | null = null;

  // Node/Vercel: disk first (the proven path).
  if (!ON_WORKERS) {
    try {
      const filePath = path.join(process.cwd(), "public", key);
      bytes = new Uint8Array(fs.readFileSync(filePath));
    } catch {
      bytes = null;
    }
  }

  // Workers: local ASSETS binding. (Also a fallback on Node if disk missed.)
  if (!bytes) bytes = await fromAssetsBinding(key);

  // Last-ditch on Node: fetch over the public base URL (e.g. file-traced out of
  // the serverless bundle). Mirrors lib/pdf-fonts.ts's fallback.
  if (!bytes && !ON_WORKERS) {
    try {
      const base = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
      if (base) {
        const res = await fetch(`${base}/${key}`);
        if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
      }
    } catch {
      /* ignore */
    }
  }

  if (!bytes) throw new Error(`pdflib asset not found: ${key}`);
  _cache.set(key, bytes);
  return bytes;
}
