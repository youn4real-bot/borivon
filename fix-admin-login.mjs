// Run once to fix admin login: node fix-admin-login.mjs
// Delete this file after it works.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lobmtvfvrnlkngrqxgkb.supabase.co";
const SERVICE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvYm10dmZ2cm5sa25ncnF4Z2tiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg2NjE1MSwiZXhwIjoyMDkyNDQyMTUxfQ.g5XB7kWbzGDYc4pLTyC1uENF09129bCZBvv6N1Kg52w";
const ADMIN_EMAIL  = "youn4real@gmail.com";
const NEW_PASSWORD = "Borivon2026!";

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log("Looking up your account…");

let userId = null;
let page = 1;
while (true) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 50 });
  if (error) { console.error("Error:", error.message); process.exit(1); }
  const found = (data?.users ?? []).find(u => u.email?.toLowerCase() === ADMIN_EMAIL);
  if (found) { userId = found.id; break; }
  if ((data?.users ?? []).length < 50) break;
  page++;
}

if (!userId) {
  console.error("Account not found. Check the email address.");
  process.exit(1);
}

const { error } = await db.auth.admin.updateUserById(userId, {
  password: NEW_PASSWORD,
  email_confirm: true,
});

if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}

console.log("\n✅ Done! Your account is fixed.");
console.log(`\n   Email:    ${ADMIN_EMAIL}`);
console.log(`   Password: ${NEW_PASSWORD}`);
console.log("\n   Go log in now. Then delete this file.\n");
