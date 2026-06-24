// Read-only: confirm the Drive→R2 backfill left no gaps. An un-migrated doc
// (drive_file_id set, r2_key NULL) degrades sign-request on Workers (Drive read
// can't run). Counts only — no writes.
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const c = async (filter) => {
  const q = db.from("documents").select("id", { count: "exact", head: true });
  const { count, error } = await filter(q);
  if (error) throw error;
  return count;
};

const total = await c((q) => q);
const withR2 = await c((q) => q.not("r2_key", "is", null));
const withDrive = await c((q) => q.not("drive_file_id", "is", null));
const unmigrated = await c((q) => q.not("drive_file_id", "is", null).is("r2_key", null));
const neither = await c((q) => q.is("r2_key", null).is("drive_file_id", null));

console.log(JSON.stringify({ total, withR2, withDrive, unmigrated_driveButNoR2: unmigrated, neither_noR2_noDrive: neither }, null, 2));

if (unmigrated > 0) {
  // Show a few examples so we can decide whether they matter (active vs archived).
  const { data } = await db.from("documents")
    .select("id, user_id, file_type, file_name, drive_file_id, uploaded_at")
    .not("drive_file_id", "is", null).is("r2_key", null).limit(10);
  console.log("\nUN-MIGRATED examples:\n" + JSON.stringify(data, null, 2));
}
