// One-off (gitignored output): build the Cloudflare secrets JSON from the real values we
// already have in .env.local + generate the random internal secrets. Excludes the Cloudflare
// deploy creds + Vercel/Turbo/Nx build-noise. Run: node scripts/loadCfSecrets.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const raw = readFileSync(".env.local", "utf8");
const have = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  if (v.trim() === "") continue;
  have[m[1]] = v;
}

const SKIP = /^(CLOUDFLARE_|VERCEL|VERCEL_|TURBO_|NX_|AWS_)/;
const out = {};
for (const [k, v] of Object.entries(have)) {
  if (SKIP.test(k)) continue;
  out[k] = v;
}
// Generate the random internal secrets if we don't already have them.
for (const k of ["DL_TOKEN_SECRET", "CRON_SECRET", "TELEGRAM_WEBHOOK_SECRET", "CALENDAR_FEED_SECRET"]) {
  if (!out[k]) out[k] = randomBytes(24).toString("hex");
}

writeFileSync(".env.cfload.local", JSON.stringify(out));
console.log("secrets ready to load:", Object.keys(out).length);
console.log(Object.keys(out).sort().join(", "));
