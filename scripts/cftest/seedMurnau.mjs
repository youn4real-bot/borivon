// Seed "Ambulante Pflegedienst Murnau" as a PERMANENT direct employer (agency_id
// NULL) so it always shows as a clickable pill in the Zuweisung picker for every
// candidate. Idempotent on slug. Street intentionally omitted (placeholder was
// invented) — name + correct town/PLZ only; admin completes the street later.
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SLUG = "ambulante_pflegedienst_murnau";
const row = {
  slug: SLUG,
  name: "Ambulante Pflegedienst Murnau",
  address_lines: ["Ambulante Pflegedienst Murnau", "82418 Murnau am Staffelsee"],
  agency_id: null,
  active: true,
};

// Don't clobber an existing row's address if the admin already created/edited it.
const { data: existing } = await db.from("employers").select("id, name, address_lines, active, agency_id").eq("slug", SLUG).maybeSingle();
if (existing) {
  console.log("Already exists — leaving address untouched:", JSON.stringify(existing, null, 2));
  if (existing.active === false) {
    await db.from("employers").update({ active: true }).eq("slug", SLUG);
    console.log("Reactivated (active was false).");
  }
} else {
  const { data, error } = await db.from("employers").insert(row).select().single();
  if (error) { console.error("INSERT failed:", error.message); process.exit(1); }
  console.log("Inserted:", JSON.stringify(data, null, 2));
}

// Show all active DIRECT employers (what the picker renders).
const { data: directs } = await db.from("employers")
  .select("name, slug, address_lines, active").is("agency_id", null).eq("active", true).order("name");
console.log("\nActive direct employers (picker pills):");
for (const e of directs ?? []) console.log("  •", e.name, "—", (e.address_lines || []).join(" · "));
