// Autonomous Drive→R2 backfill — mirrors app/api/portal/admin/migrate-drive-to-r2:
// for each documents row with drive_file_id but NULL r2_key, read the bytes from
// Drive (read-only), PUT into R2 via the Cloudflare REST API (CF token), verify the
// size, then set r2_key. Never deletes Drive. Idempotent. Additive only.
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import fs from "node:fs";

function parseEnv(txt) {
  const env = {}; const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(lines[i]);
    if (!m) continue;
    let val = m[2];
    if (val.startsWith('"') && !(val.length > 1 && val.endsWith('"'))) {
      const parts = [val];
      while (i + 1 < lines.length && !lines[i + 1].endsWith('"')) { i++; parts.push(lines[i]); }
      if (i + 1 < lines.length) { i++; parts.push(lines[i]); }
      val = parts.join("\n");
    }
    env[m[1]] = val.replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = parseEnv(fs.readFileSync(".env.local", "utf8"));
const ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID, TOKEN = env.CLOUDFLARE_API_TOKEN, BUCKET = env.R2_BUCKET || "borivon-files";
const pk = (env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
if (!pk.includes("BEGIN PRIVATE KEY") || !pk.includes("END PRIVATE KEY")) {
  console.error("ABORT: GOOGLE_PRIVATE_KEY did not parse to a full PEM — check .env.local format."); process.exit(1);
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const drive = google.drive({
  version: "v3",
  auth: new google.auth.GoogleAuth({
    credentials: { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: pk },
    scopes: ["https://www.googleapis.com/auth/drive"],
  }),
});

const candidateKey = (userId, fileName) =>
  `candidates/${userId}/${(fileName || "document").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_")}`;

async function r2Put(key, buf, mime) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${key}`;
  const r = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": mime }, body: buf });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error(`R2 PUT ${r.status} ${JSON.stringify(j.errors || j)}`);
  return Number(j.result?.size ?? -1);
}

const { data: rows, error } = await db.from("documents")
  .select("id, user_id, drive_file_id, file_name")
  .not("drive_file_id", "is", null).is("r2_key", null);
if (error) { console.error("DB query failed:", error.message); process.exit(1); }
console.log(`To migrate: ${rows.length}`);

let copied = 0; const failed = [];
for (const [i, row] of rows.entries()) {
  const tag = `${i + 1}/${rows.length} ${(row.file_name || row.id).slice(0, 40)}`;
  try {
    const meta = await drive.files.get({ fileId: row.drive_file_id, fields: "mimeType", supportsAllDrives: true });
    const res = await drive.files.get({ fileId: row.drive_file_id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    const buf = Buffer.from(res.data);
    if (buf.length === 0) { failed.push({ id: row.id, reason: "empty" }); console.log(`x ${tag}: empty`); continue; }
    const key = candidateKey(row.user_id, `${row.drive_file_id}_${row.file_name || "document"}`);
    const size = await r2Put(key, buf, meta.data.mimeType || "application/octet-stream");
    if (size !== -1 && size !== buf.length) { failed.push({ id: row.id, reason: `size ${size}!=${buf.length}` }); console.log(`x ${tag}: size mismatch`); continue; }
    const { error: ue } = await db.from("documents").update({ r2_key: key }).eq("id", row.id);
    if (ue) { failed.push({ id: row.id, reason: `db ${ue.message}` }); console.log(`x ${tag}: db ${ue.message}`); continue; }
    copied++;
    if (copied <= 2 || copied % 15 === 0) console.log(`. ${copied} copied  (${tag}, ${buf.length}b)`);
  } catch (e) {
    failed.push({ id: row.id, reason: e instanceof Error ? e.message : String(e) });
    console.log(`x ${tag}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(`\nDONE: copied ${copied}, failed ${failed.length}`);
if (failed.length) console.log(JSON.stringify(failed.slice(0, 25), null, 2));
