import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { uploadPassportPdfToDrive } from "@/lib/passport-pdf";

// DD.MM.YYYY → YYYY-MM-DD for Postgres date columns
function toIso(s: string | null | undefined): string | null {
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
  const { data: { user }, error: authErr } = await getAnonVerifyClient().auth.getUser(jwt);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await req.json();

  // Draft autosave: persist the extracted/edited fields to the DB so the
  // data is permanent and loads on ANY device (phone/laptop) at any phase.
  // A draft must NOT mark the passport as submitted-for-review and must NOT
  // regenerate the Drive PDF — only the explicit Submit does that.
  const isDraft = body.__draft === true;

  // Truncate every free-text field before touching the DB.
  // Postgres text columns have no length limit — without this an authenticated
  // candidate could store arbitrarily large strings in their own profile row.
  const cap = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    return v.slice(0, max) || null;
  };

  const first_name        = cap(body.first_name,        100);
  const last_name         = cap(body.last_name,         100);
  const dob               = cap(body.dob,                20);
  const sex               = cap(body.sex,                 2);
  const nationality       = cap(body.nationality,       100);
  const city_of_birth     = cap(body.city_of_birth,     100);
  const country_of_birth  = cap(body.country_of_birth,  100);
  const passport_no       = cap(body.passport_no,        20);
  const passport_expiry   = cap(body.passport_expiry,    20);
  const issuing_authority = cap(body.issuing_authority, 200);
  const issue_date        = cap(body.issue_date,         20);
  const address_street    = cap(body.address_street,    200);
  const address_number    = cap(body.address_number,     20);
  const address_postal    = cap(body.address_postal,     20);
  const city_of_residence   = cap(body.city_of_residence,   100);
  const country_of_residence = cap(body.country_of_residence, 100);
  const marital_status    = cap(body.marital_status,    200);
  const children_ages     = cap(body.children_ages,     200);

  // Per-field confirmation checkboxes — array of known passport field keys.
  const KNOWN_FIELD_KEYS = new Set([
    "first_name","last_name","dob","sex","nationality","city_of_birth",
    "country_of_birth","passport_no","passport_expiry","issuing_authority",
    "issue_date","address_street","address_number","address_postal",
    "city_of_residence","country_of_residence","marital_status","children_ages",
  ]);
  const confirmedFields: string[] = Array.isArray(body.confirmed_fields)
    ? Array.from(new Set(
        (body.confirmed_fields as unknown[])
          .filter((v): v is string => typeof v === "string" && KNOWN_FIELD_KEYS.has(v))
      )).slice(0, 20)
    : [];

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
    passport_confirmed_fields: confirmedFields,
    updated_at:          new Date().toISOString(),
  };

  // Issue 6.1: only reset to "pending" when identity fields actually change.
  // If the passport is "approved" and only address / contact fields changed,
  // keep it approved — the admin already validated the identity data.
  const db = getServiceSupabase();
  const { data: existing } = await db
    .from("candidate_profiles")
    .select("first_name,last_name,dob,sex,nationality,passport_no,passport_expiry,passport_status")
    .eq("user_id", user.id)
    .maybeSingle();

  const IDENTITY_FIELDS = ["first_name","last_name","dob","sex","nationality","passport_no","passport_expiry"] as const;
  const identityChanged = existing?.passport_status === "approved"
    ? IDENTITY_FIELDS.some(k => {
        const oldVal = (existing as Record<string,string|null>)[k] ?? null;
        const newMap: Record<string, string|null> = {
          first_name: first_name || null,
          last_name: last_name || null,
          dob: toIso(dob),
          sex: canonicalSex,
          nationality: nationality || null,
          passport_no: passport_no || null,
          passport_expiry: toIso(passport_expiry),
        };
        return (newMap[k] ?? null) !== (oldVal ?? null);
      })
    : true; // never approved → always set pending

  // Draft: never change the review status (keep whatever it is, or leave
  // unset). Submit: pending on identity change, else keep existing.
  const passportStatusToSave = isDraft
    ? (existing?.passport_status ?? null)
    : (identityChanged ? "pending" : (existing?.passport_status ?? "pending"));

  // Build the upsert. For a draft we omit passport_status entirely when
  // there's no prior value, so a half-filled draft never reads as
  // "submitted". When a status exists we preserve it untouched.
  const upsertRow: Record<string, unknown> = { ...profilePayload };
  if (passportStatusToSave !== null) upsertRow.passport_status = passportStatusToSave;

  const { error } = await db.from("candidate_profiles").upsert(
    upsertRow,
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("Profile upsert error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Notify ALL admins (supreme / sub-admin / assigned org-admin — the admin
  // bell is global, scoping happens on read) ONCE the passport DATA is
  // submitted. Passport FILE upload alone no longer notifies (see
  // /api/portal/upload) — file + data together = the real submission. Fire
  // ONLY on the actual transition into "pending" so autosaves (drafts) and
  // no-op re-saves that don't re-enter review never spam the bell.
  if (!isDraft && passportStatusToSave === "pending" && existing?.passport_status !== "pending") {
    void (async () => {
      try {
        const { data: passDocs } = await db
          .from("documents")
          .select("file_name, file_type")
          .eq("user_id", user.id)
          .ilike("file_type", "%pass%")
          .order("uploaded_at", { ascending: false })
          .limit(1);
        const passDoc = passDocs?.[0];
        const nm = [first_name, last_name].filter(Boolean).join(" ").trim();
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
        const metaFull = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
        const email = (user.email ?? "").toLowerCase();
        const userName =
          nm || metaFull ||
          email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Candidate";
        const { error: notifErr } = await db.from("admin_notifications").insert({
          type: "upload",
          user_name: userName,
          user_email: email,
          doc_type: passDoc?.file_type ?? "Reisepass",
          doc_name: passDoc?.file_name ?? "Reisepass",
        });
        if (notifErr) console.error("[passport] admin_notifications insert failed:", JSON.stringify(notifErr));
      } catch (e) {
        console.error("[passport] admin notify error:", e);
      }
    })();
  }

  // Drive PDF generation only on the explicit Submit — never on autosave.
  if (!isDraft) {
    void (async () => {
      try {
        await uploadPassportPdfToDrive({ ...profilePayload, nationality: nationalityDe, country_of_birth: countryDe });
      } catch (driveErr) {
        console.error("Auto Drive passport PDF upload failed:", driveErr);
      }
    })();
  }

  return NextResponse.json({ success: true });
}
