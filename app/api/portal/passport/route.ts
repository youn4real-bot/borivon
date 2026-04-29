import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { uploadPassportPdfToDrive } from "@/lib/passport-pdf";

// DD.MM.YYYY → YYYY-MM-DD for Postgres date columns
function toIso(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s || null;
}

const NATIONALITY_DE: Record<string, string> = {
  // ISO codes
  MAR: "marokkanisch", DZA: "algerisch",  TUN: "tunesisch",
  EGY: "ägyptisch",   LBY: "libysisch",  SYR: "syrisch",
  LBN: "libanesisch", JOR: "jordanisch",
  FRA: "französisch", DEU: "deutsch",    ESP: "spanisch",
  ITA: "italienisch", GBR: "britisch",   TUR: "türkisch",
  SEN: "senegalesisch", NGA: "nigerianisch",
  GHA: "ghanaisch",   MLI: "malisch",
  PSE: "palästinensisch", IRQ: "irakisch", IRN: "iranisch",
  PAK: "pakistanisch", IND: "indisch",   PHL: "philippinisch",
  MRT: "mauretanisch",
  // French display names
  MAROC: "marokkanisch", ALGERIE: "algerisch", TUNISIE: "tunesisch",
  EGYPTE: "ägyptisch",  LIBYE: "libysisch",   SYRIE: "syrisch",
  LIBAN: "libanesisch", JORDANIE: "jordanisch", FRANCE: "französisch",
  ALLEMAGNE: "deutsch", ESPAGNE: "spanisch",   ITALIE: "italienisch",
  TURQUIE: "türkisch",  SENEGAL: "senegalesisch", NIGERIA: "nigerianisch",
  GHANA: "ghanaisch",   MALI: "malisch",        PALESTINE: "palästinensisch",
  IRAK: "irakisch",     IRAN: "iranisch",        PAKISTAN: "pakistanisch",
  INDE: "indisch",      PHILIPPINES: "philippinisch", MAURITANIE: "mauretanisch",
  // English display names
  MOROCCO: "marokkanisch", ALGERIA: "algerisch",  TUNISIA: "tunesisch",
  EGYPT: "ägyptisch",      LIBYA: "libysisch",    SYRIA: "syrisch",
  LEBANON: "libanesisch",  JORDAN: "jordanisch",
  GERMANY: "deutsch",      SPAIN: "spanisch",     ITALY: "italienisch",
  TURKEY: "türkisch",
  IRAQ: "irakisch",        INDIA: "indisch",      MAURITANIA: "mauretanisch",
  // German display names (identity)
  MAROKKO: "marokkanisch", ALGERIEN: "algerisch", TUNESIEN: "tunesisch",
  AGYPTEN: "ägyptisch",    LIBYEN: "libysisch",   SYRIEN: "syrisch",
  LIBANON: "libanesisch",  JORDANIEN: "jordanisch", FRANKREICH: "französisch",
  DEUTSCHLAND: "deutsch",  SPANIEN: "spanisch",   ITALIEN: "italienisch",
  TURKEI: "türkisch",      INDIEN: "indisch",     MAURETANIEN: "mauretanisch",
  PALASTINA: "palästinensisch",
};

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const jwt = authHeader.slice(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json();
  const {
    first_name, last_name, dob, sex,
    nationality,
    city_of_birth, country_of_birth,
    passport_no, passport_expiry,
    issuing_authority, issue_date,
    address_street, address_number, address_postal,
    city_of_residence, country_of_residence,
    marital_status, children_ages,
  } = body;

  // Convert ISO code or display name → German adjective for nationality
  const natKey = nationality?.trim().toUpperCase() ?? "";
  const nationalityDe = NATIONALITY_DE[natKey] ?? nationality ?? null;
  // Convert ISO code → German country name for country_of_birth
  const COUNTRY_NAME_DE: Record<string, string> = {
    MAR: "Marokko", DZA: "Algerien", TUN: "Tunesien", EGY: "Ägypten",
    LBY: "Libyen", SYR: "Syrien", LBN: "Libanon", JOR: "Jordanien",
    FRA: "Frankreich", DEU: "Deutschland", ESP: "Spanien", ITA: "Italien",
    GBR: "Vereinigtes Königreich", TUR: "Türkei", SEN: "Senegal",
    NGA: "Nigeria", GHA: "Ghana", MLI: "Mali", PSE: "Palästina",
    IRQ: "Irak", IRN: "Iran", PAK: "Pakistan", IND: "Indien",
    PHL: "Philippinen", MRT: "Mauretanien",
  };
  const countryKey = country_of_birth?.trim().toUpperCase() ?? "";
  const countryDe = COUNTRY_NAME_DE[countryKey] ?? country_of_birth ?? null;
  // Normalize sex: W (German) → F (canonical)
  const canonicalSex = sex === "W" ? "F" : (sex || null);

  const profilePayload = {
    user_id:           user.id,
    first_name:        first_name        || null,
    last_name:         last_name         || null,
    dob:               toIso(dob),
    sex:               canonicalSex,
    nationality:       nationality        || null,
    city_of_birth:     city_of_birth      || null,
    country_of_birth:  country_of_birth   || null,
    passport_no:       passport_no       || null,
    passport_expiry:   toIso(passport_expiry),
    issuing_authority: issuing_authority || null,
    issue_date:        toIso(issue_date),
    address_street:      address_street      || null,
    address_number:      address_number      || null,
    address_postal:      address_postal      || null,
    city_of_residence:   city_of_residence   || null,
    country_of_residence: country_of_residence || null,
    marital_status:       marital_status || null,
    children_ages:        children_ages  || null,
    // Mark as pending admin review whenever candidate re-submits passport data
    passport_status:     "pending",
    updated_at:          new Date().toISOString(),
  };

  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").upsert(profilePayload, { onConflict: "user_id" });

  if (error) {
    console.error("Profile upsert error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Auto-upload passport PDF to Google Drive (fire-and-forget, don't block response) ──
  // We do this after successful upsert; errors are logged but don't fail the request
  void (async () => {
    try {
      await uploadPassportPdfToDrive({ ...profilePayload, nationality: nationalityDe, country_of_birth: countryDe });
    } catch (driveErr) {
      console.error("Auto Drive passport PDF upload failed:", driveErr);
    }
  })();

  return NextResponse.json({ success: true });
}
