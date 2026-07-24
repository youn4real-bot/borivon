// OpenNext → Cloudflare adapter config. Docs: https://opennext.js.org/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * PERF — why this cache is here (measured against prod 2026-07-24, right after
 * the Vercel → Cloudflare cutover).
 *
 * With the previous bare `defineCloudflareConfig()` there was NO incremental
 * cache, so the worker RE-RENDERED every page on every request — including fully
 * prerendered ones. Measured: /v2 took ~2.0s on 8 consecutive requests (flat, so
 * not a cold start) with `cf-cache-status: (none)`, while the same connection
 * fetched cloudflare.com in 128ms. That is exactly the "clicks don't respond
 * quickly/smoothly" the founder reported.
 *
 * staticAssetsIncrementalCache serves prerendered pages straight from the Workers
 * static assets already uploaded at build (the existing ASSETS binding) instead
 * of re-rendering them. It is READ-ONLY (no revalidation), which is precisely
 * this app's shape: the marketing pages are fully prerendered, and every portal
 * route is force-dynamic + auth'd so it was never cacheable anyway. Verified
 * before enabling: the repo contains no `export const revalidate`,
 * `revalidatePath` or `revalidateTag`, so nothing depends on ISR.
 *
 * Needs NO new bucket and NO new binding.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
