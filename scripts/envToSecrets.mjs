// One-off (gitignored output): convert the Vercel-pulled env file into a JSON map for
// `wrangler secret bulk`. Skips Vercel/Turbo/Nx build-noise vars + empties. Run:
//   node scripts/envToSecrets.mjs
import { readFileSync, writeFileSync } from "node:fs";

const raw = readFileSync(".env.cloudflare.local", "utf8");
const out = {};
const SKIP = /^(VERCEL_|VERCEL$|TURBO_|NX_|AWS_)/;
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  const key = m[1];
  let val = m[2];
  // strip surrounding double quotes + unescape \n and \" (Vercel pull quotes values)
  if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
    val = val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  if (val === "" || SKIP.test(key)) continue;
  out[key] = val;
}
writeFileSync(".env.cfsecrets.local", JSON.stringify(out));
console.log("keys to upload:", Object.keys(out).length);
console.log(Object.keys(out).sort().join(", "));
