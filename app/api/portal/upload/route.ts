import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { makeDrivePublic } from "@/lib/passport-pdf";
import { natToLang } from "@/lib/countries";
import { PassThrough } from "stream";

/**
 * Normalize any country value (ISO 3166-1 alpha-3 like "MAR", or a name in
 * any language) to the canonical German display name (e.g. "Marokko").
 * Storing the German name everywhere lets the dashboard / public profile /
 * admin views translate to the viewer's language via natToLang(value, lang)
 * without ever leaking a raw 3-letter code to the UI.
 */
function normalizeCountry(value: string | null | undefined): string {
  if (!value) return "";
  return natToLang(value, "de") || "";
}

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID ?? "";

/** Read the first bytes of a buffer and infer the actual MIME type
   (browser-supplied `file.type` is trivial to spoof). Returns null if the
   format isn't one we explicitly recognize — in that case we fall back to
   the browser-claimed type. */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // PDF: "%PDF"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length >= 8
      && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
      && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) {
    return "image/png";
  }
  // WebP: starts with "RIFF" then "WEBP" at offset 8
  if (buf.length >= 12
      && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

const FILE_KEY_MAP: Record<string, { name: string; suffix: string }> = {
  cv:           { name: "lebenslauf",        suffix: "original" },
  diploma:      { name: "diplom",            suffix: "original" },
  id:           { name: "ausweis",           suffix: "original" },
  langcert:     { name: "sprachzertifikat",  suffix: "original" },
  workcert:     { name: "arbeitszeugnis",    suffix: "original" },
  letter:       { name: "anschreiben",       suffix: "original" },
  studyprog:            { name: "studienprogramm",   suffix: "original" },
  transcript:           { name: "notenblatt",        suffix: "original" },
  abitur:               { name: "abitur",            suffix: "original" },
  abitur_transcript:    { name: "abitur_notenblatt", suffix: "original" },
  praktikum:            { name: "praktikum",         suffix: "original" },
  other:                { name: "dokument",          suffix: "original" },
  work_experience:      { name: "berufserfahrung",   suffix: "original" },
  cv_de:                { name: "lebenslauf",        suffix: "uebersetzt" },
  diploma_de:           { name: "diplom",            suffix: "uebersetzt" },
  studyprog_de:         { name: "studienprogramm",   suffix: "uebersetzt" },
  transcript_de:        { name: "notenblatt",        suffix: "uebersetzt" },
  abitur_de:            { name: "abitur",            suffix: "uebersetzt" },
  abitur_transcript_de: { name: "abitur_notenblatt", suffix: "uebersetzt" },
  praktikum_de:         { name: "praktikum",         suffix: "uebersetzt" },
  workcert_de:          { name: "berufserlaubnis",   suffix: "uebersetzt" },
  work_experience_de:   { name: "berufserfahrung",   suffix: "uebersetzt" },
  other_trans:          { name: "dokument",          suffix: "uebersetzt" },
};

function buildFileName(firstName: string, lastName: string, fileKey: string, ext: string) {
  const fn = firstName.trim().toLowerCase().replace(/\s+/g, "_") || "kandidat";
  const ln = lastName.trim().toLowerCase().replace(/\s+/g, "_") || "unbekannt";
  const mapping = FILE_KEY_MAP[fileKey] ?? { name: "dokument", suffix: "original" };
  return `${fn}_${ln}_${mapping.name}_${mapping.suffix}.${ext}`;
}

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

async function getVisionToken(): Promise<string> {
  const jwt = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/cloud-vision"],
  });
  const res = await jwt.getAccessToken();
  if (!res.token) throw new Error("Could not obtain Vision API access token");
  return res.token;
}

/** Escape a string for safe inclusion in a Drive `q` query (single-quote delimited). */
function escapeDriveQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function getOrCreateFolder(drive: ReturnType<typeof google.drive>, name: string, parentId: string): Promise<string> {
  const safeName = escapeDriveQ(name);
  const safeParent = escapeDriveQ(parentId);
  const res = await drive.files.list({
    q: `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${safeParent}' in parents and trashed=false`,
    fields: "files(id)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id!;
  const folder = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  return folder.data.id!;
}

// ── Country display name → ISO 3166-1 alpha-3 ────────────────────────────────
const COUNTRY_TO_ISO: Record<string, string> = {
  // Morocco
  MAROC:"MAR",MOROCCO:"MAR",MAROKKO:"MAR",
  // Algeria
  ALGERIE:"DZA",ALGERIA:"DZA",ALGERIEN:"DZA",
  // Tunisia
  TUNISIE:"TUN",TUNISIA:"TUN",TUNESIEN:"TUN",
  // Egypt
  EGYPTE:"EGY",EGYPT:"EGY",AGYPTEN:"EGY",AEGYPTEN:"EGY",
  // Libya
  LIBYE:"LBY",LIBYA:"LBY",LIBYEN:"LBY",
  // Syria
  SYRIE:"SYR",SYRIA:"SYR",SYRIEN:"SYR",
  // Lebanon
  LIBAN:"LBN",LEBANON:"LBN",LIBANON:"LBN",
  // Jordan
  JORDANIE:"JOR",JORDAN:"JOR",JORDANIEN:"JOR",
  // France
  FRANCE:"FRA",FRANKREICH:"FRA",
  // Germany
  ALLEMAGNE:"DEU",GERMANY:"DEU",DEUTSCHLAND:"DEU",
  // Spain
  ESPAGNE:"ESP",SPAIN:"ESP",SPANIEN:"ESP",
  // Italy
  ITALIE:"ITA",ITALY:"ITA",ITALIEN:"ITA",
  // UK
  ROYAUMEUNI:"GBR","UNITED KINGDOM":"GBR",VEREINIGTESKÖNIGREICH:"GBR",
  // Turkey
  TURQUIE:"TUR",TURKEY:"TUR",TURKEI:"TUR",TÜRKEI:"TUR",
  // Africa
  SENEGAL:"SEN",NIGERIA:"NGA",GHANA:"GHA",MALI:"MLI",
  MAURITANIE:"MRT",MAURITANIA:"MRT",MAURETANIEN:"MRT",
  COTEDIVOIRE:"CIV",IVOIRYCOAST:"CIV",ELFENBEINKUSTE:"CIV",
  CAMEROUN:"CMR",CAMEROON:"CMR",KAMERUN:"CMR",
  CONGODR:"COD",DRCONGO:"COD",KONGO:"COD",
  ETHIOPIE:"ETH",ETHIOPIA:"ETH",ATHIOPIEN:"ETH",
  KENYA:"KEN",TANZANIE:"TZA",TANZANIA:"TZA",TANSANIA:"TZA",
  OUGANDA:"UGA",UGANDA:"UGA",
  AFRIQUEDUSUD:"ZAF",SOUTHAFRICA:"ZAF",SUDAFRIKA:"ZAF",
  SOUDAN:"SDN",SUDAN:"SDN",
  SOMALIE:"SOM",SOMALIA:"SOM",
  GUINEE:"GIN",GUINEA:"GIN",
  BURKINAFASO:"BFA",
  NIGER:"NER",TCHAD:"TCD",CHAD:"TCD",TSCHAD:"TCD",
  ANGOLA:"AGO",MOZAMBIQUE:"MOZ",MOSAMBIK:"MOZ",
  ZAMBIE:"ZMB",ZAMBIA:"ZMB",SAMBIA:"ZMB",
  ZIMBABWE:"ZWE",SIMBABWE:"ZWE",
  BOTSWANA:"BWA",NAMIBIE:"NAM",NAMIBIA:"NAM",
  MALAWI:"MWI",RWANDA:"RWA",RUANDA:"RWA",
  BURUNDI:"BDI",DJIBOUTI:"DJI",DSCHIBUTI:"DJI",
  ERYTHREE:"ERI",ERITREA:"ERI",
  GAMBIE:"GMB",GAMBIA:"GMB",
  SIERRALEONE:"SLE",LIBERIA:"LBR",
  BENIN:"BEN",TOGO:"TGO",GABON:"GAB",GABUN:"GAB",
  MADAGASCAR:"MDG",MAURICE:"MUS",MAURITIUS:"MUS",
  CAPVERT:"CPV",CAPEVERDE:"CPV",KAPVERDE:"CPV",
  // Middle East
  PALESTINE:"PSE",IRAK:"IRQ",IRAQ:"IRQ",
  IRAN:"IRN",ARABIE:"SAU",SAUDIARABIA:"SAU",
  EMIRATS:"ARE",UAE:"ARE",VAE:"ARE",
  QATAR:"QAT",KATAR:"QAT",
  KOWEIT:"KWT",KUWAIT:"KWT",
  BAHREIN:"BHR",BAHRAIN:"BHR",
  OMAN:"OMN",YEMEN:"YEM",JEMEN:"YEM",
  // Europe
  PORTUGAL:"PRT",BELGIQUE:"BEL",BELGIUM:"BEL",BELGIEN:"BEL",
  PAYSBAS:"NLD",NETHERLANDS:"NLD",NIEDERLANDE:"NLD",
  LUXEMBOURG:"LUX",
  SUISSE:"CHE",SWITZERLAND:"CHE",SCHWEIZ:"CHE",
  AUTRICHE:"AUT",AUSTRIA:"AUT",OSTERREICH:"AUT",
  GRECE:"GRC",GREECE:"GRC",GRIECHENLAND:"GRC",
  POLOGNE:"POL",POLAND:"POL",POLEN:"POL",
  TCHEQUE:"CZE",CZECH:"CZE",TSCHECHIEN:"CZE",
  SLOVAQUIE:"SVK",SLOVAKIA:"SVK",SLOWAKEI:"SVK",
  HONGRIE:"HUN",HUNGARY:"HUN",UNGARN:"HUN",
  ROUMANIE:"ROU",ROMANIA:"ROU",RUMANIEN:"ROU",
  BULGARIE:"BGR",BULGARIA:"BGR",BULGARIEN:"BGR",
  CROATIE:"HRV",CROATIA:"HRV",KROATIEN:"HRV",
  SERBIE:"SRB",SERBIA:"SRB",SERBIEN:"SRB",
  ALBANIE:"ALB",ALBANIA:"ALB",ALBANIEN:"ALB",
  SLOVENIE:"SVN",SLOVENIA:"SVN",SLOWENIEN:"SVN",
  LITUANIE:"LTU",LITHUANIA:"LTU",LITAUEN:"LTU",
  LETTONIE:"LVA",LATVIA:"LVA",LETTLAND:"LVA",
  ESTONIE:"EST",ESTONIA:"EST",ESTLAND:"EST",
  FINLANDE:"FIN",FINLAND:"FIN",FINNLAND:"FIN",
  SUEDE:"SWE",SWEDEN:"SWE",SCHWEDEN:"SWE",
  NORVEGE:"NOR",NORWAY:"NOR",NORWEGEN:"NOR",
  DANEMARK:"DNK",DENMARK:"DNK",
  ISLANDE:"ISL",ICELAND:"ISL",ISLAND:"ISL",
  IRLANDE:"IRL",IRELAND:"IRL",IRLAND:"IRL",
  MALTE:"MLT",MALTA:"MLT",
  CHYPRE:"CYP",CYPRUS:"CYP",ZYPERN:"CYP",
  RUSSIE:"RUS",RUSSIA:"RUS",RUSSLAND:"RUS",
  UKRAINE:"UKR",BIELORUSSIE:"BLR",BELARUS:"BLR",
  MOLDAVIE:"MDA",MOLDOVA:"MDA",
  GEORGIE:"GEO",GEORGIA:"GEO",GEORGIEN:"GEO",
  ARMENIE:"ARM",ARMENIA:"ARM",ARMENIEN:"ARM",
  AZERBAIDJAN:"AZE",AZERBAIJAN:"AZE",ASERBAIDSCHAN:"AZE",
  // Central Asia
  KAZAKHSTAN:"KAZ",KASACHSTAN:"KAZ",
  OUZBEKISTAN:"UZB",UZBEKISTAN:"UZB",USBEKISTAN:"UZB",
  TURKMENISTAN:"TKM",KIRGHIZISTAN:"KGZ",KYRGYZSTAN:"KGZ",
  TADJIKISTAN:"TJK",TAJIKISTAN:"TJK",TADSCHIKISTAN:"TJK",
  // Asia
  PAKISTAN:"PAK",INDE:"IND",INDIA:"IND",INDIEN:"IND",
  BANGLADESH:"BGD",BANGLADESCH:"BGD",
  NEPAL:"NPL",SRILANKA:"LKA",
  AFGHANISTAN:"AFG",MYANMAR:"MMR",
  THAILANDE:"THA",THAILAND:"THA",
  VIETNAM:"VNM",VIÊTNAM:"VNM",
  CAMBODGE:"KHM",CAMBODIA:"KHM",KAMBODSCHA:"KHM",
  MALAISIE:"MYS",MALAYSIA:"MYS",
  SINGAPOUR:"SGP",SINGAPORE:"SGP",
  INDONESIE:"IDN",INDONESIA:"IDN",INDONESIEN:"IDN",
  PHILIPPINES:"PHL",PHILIPPINEN:"PHL",
  CHINE:"CHN",CHINA:"CHN",
  JAPON:"JPN",JAPAN:"JPN",
  COREE:"KOR",SOUTHKOREA:"KOR",SUDKOREA:"KOR",
  // Americas
  ETATSUNIS:"USA",UNITEDSTATES:"USA",VEREINIGTESTAATEN:"USA",
  CANADA:"CAN",KANADA:"CAN",
  MEXIQUE:"MEX",MEXICO:"MEX",MEXIKO:"MEX",
  BRESIL:"BRA",BRAZIL:"BRA",BRASILIEN:"BRA",
  ARGENTINE:"ARG",ARGENTINA:"ARG",ARGENTINIEN:"ARG",
  CHILI:"CHL",CHILE:"CHL",
  COLOMBIE:"COL",COLOMBIA:"COL",KOLUMBIEN:"COL",
  PEROU:"PER",PERU:"PER",
  VENEZUELA:"VEN",EQUATEUR:"ECU",ECUADOR:"ECU",
  BOLIVIE:"BOL",BOLIVIA:"BOL",BOLIVIEN:"BOL",
  PARAGUAY:"PRY",URUGUAY:"URY",GUATEMALA:"GTM",
  CUBA:"CUB",KUBA:"CUB",HAITI:"HTI",
  // Oceania
  AUSTRALIE:"AUS",AUSTRALIA:"AUS",AUSTRALIEN:"AUS",
  NOUVELLEZÉLANDE:"NZL",NEWZEALAND:"NZL",NEUSEELAND:"NZL",
};

// ── Nationality ISO code → German adjective ───────────────────────────────────
const NATIONALITY_DE: Record<string, string> = {
  MAR: "marokkanisch", DZA: "algerisch", TUN: "tunesisch",
  EGY: "ägyptisch", LBY: "libysisch", SYR: "syrisch",
  LBN: "libanesisch", JOR: "jordanisch",
  FRA: "französisch", DEU: "deutsch", ESP: "spanisch",
  ITA: "italienisch", GBR: "britisch", TUR: "türkisch",
  SEN: "senegalesisch", NGA: "nigerianisch",
  GHA: "ghanaisch", MLI: "malisch",
  PSE: "palästinensisch", IRQ: "irakisch", IRN: "iranisch",
  PAK: "pakistanisch", IND: "indisch", PHL: "philippinisch",
  MRT: "mauretanisch",
};

// ── VIZ (Visual Inspection Zone) parser ──────────────────────────────────────
function parseVIZ(ocrText: string): {
  city_of_birth: string; country_of_birth: string;
  issuing_authority: string; issue_date: string;
  address_street: string; city_of_residence: string;
} {
  const lines = ocrText.split("\n").map(l => l.trim()).filter(Boolean);

  // Normalise: strip accents, uppercase
  function norm(s: string) {
    return s.toUpperCase()
      .replace(/[éèêëế]/g, "E").replace(/[àâäã]/g, "A")
      .replace(/[îï]/g, "I").replace(/[ôöõ]/g, "O").replace(/[ùûü]/g, "U")
      .replace(/[ç]/g, "C").replace(/[ñ]/g, "N").replace(/[ß]/g, "SS");
  }

  // Is this line a label-only header (contains known label keywords)?
  const KNOWN_LABELS = [
    "NOM", "PRENOM", "SURNAME", "GIVEN", "NAME", "VORNAME",
    "NAISSANCE", "BIRTH", "GEBURT", "LIEU", "PLACE",
    "DATE", "DATUM", "DELIVRANCE", "ISSUE", "EXPIR", "ABLAUF",
    "SEXE", "SEX", "GESCHLECHT", "NATIONALITE", "NATIONALITY", "STAATSANGE",
    "AUTORITE", "AUTHORITY", "BEHORDE", "ORGANISME",
    "DOMICILE", "RESIDENCE", "ADRESSE", "WOHNSITZ",
    "PASSEPORT", "PASSPORT", "NUMÉRO", "NUMBER", "NUMMER",
    "SIGNATURE",
  ];
  function isLabel(s: string): boolean {
    const u = norm(s);
    return KNOWN_LABELS.some(k => u.includes(k));
  }

  // Is this a MRZ line?
  function isMRZ(s: string): boolean {
    return /^[A-Z0-9<]{20,}$/.test(s.replace(/\s/g, ""));
  }

  function looksLikeDate(s: string): boolean {
    return /\d{2}[\.\-\/]\d{2}[\.\-\/]\d{2,4}/.test(s) ||
           /\d{4}[\.\-\/]\d{2}[\.\-\/]\d{2}/.test(s) ||
           /\b\d{2}\s+\w{3,}\s+\d{4}\b/.test(s);
  }
  function notADate(s: string): boolean { return !looksLikeDate(s) && s.length > 2; }
  function isUsableValue(s: string): boolean {
    return !isMRZ(s) && s.length > 1;
  }

  // Find up to `maxHits` non-MRZ, non-empty values after the first line that
  // contains any of the given keywords. Returns [] if not found.
  function findAfterLabel(keywords: string[], maxHits = 4): string[] {
    for (let i = 0; i < lines.length; i++) {
      const u = norm(lines[i]);
      if (keywords.some(k => u.includes(k))) {
        // Same-line value (after colon or slash)?
        const sameLineParts = lines[i].split(/[:\/]/);
        const sameLineVal = sameLineParts.length > 1
          ? sameLineParts[sameLineParts.length - 1].trim()
          : "";

        const results: string[] = [];
        if (sameLineVal.length > 1 && !keywords.some(k => norm(sameLineVal).includes(k))) {
          results.push(sameLineVal);
        }
        for (let j = i + 1; j < Math.min(i + 10, lines.length) && results.length < maxHits; j++) {
          const next = lines[j].trim();
          if (next && isUsableValue(next) && !keywords.some(k => norm(next).includes(k))) {
            results.push(next);
          }
        }
        if (results.length > 0) return results;
      }
    }
    return [];
  }

  // ── Issuing authority ────────────────────────────────────────────────────────
  // Must be mostly letters (≥60%), not start with a digit, and not contain date-related keywords
  function looksLikeAuthority(s: string): boolean {
    const u = s.toUpperCase();
    const DATE_WORDS = ["DATE", "DELIVRANCE", "EMISSION", "ISSUE", "EXPIR",
                        "NAISSANCE", "BIRTH", "AUSSTELLUNG", "ABLAUF", "VALIDITY"];
    if (DATE_WORDS.some(w => u.includes(w))) return false;
    const letters = (s.match(/[A-Za-zÀ-ÿ\s]/g) ?? []).length;
    return s.length > 3 && letters / s.length >= 0.6 && !/^\d/.test(s.trim());
  }
  const authorityVals = findAfterLabel([
    "AUTORITE", "AUTHORITY", "BEHORDE", "ORGANISME",
  ]);
  const issuing_authority = authorityVals.find(v => notADate(v) && looksLikeAuthority(v)) ?? "";

  // ── Issue date ───────────────────────────────────────────────────────────────
  // Moroccan passports: "DATE DE DELIVRANCE / DATE OF ISSUE" then date on next line
  const issueDateVals = findAfterLabel([
    "DATE DE DELIVRANCE", "DATE D<EMISSION", "DATE OF ISSUE",
    "AUSGABEDATUM", "DATUM DER AUSSTELLUNG",
  ]);
  const rawIssueDate = issueDateVals.find(looksLikeDate) ?? "";
  const issue_date = normalizeDate(rawIssueDate);

  // ── Place of birth ───────────────────────────────────────────────────────────
  // Moroccan passports: "LIEU ET DATE DE NAISSANCE / PLACE AND DATE OF BIRTH"
  // Value line may contain both city + date: "CASABLANCA 19.05.1999" or just city
  const birthVals = findAfterLabel([
    "LIEU ET DATE", "LIEU DE NAISSANCE", "PLACE AND DATE", "PLACE OF BIRTH",
    "GEBURTSORT", "NAISSANCE",
  ]);
  // Pick the first value that either looks like a date or is plain text
  // Strip any date tokens from the birth value to extract only the city name
  let rawBirth = birthVals[0] ?? "";
  // Remove date-like tokens (dd.mm.yyyy, dd/mm/yyyy, yyyy-mm-dd)
  rawBirth = rawBirth
    .replace(/\d{2}[\.\-\/]\d{2}[\.\-\/]\d{2,4}/g, "")
    .replace(/\d{4}[\.\-\/]\d{2}[\.\-\/]\d{2}/g, "")
    .trim();
  // Split on whitespace: city then country (e.g., "CASABLANCA MAROC" or "RABAT /MAROC")
  const birthParts = rawBirth.split(/\s+/).filter(Boolean);
  // Strip slashes and non-alpha before country lookup ("/ MAROC" → "MAROC")
  const rawLastToken = birthParts.length > 1 ? birthParts[birthParts.length - 1] : "";
  const cleanLastToken = rawLastToken.toUpperCase().replace(/[^A-Z]/g, "");
  const isoFromLast = COUNTRY_TO_ISO[cleanLastToken] ?? (MRZ_COUNTRIES.has(cleanLastToken) ? cleanLastToken : "");
  const city_of_birth = isoFromLast
    ? birthParts.slice(0, -1).join(" ").replace(/[\/\\]/g, "").trim()
    : birthParts.join(" ").replace(/[\/\\]/g, "").trim();
  const country_of_birth = isoFromLast;

  // ── Address — "DOMICILE / RESIDENCE / WOHNSITZ" ──────────────────────────────
  const addrVals = findAfterLabel(["DOMICILE", "RESIDENCE", "WOHNSITZ", "ADRESSE"]);
  const addrFiltered = addrVals.filter(v => !isLabel(v) && notADate(v));

  // Detect "CITY /COUNTRY" pattern (e.g. "RABAT /MAROC") — not a real street address
  function looksLikeCityCountry(s: string): boolean {
    return /^[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ\s]+(\/[A-Z]+)?$/.test(s.toUpperCase().trim()) && s.includes("/");
  }

  let address_street    = addrFiltered[0] ?? "";
  let city_of_residence = "";

  // Also strip any lone "/COUNTRY" or "/MAR" fragments
  function looksLikeCountryFragment(s: string): boolean {
    return /^\/[A-Z]{2,3}$/.test(s.trim().toUpperCase());
  }

  if (looksLikeCityCountry(address_street)) {
    // e.g. "RABAT /MAROC" → city=RABAT, clear street
    city_of_residence = address_street.split(/\s*[\/\\]\s*/)[0].trim();
    address_street    = "";
    // Next line (if any) might be the actual street
    if (addrFiltered[1] && !looksLikeCityCountry(addrFiltered[1]) && !looksLikeCountryFragment(addrFiltered[1])) {
      address_street = addrFiltered[1];
    }
  } else if (looksLikeCountryFragment(address_street)) {
    // e.g. "/MAR" alone — just clear it
    address_street = "";
  } else {
    // Normal: first line = street, second line = "CITY /COUNTRY"
    const rawCityLine = addrFiltered[1] ?? "";
    city_of_residence = rawCityLine ? rawCityLine.split(/\s*[\/\\]\s*/)[0].trim() : "";
  }

  // Sanitize city_of_residence: strip digits, keep only letters/spaces/hyphens, discard if < 3 chars
  city_of_residence = city_of_residence.replace(/[^A-Za-zÀ-ÿ\s'\-]/g, "").replace(/\s+/g, " ").trim();
  if (city_of_residence.length < 3) city_of_residence = "";

  return { city_of_birth, country_of_birth, issuing_authority, issue_date, address_street, city_of_residence };
}

function normalizeDate(s: string): string {
  if (!s) return "";
  // YYYY-MM-DD → DD.MM.YYYY
  const m1 = s.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
  if (m1) return `${m1[3]}.${m1[2]}.${m1[1]}`;
  // DD/MM/YYYY or DD-MM-YYYY → DD.MM.YYYY
  const m2 = s.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m2) return `${m2[1]}.${m2[2]}.${m2[3]}`;
  // Already DD.MM.YYYY
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  // DD.MM.YY → DD.MM.YYYY (2-digit year: >currentYear+2 → 1900s, else 2000s)
  const m3 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (m3) {
    const yy = parseInt(m3[3], 10);
    const cutoff = (new Date().getFullYear() % 100) + 2;
    const full = yy > cutoff ? 1900 + yy : 2000 + yy;
    return `${m3[1]}.${m3[2]}.${full}`;
  }
  return s;
}

// ── MRZ check-digit (ICAO 9303) ───────────────────────────────────────────────
function mrzCheck(s: string): number {
  const W = [7, 3, 1];
  const V: Record<string, number> = {
    "<": 0, "0": 0, "1": 1, "2": 2, "3": 3, "4": 4,
    "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17,
    I: 18, J: 19, K: 20, L: 21, M: 22, N: 23, O: 24, P: 25,
    Q: 26, R: 27, S: 28, T: 29, U: 30, V: 31, W: 32, X: 33,
    Y: 34, Z: 35,
  };
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += (V[s[i]] ?? 0) * W[i % 3];
  return sum % 10;
}

// Known ICAO 3-letter country codes used in MRZ
const MRZ_COUNTRIES = new Set([
  "MAR","DZA","TUN","EGY","LBY","SYR","LBN","JOR","FRA","DEU","GBR","USA",
  "ESP","ITA","TUR","SEN","NGA","GHA","MLI","PSE","IRQ","IRN","PAK","IND",
  "PHL","MRT","BEL","NLD","CHE","AUT","PRT","GRC","POL","ROU","BGR","HRV",
  "SRB","ALB","CAN","AUS","NZL","JPN","CHN","KOR","BRA","ARG","MEX","ZAF",
  "ETH","KEN","TZA","UGA","RUS","UKR","SAU","ARE","QAT","KWT","BHR","OMN",
  "YEM","CIV","CMR","COD","SOM","SDN","LKA","BGD","NPL","MMR","VNM","THA",
  "IDN","MYS","SGP","PHL","HKG","TWN","AFG","UZB","KAZ","AZE","GEO",
  "D<<",  // Germany in older MRZ
]);

// ── MRZ parser (TD3 — two lines of 44 chars) ─────────────────────────────────
function parseMRZ(ocrText: string) {

  // ── Step 1: normalise each OCR line into a MRZ-safe string ────────────────
  // Important: we do NOT replace O→0 here because names contain the letter O.
  // We only do it when inspecting numeric positions (DOB, expiry, check digits).
  const rawLines = ocrText.split("\n");
  const cleaned = rawLines.map(l =>
    l.replace(/\s/g, "")           // strip spaces (OCR sometimes inserts them)
     .toUpperCase()
     .replace(/[^A-Z0-9<]/g, "<") // replace unexpected chars with MRZ filler
  );

  // Also try merging consecutive lines in case OCR broke one MRZ row into two
  const candidates: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i].length >= 20) candidates.push(cleaned[i]);
    if (i + 1 < cleaned.length) {
      const merged = cleaned[i] + cleaned[i + 1];
      if (merged.length >= 40) candidates.push(merged);
    }
  }

  // ── Step 2: find MRZ Line 1 with strict country-code anchor ───────────────
  // TD3 Line 1 format: P<CCC[surname]<<[given]<<...
  // The key guard: positions 2-4 must be a known ICAO country code.
  // This rejects "PREFECTURE DE RABAT" → normalized "PREFECTUREDERABAT" whose
  // positions 2-4 are "EFE" (not a country code).
  function findLine1(pool: string[]): string {
    for (const s of pool) {
      if (s[0] !== "P") continue;
      if (s.length < 36) continue;
      // With filler: P<CCC...   Without filler (OCR dropped <): PCCC...
      const withFiller  = s[1] === "<" && MRZ_COUNTRIES.has(s.slice(2, 5));
      const withoutFiller = s[1] !== "<" && MRZ_COUNTRIES.has(s.slice(1, 4));
      if ((withFiller || withoutFiller) && s.includes("<<")) {
        return s.slice(0, 44).padEnd(44, "<");
      }
    }
    return "";
  }

  // ── Step 3: find MRZ Line 2 with DOB + optional check-digit validation ────
  // TD3 Line 2 format: [passport no 9][check][country 3][dob 6][check][sex][expiry 6][check]...
  function findLine2(pool: string[], line1: string): string {
    for (const s of pool) {
      if (s === line1 || s.length < 36) continue;
      // Digits only at DOB positions (13-18) — use O→0 substitution for numeric check
      const numericised = s.replace(/O/g, "0");
      if (!/^\d{6}$/.test(numericised.slice(13, 19))) continue;
      // Extra validation: check digit for passport number (pos 0-8, check at 9)
      const checkChar = parseInt(numericised[9]);
      const calc = mrzCheck(numericised.slice(0, 9).replace(/O/g, "0"));
      if (!isNaN(checkChar) && checkChar !== calc) continue; // wrong check digit
      return s.slice(0, 44).padEnd(44, "<");
    }
    // Relaxed fallback: any 36+ char string with 6 digits at DOB position
    for (const s of pool) {
      if (s === line1 || s.length < 36) continue;
      const num = s.replace(/O/g, "0");
      if (/^\d{6}$/.test(num.slice(13, 19))) {
        return s.slice(0, 44).padEnd(44, "<");
      }
    }
    return "";
  }

  const line1 = findLine1(candidates);
  if (!line1) return null;
  const line2 = findLine2(candidates, line1);
  if (!line2) return null;

  // ── Step 4: extract fields ────────────────────────────────────────────────

  // Names — Line 1 positions 5-43: SURNAME<<GIVEN NAMES
  // Detect whether < at position 1 was present (normal) or OCR dropped it (shifted)
  const nameOffset = line1[1] === "<" ? 5 : 4;
  const nameZone = line1.slice(nameOffset);
  const doubleBrk = nameZone.indexOf("<<");
  let lastName = "", firstName = "";
  if (doubleBrk >= 0) {
    lastName  = nameZone.slice(0, doubleBrk).replace(/</g, " ").trim();
    firstName = nameZone.slice(doubleBrk + 2).replace(/</g, " ").trim();
  } else {
    lastName = nameZone.replace(/</g, " ").trim();
  }
  // MRZ names only contain A-Z — any leftover 0 was an OCR mis-read of O
  const fixOcr = (s: string) => s.replace(/0/g, "O");
  lastName  = fixOcr(lastName);
  firstName = fixOcr(firstName);

  // Passport number — use O→0 for the number portion
  const passportNo  = line2.slice(0, 9).replace(/O/g, "0").replace(/</g, "");
  const nationality = line2.slice(10, 13).replace(/</g, "");
  const dobRaw      = line2.slice(13, 19).replace(/O/g, "0");
  const sex         = line2[20] === "M" ? "M" : (line2[20] === "F" ? "F" : "");
  const expiryRaw   = line2.slice(21, 27).replace(/O/g, "0");

  function yymmdd(s: string, isBirth: boolean): string {
    if (!/^\d{6}$/.test(s)) return "";
    const yy = parseInt(s.slice(0, 2), 10);
    const mm = s.slice(2, 4);
    const dd = s.slice(4, 6);
    // Sliding window: if yy is more than 2 years ahead of current → 1900s, else 2000s
    const cutoff = (new Date().getFullYear() % 100) + 2;
    const year = isBirth ? (yy > cutoff ? 1900 + yy : 2000 + yy) : 2000 + yy;
    return `${dd}.${mm}.${year}`;
  }

  return {
    first_name:      firstName,
    last_name:       lastName,
    dob:             yymmdd(dobRaw, true),
    sex,
    nationality,          // ISO 3-letter code; converted to German adjective on save
    passport_no:     passportNo,
    passport_expiry: yymmdd(expiryRaw, false),
  };
}

// ── Extract all JPEG images embedded inside a PDF buffer ─────────────────────
// Scanned PDFs wrap raw JPEG bytes in a PDF shell. We find them by magic bytes.
function extractJpegsFromPdf(pdfBuffer: Buffer): Buffer[] {
  const SOI = Buffer.from([0xFF, 0xD8, 0xFF]); // JPEG Start Of Image
  const EOI = Buffer.from([0xFF, 0xD9]);        // JPEG End Of Image
  const jpegs: Buffer[] = [];
  let searchFrom = 0;
  while (searchFrom < pdfBuffer.length) {
    const start = pdfBuffer.indexOf(SOI, searchFrom);
    if (start === -1) break;
    // Look for the next EOI after this start
    const end = pdfBuffer.indexOf(EOI, start + 3);
    if (end === -1) break;
    const jpeg = pdfBuffer.subarray(start, end + 2);
    if (jpeg.length > 20_000) { // skip tiny thumbnails / embedded icons
      jpegs.push(jpeg);
    }
    searchFrom = end + 2;
  }
  return jpegs;
}

// ── Azure Document Intelligence — prebuilt passport model ────────────────────
async function analyzePassportAzure(buffer: Buffer): Promise<{
  first_name: string; last_name: string; dob: string; sex: string;
  nationality: string; passport_no: string; passport_expiry: string;
  issue_date: string; city_of_birth: string; country_of_birth: string;
  rawText: string;
} | null> {
  const endpoint = (process.env.AZURE_DOC_INTEL_ENDPOINT ?? "").replace(/\/$/, "");
  const key      = process.env.AZURE_DOC_INTEL_KEY ?? "";
  if (!endpoint || !key) return null; // not configured → caller falls back to Google

  const b64 = buffer.toString("base64");

  // 1 — Submit analysis job (async API)
  const submitRes = await fetch(
    `${endpoint}/documentintelligence/documentModels/prebuilt-idDocument:analyze?api-version=2024-11-30`,
    {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ base64Source: b64 }),
    }
  );
  if (!submitRes.ok) {
    const txt = await submitRes.text();
    throw new Error(`Azure submit ${submitRes.status}: ${txt.slice(0, 300)}`);
  }
  const operationUrl = submitRes.headers.get("Operation-Location");
  if (!operationUrl) throw new Error("Azure: missing Operation-Location header");

  // 2 — Poll until done (usually 5-10 s for a single-page passport)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const pollRes = await fetch(operationUrl, { headers: { "Ocp-Apim-Subscription-Key": key } });
    result = await pollRes.json();
    if (result.status === "succeeded" || result.status === "failed") break;
  }
  if (!result || result.status !== "succeeded") {
    throw new Error(`Azure analysis ${result?.status ?? "timed out"}`);
  }

  const rawText: string = result.analyzeResult?.content ?? "";
  const doc = result.analyzeResult?.documents?.[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const F: Record<string, any> = doc?.fields ?? {};

  // Helper: get string from Azure field object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const str = (f: any) => (f?.valueString ?? f?.content ?? "").trim();
  // Helper: normalise date — Azure returns valueDate as "YYYY-MM-DD"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dt  = (f: any) => normalizeDate(f?.valueDate ?? f?.content ?? "");

  let first_name    = str(F.FirstName  ?? F.GivenNames);
  let last_name     = str(F.LastName   ?? F.Surname);
  const dob           = dt(F.DateOfBirth ?? F.BirthDate);
  const sex           = str(F.Sex).toUpperCase().slice(0, 1);
  const passport_no   = str(F.DocumentNumber);
  const passport_expiry = dt(F.DateOfExpiration ?? F.ExpirationDate ?? F.DateOfExpiry);
  const issue_date    = dt(F.DateOfIssue);

  // Nationality: Azure may return full word ("Moroccan") or ISO code ("MAR")
  let rawNat = str(F.Nationality ?? F.NationalityCode);
  const natKey = rawNat.toUpperCase().replace(/\s+/g, "");
  let nationality = MRZ_COUNTRIES.has(natKey) ? natKey : (COUNTRY_TO_ISO[natKey] ?? rawNat);

  // Place of birth: Azure returns combined "CASABLANCA MAROC" → split city/country
  const rawBirth  = str(F.PlaceOfBirth);
  const bParts    = rawBirth.split(/[\s,\/]+/).filter(Boolean);
  const rawLast   = (bParts[bParts.length - 1] ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const birthIso  = COUNTRY_TO_ISO[rawLast] ?? (MRZ_COUNTRIES.has(rawLast) ? rawLast : "");
  const city_of_birth    = birthIso ? bParts.slice(0, -1).join(" ") : rawBirth;
  const country_of_birth = birthIso;

  // ── MRZ cross-check ───────────────────────────────────────────────────────
  // Azure VIZ reading can pick up extra chars (e.g. "JALALRO" instead of "JALAL").
  // The MRZ zone is machine-printed and more reliable for names + nationality.
  const mrz = parseMRZ(rawText);
  if (mrz) {
    if (mrz.first_name)  first_name  = mrz.first_name;
    if (mrz.last_name)   last_name   = mrz.last_name;
    if (mrz.nationality) nationality = mrz.nationality; // MRZ always wins — machine-printed ISO code
  }

  if (process.env.NODE_ENV !== "production") console.log("[Azure] fields:", { first_name, last_name, dob, sex, nationality, passport_no, passport_expiry, issue_date, city_of_birth, country_of_birth });

  return { first_name, last_name, dob, sex, nationality,
    passport_no, passport_expiry, issue_date, city_of_birth, country_of_birth, rawText };
}

async function runOCR(buffer: Buffer, mimeType: string): Promise<string> {
  const accessToken = await getVisionToken();
  const b64 = buffer.toString("base64");

  if (mimeType === "application/pdf") {
    const res = await fetch("https://vision.googleapis.com/v1/files:annotate", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          inputConfig: { content: b64, mimeType: "application/pdf" },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          pages: [1, 2, 3], // scan first 3 pages — covers multi-page PDFs
        }],
      }),
    });
    const json = await res.json();
    if (process.env.NODE_ENV !== "production") console.log("[Vision PDF] status:", res.status);
    if (json.error) throw new Error(`Vision API: ${json.error.message} (code ${json.error.code})`);
    // Concatenate text from all returned pages
    const pageResponses: {fullTextAnnotation?: {text: string}}[] = json.responses?.[0]?.responses ?? [];
    const text = pageResponses.map((p) => p.fullTextAnnotation?.text ?? "").join("\n");
    if (!text) {
      const inner = json.responses?.[0]?.responses?.[0]?.error;
      if (inner) throw new Error(`Vision inner error: ${inner.message}`);
    }
    return text;
  } else {
    // Image OCR — use DOCUMENT_TEXT_DETECTION for dense passport text / MRZ
    const res = await fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: b64 },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        }],
      }),
    });
    const json = await res.json();
    if (process.env.NODE_ENV !== "production") console.log("[Vision image] status:", res.status);
    if (json.error) throw new Error(`Vision API: ${json.error.message}`);
    return json.responses?.[0]?.fullTextAnnotation?.text ?? "";
  }
}

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
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
  const userId = user.id;

  const formData = await req.formData();
  const file      = formData.get("file")     as File | null;
  const fileType  = (formData.get("fileType")  as string) ?? "Autre";
  const fileKey   = (formData.get("fileKey")   as string) ?? "other";

  // SECURITY: derive firstName/lastName from candidate_profiles (verified user_id),
  // NOT from formData. Otherwise an attacker can supply another candidate's name and
  // upload files into their Drive folder.
  const dbForName = getServiceSupabase();
  const { data: profileRow } = await dbForName
    .from("candidate_profiles")
    .select("first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  const firstName = (profileRow?.first_name ?? "").toString();
  const lastName  = (profileRow?.last_name  ?? "").toString();

  if (!file) return NextResponse.json({ error: "Fichier requis." }, { status: 400 });

  // Passport: PDF only
  if (fileKey === "id" && file.type !== "application/pdf") {
    return NextResponse.json({ error: "PDF uniquement pour le passeport." }, { status: 415 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Type non autorisé." }, { status: 415 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Fichier trop volumineux. Maximum 10 Mo." }, { status: 413 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Sniff the first few bytes — a browser-supplied MIME like "application/pdf"
  // is trivial to spoof, so we verify the actual content matches before
  // shipping the file off to Drive / OCR. Reject obvious mismatches.
  const sniffedType = sniffMime(buffer);
  if (sniffedType && file.type !== sniffedType) {
    // Allow image/jpg ↔ image/jpeg and other trivial aliases.
    const norm = (t: string) => t.replace("image/jpg", "image/jpeg");
    if (norm(file.type) !== norm(sniffedType)) {
      return NextResponse.json({ error: "Le contenu du fichier ne correspond pas à son type." }, { status: 415 });
    }
  }

  // ── Google Drive upload ───────────────────────────────────────────────────────
  let driveFileId: string | null = null;
  let structuredName = file.name;
  try {
    const drive = getDriveClient();
    const folderName = firstName && lastName ? `${firstName.trim()} ${lastName.trim()}` : userId;
    const candidateFolderId = await getOrCreateFolder(drive, folderName, ROOT_FOLDER_ID);
    const ext = file.name.split(".").pop() ?? "bin";

    // For the "other" multi-doc slot we (a) put files in a "sonstiges"
    // subfolder under the candidate's main folder, and (b) name them with
    // an incrementing index (sonstiges_1, sonstiges_2, …) so admin Drive
    // browsing stays tidy and no two files clash.
    let folderId = candidateFolderId;
    if (fileKey === "other") {
      folderId = await getOrCreateFolder(drive, "sonstiges", candidateFolderId);
      // Determine the next index by counting existing "other" docs for this
      // user. Both DB rows and the Drive folder are kept in sync at upload
      // time, so document count is a reliable next-index source.
      const dbForCount = getServiceSupabase();
      const { count: priorCount } = await dbForCount
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("file_type", fileType);
      const idx = (priorCount ?? 0) + 1;
      const fn = (firstName.trim().toLowerCase().replace(/\s+/g, "_") || "kandidat");
      const ln = (lastName.trim().toLowerCase().replace(/\s+/g, "_")  || "unbekannt");
      structuredName = `${fn}_${ln}_sonstiges_${idx}.${ext}`;
    } else {
      structuredName = buildFileName(firstName, lastName, fileKey, ext);
    }

    const stream = new PassThrough();
    stream.end(buffer);
    const driveRes = await drive.files.create({
      requestBody: { name: structuredName, parents: [folderId] },
      media: { mimeType: file.type, body: stream },
      fields: "id",
      supportsAllDrives: true,
    });
    driveFileId = driveRes.data.id ?? null;
    if (driveFileId) await makeDrivePublic(drive, driveFileId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Drive upload error:", msg);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // ── Supabase insert ───────────────────────────────────────────────────────────
  const db = getServiceSupabase();
  const { error: dbErr } = await db.from("documents").insert({
    user_id: userId, file_name: structuredName,
    file_path: `gdrive/${userId}/${Date.now()}`,
    file_type: fileType, drive_file_id: driveFileId,
  });
  if (dbErr) {
    console.error("DB insert error:", dbErr);
    return NextResponse.json({ error: "Erreur d'enregistrement." }, { status: 500 });
  }

  // Admin notification — `user_email` MUST be populated so the click-through
  // (`/api/portal/admin/notifications/<id>/doc`) can resolve the user_id.
  // Name resolution priority — fall back layer by layer so the admin never
  // sees "Unknown" when ANY of the standard name fields are populated:
  //   1. candidate_profiles.first_name + last_name (passport-OCR populated)
  //   2. auth.users.user_metadata.full_name (set at signup)
  //   3. auth.users.user_metadata.first_name + last_name
  //   4. email local-part (e.g. "saad.tahari" from "saad.tahari@gmail.com")
  //   5. Literal "Unknown" (only if everything else is empty)
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const metaFull  = typeof meta?.full_name  === "string" ? meta.full_name.trim()  : "";
  const metaFirst = typeof meta?.first_name === "string" ? meta.first_name.trim() : "";
  const metaLast  = typeof meta?.last_name  === "string" ? meta.last_name.trim()  : "";
  const userEmail = (user.email ?? "").toLowerCase();
  const emailLocal = userEmail.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  const fullName =
    [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") ||
    metaFull ||
    [metaFirst, metaLast].filter(Boolean).join(" ") ||
    emailLocal ||
    "Unknown";
  await db.from("admin_notifications").insert({
    type: "upload", user_name: fullName, user_email: userEmail,
    doc_type: fileType, doc_name: structuredName,
  }).then(({ error: e }) => { if (e) console.error("Notif error:", e.message); });

  // ── Passport OCR ─────────────────────────────────────────────────────────────
  if (fileKey === "id") {
    try {
      let passportData: Record<string, string> | null = null;

      // ══ Strategy A: Azure Document Intelligence (primary) ══════════════════
      // Passport-specific model — structured JSON out, no parsing needed.
      // Active when AZURE_DOC_INTEL_ENDPOINT + AZURE_DOC_INTEL_KEY are set.
      const azure = await analyzePassportAzure(buffer);

      if (azure) {
        // Azure returned structured fields — use them directly.
        // Still run VIZ on Azure's raw OCR text for fields Azure doesn't extract
        // (address, issuing authority, city of residence).
        const vizData = parseVIZ(azure.rawText);
        if (process.env.NODE_ENV !== "production") console.log("[Azure VIZ]", JSON.stringify(vizData));

        passportData = {
          first_name:        azure.first_name,
          last_name:         azure.last_name,
          dob:               azure.dob,
          sex:               azure.sex,
          // Nationality + country_of_birth are normalized to German names so
          // every downstream view (modal, dashboard, public profile, admin)
          // gets clean text — never a raw "MAR" / "DEU" / etc.
          nationality:       normalizeCountry(azure.nationality)       || azure.nationality,
          passport_no:       azure.passport_no,
          passport_expiry:   azure.passport_expiry,
          issue_date:        azure.issue_date  || vizData.issue_date,
          city_of_birth:     azure.city_of_birth    || vizData.city_of_birth,
          country_of_birth:  normalizeCountry(azure.country_of_birth || vizData.country_of_birth),
          issuing_authority: vizData.issuing_authority,
          address_street:    vizData.address_street,
          address_number:    "",
          address_postal:    "",
          city_of_residence: vizData.city_of_residence,
        };

        // If Azure found nothing meaningful, clear it so we fall to Strategy B
        if (!passportData.first_name && !passportData.last_name && !passportData.passport_no) {
          console.warn("[Azure] returned empty — falling back to Google Vision");
          passportData = null;
        }
      }

      // ══ Strategy B: Google Vision + MRZ/VIZ parser (fallback) ═════════════
      // Used when Azure is not configured or returned nothing.
      if (!passportData) {
        console.log("[OCR] Using Google Vision fallback");

        // Phase 1: standard PDF path
        const ocrText1 = await runOCR(buffer, file.type);
        console.log("[Vision phase1] text (first 800):", ocrText1.slice(0, 800));

        let mrzData = parseMRZ(ocrText1);
        let vizData = parseVIZ(ocrText1);

        // Phase 2: raw JPEG extraction when MRZ not found
        if (!mrzData && file.type === "application/pdf") {
          console.log("[Vision phase2] MRZ not found — trying embedded JPEGs...");
          const jpegs = [...extractJpegsFromPdf(buffer)].sort((a, b) => b.length - a.length);
          console.log(`[Vision phase2] ${jpegs.length} JPEG(s) found`);
          for (const jpeg of jpegs) {
            const ocrText2 = await runOCR(jpeg, "image/jpeg");
            const mrzData2 = parseMRZ(ocrText2);
            if (mrzData2) {
              mrzData = mrzData2;
              vizData = parseVIZ(ocrText2);
              if (process.env.NODE_ENV !== "production") console.log("[Vision phase2] MRZ found in embedded JPEG");
              break;
            }
            if (ocrText2 && !vizData.issuing_authority) vizData = parseVIZ(ocrText2);
          }
        }

        if (process.env.NODE_ENV !== "production") { console.log("MRZ:", JSON.stringify(mrzData)); console.log("VIZ:", JSON.stringify(vizData)); }

        if (mrzData) {
          passportData = {
            ...mrzData,
            // Normalize ISO codes from MRZ to German country names —
            // see normalizeCountry above.
            nationality:       normalizeCountry(mrzData.nationality)       || mrzData.nationality,
            city_of_birth:     vizData.city_of_birth,
            country_of_birth:  normalizeCountry(vizData.country_of_birth),
            issuing_authority: vizData.issuing_authority,
            issue_date:        vizData.issue_date,
            address_street:    vizData.address_street,
            address_number:    "",
            address_postal:    "",
            city_of_residence: vizData.city_of_residence,
          };
        } else if (vizData.issuing_authority || vizData.city_of_birth || vizData.issue_date) {
          // MRZ not found but VIZ extracted something useful — return partial data so the
          // user gets a pre-filled starting point rather than a blank modal
          passportData = {
            first_name:        "", last_name: "", dob: "", sex: "", nationality: "",
            passport_no:       "", passport_expiry: "",
            city_of_birth:     vizData.city_of_birth,
            country_of_birth:  normalizeCountry(vizData.country_of_birth),
            issuing_authority: vizData.issuing_authority,
            issue_date:        vizData.issue_date,
            address_street:    vizData.address_street,
            address_number:    "",
            address_postal:    "",
            city_of_residence: vizData.city_of_residence,
          };
        }
      }

      return NextResponse.json({ success: true, passportData });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Passport OCR error:", msg);
      return NextResponse.json({ success: true, passportData: null, _ocrError: msg });
    }
  }

  return NextResponse.json({ success: true });
}
