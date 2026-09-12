/**
 * Copy Supabase Storage into R2 — the storage half of "copy, don't switch".
 *
 * Every object in every Supabase bucket is written to the existing R2 bucket
 * under `supabase/<bucket>/<original path>`, which cannot collide with the
 * candidate files already there (`candidates/<userId>/…`). Supabase keeps its
 * copy; nothing here deletes or modifies anything on either side, and the live
 * portal keeps reading Supabase exactly as before.
 *
 *   node storage/copy-to-r2.mjs <repo-root> [--manifest <out-dir>]
 *
 * Bytes stream Supabase → R2 in memory: no candidate file is ever written to
 * this machine's disk. The optional manifest (object paths, sizes, sha256)
 * DOES name real files, so it is refused inside the repo — same rule as
 * d1/export-data.mjs.
 *
 * Re-runnable: an object already in R2 with the same size is skipped, so an
 * interrupted run resumes, and a later run copies only what has changed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CONCURRENCY = 6;
const RETRIES = 3;
const PREFIX = "supabase";

const root = process.argv[2];
if (!root) { console.error("usage: node storage/copy-to-r2.mjs <repo-root> [--manifest <out-dir>]"); process.exit(1); }
const mIdx = process.argv.indexOf("--manifest");
const manifestDir = mIdx > 0 ? process.argv[mIdx + 1] : null;
if (manifestDir && path.resolve(manifestDir).startsWith(path.resolve(root))) {
  console.error("REFUSING: the manifest names real candidate files — keep it out of the repo.");
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const sbKey = env.SUPABASE_SERVICE_ROLE_KEY;
const account = env.CLOUDFLARE_ACCOUNT_ID;
const token = env.CLOUDFLARE_API_TOKEN;
const bucketR2 = env.R2_BUCKET || "borivon-files";
if (!sbUrl || !sbKey || !account || !token) {
  console.error("missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN in .env.local");
  process.exit(1);
}
const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
const cfHeaders = { Authorization: `Bearer ${token}` };
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const r2ObjectUrl = (key) =>
  `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucketR2}/objects/${encPath(key)}`;

async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (attempt > RETRIES) throw new Error(`${label}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

/** Every object in a Supabase bucket, walking folders (the list API is one level at a time). */
async function listSupabase(bucket) {
  const out = [];
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += 100) {
      const res = await withRetry(`list ${bucket}/${prefix}`, async () => {
        const r = await fetch(`${sbUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
          method: "POST",
          headers: { ...sbHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      if (!Array.isArray(res) || res.length === 0) return;
      for (const item of res) {
        // A row with no id is a folder, not an object.
        if (item.id === null) await walk(`${prefix}${item.name}/`);
        else out.push({ path: `${prefix}${item.name}`, size: item.metadata?.size ?? 0, contentType: item.metadata?.mimetype });
      }
      if (res.length < 100) return;
    }
  };
  await walk("");
  return out;
}

/** What the R2 copy already holds, so a re-run only moves what is missing. */
async function listR2() {
  const have = new Map();
  let cursor = "";
  for (;;) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucketR2}/objects?per_page=1000&prefix=${PREFIX}/${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const json = await withRetry("list r2", async () => {
      const r = await fetch(url, { headers: cfHeaders });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    if (!json.success) throw new Error(json.errors?.map((e) => e.message).join("; ") || "r2 list failed");
    for (const o of json.result ?? []) have.set(o.key, o.size);
    cursor = json.result_info?.cursor ?? "";
    if (!cursor || (json.result ?? []).length === 0) return have;
  }
}

async function copyOne(bucket, obj, have, manifest) {
  const key = `${PREFIX}/${bucket}/${obj.path}`;
  if (have.get(key) === obj.size) { manifest?.push({ key, size: obj.size, sha256: null, skipped: true }); return "skipped"; }

  const bytes = await withRetry(`get ${key}`, async () => {
    const r = await fetch(`${sbUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encPath(obj.path)}`, { headers: sbHeaders });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  });

  await withRetry(`put ${key}`, async () => {
    const r = await fetch(r2ObjectUrl(key), {
      method: "PUT",
      headers: { ...cfHeaders, "Content-Type": obj.contentType || "application/octet-stream" },
      body: bytes,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  });

  manifest?.push({ key, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), skipped: false });
  return "copied";
}

/** Run `work` over `items` with a fixed number of workers. */
async function pool(items, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = i++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

(async () => {
  const buckets = await withRetry("list buckets", async () => {
    const r = await fetch(`${sbUrl}/storage/v1/bucket`, { headers: sbHeaders });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  const have = await listR2();
  console.log(`R2 already holds ${have.size} object(s) under ${PREFIX}/`);

  const manifest = manifestDir ? [] : null;
  let copied = 0, skipped = 0, failed = 0, bytes = 0;

  for (const bucket of buckets) {
    const objects = await listSupabase(bucket.id);
    if (objects.length === 0) { console.log(`${bucket.id}: empty`); continue; }
    process.stdout.write(`${bucket.id}: ${objects.length} object(s) `);
    await pool(objects, async (obj) => {
      try {
        const outcome = await copyOne(bucket.id, obj, have, manifest);
        if (outcome === "copied") { copied++; bytes += obj.size; } else skipped++;
      } catch (err) {
        failed++;
        console.error(`\n  FAILED ${bucket.id}/${obj.path}: ${err.message}`);
      }
    });
    console.log("done");
  }

  if (manifest) {
    fs.mkdirSync(manifestDir, { recursive: true });
    const file = path.join(manifestDir, "storage-manifest.json");
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    console.log(`manifest → ${file} (delete it when the copy is verified — it names real files)`);
  }
  console.log(`copied ${copied}, skipped ${skipped}, failed ${failed}, ${(bytes / 1e6).toFixed(1)} MB moved`);
  process.exit(failed ? 1 : 0);
})();
