/**
 * Prove the R2 storage copy byte for byte.
 *
 * Every object is compared on both listings — missing, extra, size and eTag
 * (MD5 for these single-part uploads, so a file replaced in place by one of the
 * same size still shows up) — and then downloaded from BOTH sides and compared
 * by sha256, the same standard d1/parity-check.mjs holds the row copy to.
 * Read-only on both sides; nothing is written anywhere, including this
 * machine's disk.
 *
 *   node storage/verify-r2-copy.mjs <repo-root> [--sample N]
 *
 * `--sample N` hashes N objects per bucket instead of all of them (sizes and
 * eTags are still compared for every object) — for a quick re-check.
 */
import crypto from "node:crypto";
import { PREFIX, cfHeaders, encPath, listR2, listSupabaseBucket, listSupabaseBuckets, loadEnv, r2ObjectUrl, sbHeaders, splitKey } from "./listing.mjs";
import { normEtag } from "./sync-plan.mjs";

const CONCURRENCY = 6;

const root = process.argv[2];
if (!root) { console.error("usage: node storage/verify-r2-copy.mjs <repo-root> [--sample N]"); process.exit(1); }
const sIdx = process.argv.indexOf("--sample");
const sample = sIdx > 0 ? Number(process.argv[sIdx + 1]) : Infinity;
const cfg = loadEnv(root);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) { const n = i++; if (n >= items.length) return; await worker(items[n], n); }
  }));
}

(async () => {
  const buckets = await listSupabaseBuckets(cfg);
  const inR2 = await listR2(cfg);
  const problems = [];
  let checked = 0, hashed = 0, matched = 0;
  const seen = new Set();

  for (const bucket of buckets) {
    const objects = [...(await listSupabaseBucket(cfg, bucket.id))];
    if (!objects.length) continue;
    await pool(objects, async ([key, obj], index) => {
      seen.add(key);
      checked++;
      const r2 = inR2.get(key);
      if (!r2) { problems.push(`MISSING in R2: ${PREFIX}/${key}`); return; }
      if (r2.size !== obj.size) { problems.push(`SIZE ${PREFIX}/${key}: supabase ${obj.size}, r2 ${r2.size}`); return; }
      const [ea, eb] = [normEtag(obj.etag), normEtag(r2.etag)];
      if (ea && eb && ea !== eb) { problems.push(`ETAG ${PREFIX}/${key}: same size, different content`); return; }
      if (index >= sample) { matched++; return; }
      const { bucket: b, path } = splitKey(key);
      const [a, c] = await Promise.all([
        fetch(`${cfg.sbUrl}/storage/v1/object/${encodeURIComponent(b)}/${encPath(path)}`, { headers: sbHeaders(cfg) }).then((r) => r.arrayBuffer()),
        fetch(r2ObjectUrl(cfg, `${PREFIX}/${key}`), { headers: cfHeaders(cfg) }).then((r) => r.arrayBuffer()),
      ]);
      hashed++;
      if (sha(Buffer.from(a)) !== sha(Buffer.from(c))) problems.push(`CONTENT ${PREFIX}/${key}`);
      else matched++;
    });
    process.stdout.write(`${bucket.id}: ${objects.length} checked\n`);
  }

  for (const key of inR2.keys()) if (!seen.has(key)) problems.push(`EXTRA in R2 (not in Supabase): ${PREFIX}/${key}`);

  console.log(`\n${checked} objects compared · ${hashed} hashed · ${matched} identical`);
  if (!problems.length) { console.log("PARITY OK — the R2 copy matches Supabase Storage."); process.exit(0); }
  console.log(`${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.log("  " + p);
  process.exit(1);
})().catch((err) => { console.error(err.message); process.exit(1); });
