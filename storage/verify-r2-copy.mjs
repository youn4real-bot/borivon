/**
 * Prove the R2 storage copy byte for byte.
 *
 * Downloads every object from BOTH sides and compares sha256 — the same
 * standard d1/parity-check.mjs holds the row copy to. Reports missing keys,
 * extra keys, size differences and content differences. Read-only on both
 * sides; nothing is written anywhere, including this machine's disk.
 *
 *   node storage/verify-r2-copy.mjs <repo-root> [--sample N]
 *
 * `--sample N` hashes N objects per bucket instead of all of them (sizes are
 * still compared for every object) — for a quick re-check between full runs.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CONCURRENCY = 6;
const PREFIX = "supabase";

const root = process.argv[2];
if (!root) { console.error("usage: node storage/verify-r2-copy.mjs <repo-root> [--sample N]"); process.exit(1); }
const sIdx = process.argv.indexOf("--sample");
const sample = sIdx > 0 ? Number(process.argv[sIdx + 1]) : Infinity;

const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL, sbKey = env.SUPABASE_SERVICE_ROLE_KEY;
const account = env.CLOUDFLARE_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
const bucketR2 = env.R2_BUCKET || "borivon-files";
const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
const cfHeaders = { Authorization: `Bearer ${token}` };
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function json(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 80)}`);
  return r.json();
}

async function listSupabase(bucket) {
  const out = [];
  const walk = async (prefix) => {
    for (let offset = 0; ; offset += 100) {
      const res = await json(`${sbUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!Array.isArray(res) || res.length === 0) return;
      for (const item of res) {
        if (item.id === null) await walk(`${prefix}${item.name}/`);
        else out.push({ path: `${prefix}${item.name}`, size: item.metadata?.size ?? 0 });
      }
      if (res.length < 100) return;
    }
  };
  await walk("");
  return out;
}

async function listR2() {
  const have = new Map();
  let cursor = "";
  for (;;) {
    const res = await json(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucketR2}/objects?per_page=1000&prefix=${PREFIX}/${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: cfHeaders });
    for (const o of res.result ?? []) have.set(o.key, o.size);
    cursor = res.result_info?.cursor ?? "";
    if (!cursor || (res.result ?? []).length === 0) return have;
  }
}

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) { const n = i++; if (n >= items.length) return; await worker(items[n], n); }
  }));
}

(async () => {
  const buckets = await json(`${sbUrl}/storage/v1/bucket`, { headers: sbHeaders });
  const inR2 = await listR2();
  const problems = [];
  let checked = 0, hashed = 0, matched = 0;
  const seen = new Set();

  for (const bucket of buckets) {
    const objects = await listSupabase(bucket.id);
    if (!objects.length) continue;
    await pool(objects, async (obj, index) => {
      const key = `${PREFIX}/${bucket.id}/${obj.path}`;
      seen.add(key);
      checked++;
      if (!inR2.has(key)) { problems.push(`MISSING in R2: ${key}`); return; }
      if (inR2.get(key) !== obj.size) { problems.push(`SIZE ${key}: supabase ${obj.size}, r2 ${inR2.get(key)}`); return; }
      if (index >= sample) { matched++; return; }
      const [a, b] = await Promise.all([
        fetch(`${sbUrl}/storage/v1/object/${encodeURIComponent(bucket.id)}/${encPath(obj.path)}`, { headers: sbHeaders }).then((r) => r.arrayBuffer()),
        fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucketR2}/objects/${encPath(key)}`, { headers: cfHeaders }).then((r) => r.arrayBuffer()),
      ]);
      hashed++;
      if (sha(Buffer.from(a)) !== sha(Buffer.from(b))) problems.push(`CONTENT ${key}`);
      else matched++;
    });
    process.stdout.write(`${bucket.id}: ${objects.length} checked\n`);
  }

  for (const key of inR2.keys()) if (!seen.has(key)) problems.push(`EXTRA in R2 (not in Supabase): ${key}`);

  console.log(`\n${checked} objects compared · ${hashed} hashed · ${matched} identical`);
  if (!problems.length) { console.log("PARITY OK — the R2 copy matches Supabase Storage."); process.exit(0); }
  console.log(`${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.log("  " + p);
  process.exit(1);
})();
