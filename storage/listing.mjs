/**
 * Both sides of the storage copy, listed the same way: key "<bucket>/<path>" ->
 * { size, etag, updated (epoch ms), contentType }.
 *
 * Listings only — READ-ONLY on both sides. Shared by copy-to-r2.mjs,
 * copy-back-to-supabase.mjs and verify-r2-copy.mjs so the three can never
 * disagree about what "the same object" means (storage/sync-plan.mjs decides
 * that from these fields).
 */
import fs from "node:fs";
import path from "node:path";

export const PREFIX = "supabase";

export function loadEnv(root) {
  const env = Object.fromEntries(
    fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
  );
  const cfg = {
    sbUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    sbKey: env.SUPABASE_SERVICE_ROLE_KEY,
    account: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_API_TOKEN,
    bucketR2: env.R2_BUCKET || "borivon-files",
  };
  if (!cfg.sbUrl || !cfg.sbKey || !cfg.account || !cfg.token) {
    throw new Error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN in .env.local");
  }
  return cfg;
}

export const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
export const sbHeaders = (cfg) => ({ apikey: cfg.sbKey, Authorization: `Bearer ${cfg.sbKey}` });
export const cfHeaders = (cfg) => ({ Authorization: `Bearer ${cfg.token}` });
export const r2ObjectUrl = (cfg, key) =>
  `https://api.cloudflare.com/client/v4/accounts/${cfg.account}/r2/buckets/${cfg.bucketR2}/objects/${encPath(key)}`;

export async function withRetry(label, fn, retries = 3) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt > retries) throw new Error(`${label}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

const ms = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : null; };

export async function listSupabaseBuckets(cfg) {
  return withRetry("list buckets", async () => {
    const r = await fetch(`${cfg.sbUrl}/storage/v1/bucket`, { headers: sbHeaders(cfg) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

/** Every object in one Supabase bucket, walking folders (the list API is one level at a time). */
export async function listSupabaseBucket(cfg, bucket, into = new Map()) {
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += 100) {
      const res = await withRetry(`list ${bucket}`, async () => {
        const r = await fetch(`${cfg.sbUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
          method: "POST",
          headers: { ...sbHeaders(cfg), "Content-Type": "application/json" },
          body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      if (!Array.isArray(res) || res.length === 0) return;
      for (const item of res) {
        // A row with no id is a folder, not an object.
        if (item.id === null) await walk(`${prefix}${item.name}/`);
        else into.set(`${bucket}/${prefix}${item.name}`, {
          size: item.metadata?.size ?? 0,
          etag: item.metadata?.eTag ?? null,
          // updated_at moves on every upsert; lastModified is the storage backend's own clock.
          updated: ms(item.updated_at) ?? ms(item.metadata?.lastModified),
          contentType: item.metadata?.mimetype ?? null,
        });
      }
      if (res.length < 100) return;
    }
  };
  await walk("");
  return into;
}

/** Every object under supabase/ in R2, keyed "<bucket>/<path>" like the Supabase side. */
export async function listR2(cfg) {
  const have = new Map();
  let cursor = "";
  for (;;) {
    const qs = new URLSearchParams({ per_page: "1000", prefix: `${PREFIX}/` });
    if (cursor) qs.set("cursor", cursor);
    const json = await withRetry("list r2", async () => {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/r2/buckets/${cfg.bucketR2}/objects?${qs}`, { headers: cfHeaders(cfg) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    if (!json.success) throw new Error(json.errors?.map((e) => e.message).join("; ") || "r2 list failed");
    for (const o of json.result ?? []) {
      have.set(o.key.slice(PREFIX.length + 1), {
        size: o.size,
        etag: o.etag ?? null,
        updated: ms(o.last_modified),
        contentType: o.http_metadata?.contentType ?? null,
      });
    }
    cursor = json.result_info?.cursor ?? "";
    if (!cursor || (json.result ?? []).length === 0) return have;
  }
}

/** Split "<bucket>/<path>" at the first slash. */
export function splitKey(key) {
  const i = key.indexOf("/");
  return { bucket: key.slice(0, i), path: key.slice(i + 1) };
}
