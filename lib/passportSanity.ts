/**
 * Sanity gates for OCR-extracted passport data.
 *
 * Written after an audit of the live database found that OCR had, on real
 * candidates already marked `approved`:
 *   • stored the passport's own printed captions as data — city_of_birth
 *     "Date of birth", issuing_authority "الإمضاء Signature/Signature",
 *     city_of_birth "الجنسية Nationalité Nationality الجنس Sexe Sex"
 *   • stored the nationality word "Marocaine" as a city of residence
 *   • stored the candidate's own first name as her city of residence
 *   • stored a passport number with a newline in it, "AD308237\nFT"
 *   • stored a passport issued 21 years before its holder was born, one that
 *     expires 4 years before it was issued, and one issued in 2041
 *   • left MRZ `<` filler as trailing spaces on names ("SALMA  ")
 *
 * The rule all of these break: OCR output is a GUESS, and a guess that is
 * provably impossible must not be written. A blank field gets filled in by a
 * human at the confirmation step; an impossible one gets ticked as confirmed and
 * ends up on a visa application. Every function here is a REFUSAL, never a
 * correction — we never invent a value, we only decline to store a wrong one.
 */

/** Control characters. OCR line-bleed is the only way one reaches these fields. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Captions printed on a passport data page, in the languages they appear in. */
const CAPTION_WORDS = [
  // French
  "NOM", "PRENOM", "NAISSANCE", "LIEU", "DATE", "DELIVRANCE", "EMISSION",
  "EXPIRATION", "SEXE", "NATIONALITE", "AUTORITE", "SIGNATURE", "DOMICILE",
  "RESIDENCE", "ADRESSE", "PASSEPORT", "NUMERO", "ROYAUME", "TAILLE",
  // English
  "SURNAME", "GIVEN", "NAME", "BIRTH", "PLACE", "ISSUE", "ISSUING", "EXPIRY",
  "SEX", "NATIONALITY", "AUTHORITY", "PASSPORT", "NUMBER", "KINGDOM", "HOLDER",
  // German
  "VORNAME", "GEBURT", "DATUM", "ABLAUF", "BEHORDE", "WOHNSITZ", "NUMMER",
  "GESCHLECHT", "STAATSANGE", "AUSSTELLUNG", "UNTERSCHRIFT",
];

/** Nationality adjectives that OCR picks up off the nationality line. */
const NATIONALITY_WORDS = [
  "MAROCAINE", "MAROCAIN", "MOROCCAN", "MAROKKANISCH", "MAROKKANISCHE",
  "ALGERIENNE", "ALGERIEN", "ALGERIAN", "TUNISIENNE", "TUNISIAN",
  "FRANCAISE", "FRENCH", "DEUTSCHE", "GERMAN", "ESPAGNOLE", "SPANISH",
];

/** Strip accents + uppercase, so "Nationalité" and "NATIONALITE" compare equal. */
function norm(s: string): string {
  return s
    .toUpperCase()
    .replace(/[ÉÈÊËẾ]/g, "E").replace(/[ÀÂÄÃ]/g, "A")
    .replace(/[ÎÏ]/g, "I").replace(/[ÔÖÕ]/g, "O").replace(/[ÙÛÜ]/g, "U")
    .replace(/[Ç]/g, "C").replace(/[Ñ]/g, "N").replace(/[ß]/g, "SS");
}

/**
 * Does this value look like the passport's printed caption rather than the value
 * underneath it? Arabic captions come through alongside their French/English
 * twin ("الإمضاء Signature/Signature"), so matching the Latin half is enough.
 */
export function looksLikeCaption(value: string): boolean {
  if (!value) return false;
  const u = norm(value);
  if (CAPTION_WORDS.some(w => u.includes(w))) return true;
  // A mostly-Arabic value is caption furniture too: every field we extract here
  // (city, authority) is printed in Latin script on these passports.
  const arabic = (value.match(/[؀-ۿ]/g) ?? []).length;
  return arabic > 0 && arabic >= value.replace(/\s/g, "").length / 2;
}

/** Is this a nationality word ("Marocaine") rather than a place name? */
export function looksLikeNationalityWord(value: string): boolean {
  const u = norm(value).replace(/[^A-Z]/g, "");
  return !!u && NATIONALITY_WORDS.includes(u);
}

/** Trim, collapse whitespace runs, and drop control characters. */
export function cleanScalar(value: string | null | undefined): string {
  return (value ?? "").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Clean a free-text place / authority value, or return "" to store nothing.
 * `ownNames` are the candidate's own name words — "LAMIA" was live as a city of
 * residence because the OCR grabbed the name line instead of the address line.
 */
export function cleanPlaceValue(value: string | null | undefined, ownNames: string[] = []): string {
  const v = cleanScalar(value);
  if (!v) return "";
  if (looksLikeCaption(v)) return "";
  if (looksLikeNationalityWord(v)) return "";
  const u = norm(v).replace(/[^A-Z]/g, "");
  if (ownNames.some(n => n && norm(n).replace(/[^A-Z]/g, "") === u)) return "";
  return v;
}

/**
 * A passport number is alphanumeric and at most 9 characters (ICAO 9303).
 *
 * A value with a control character in it — "AD308237\nFT" was live in
 * production, human-confirmed, on an approved profile — is OCR line-bleed, and
 * the head is NOT trustworthy either: the character that would make it 9 long
 * may be the one that got pushed onto the next line. Refuse the whole value
 * rather than store a plausible-looking wrong number, which is the failure mode
 * nobody catches.
 */
export function cleanPassportNo(value: string | null | undefined): string {
  const raw = value ?? "";
  if (!raw.trim()) return "";
  if (new RegExp(CONTROL_CHARS.source).test(raw)) return "";
  const v = raw.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{6,9}$/.test(v) ? v : "";
}

export type PassportDates = {
  dob?: string | null;
  issue_date?: string | null;
  passport_expiry?: string | null;
};

/**
 * Drop any date that is impossible against the others, and say why.
 *
 * Where two dates contradict each other we cannot tell WHICH one is misread, so
 * both go. `today` is injectable so the rules are testable without the clock.
 */
export function sanePassportDates(
  d: PassportDates,
  today: Date = new Date(),
): { dates: PassportDates; dropped: string[] } {
  const dropped: string[] = [];
  const out: PassportDates = { ...d };
  const at = (v: string | null | undefined) => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t);
  };
  const dob = at(out.dob);

  // Nobody in this pipeline was born before 1930, or is yet to be born.
  if (dob && (dob > today || dob.getUTCFullYear() < 1930)) {
    out.dob = null;
    dropped.push("dob: outside a livable range");
  }
  const born = at(out.dob);

  // A passport cannot be issued in the future, nor before its holder existed.
  const iss = at(out.issue_date);
  if (iss && iss > today) {
    out.issue_date = null;
    dropped.push("issue_date: in the future");
  } else if (iss && born && iss < born) {
    out.issue_date = null;
    dropped.push("issue_date: before date of birth");
  }

  const exp = at(out.passport_expiry);
  const iss2 = at(out.issue_date);
  if (exp && born && exp < born) {
    // A "01.01.1994" parser fallback was live on a candidate born in 1999.
    out.passport_expiry = null;
    dropped.push("passport_expiry: before date of birth");
  } else if (exp && iss2 && exp < iss2) {
    out.passport_expiry = null;
    out.issue_date = null;
    dropped.push("issue_date + passport_expiry: expiry precedes issue, cannot tell which is misread");
  } else if (exp && iss2) {
    // Moroccan passports run 5 or 10 years. Anything else means a year digit was
    // misread — 34-year and 17-year validities were both live in production.
    const years = (exp.getTime() - iss2.getTime()) / (365.2425 * 864e5);
    if (Math.abs(years - 5) > 0.2 && Math.abs(years - 10) > 0.2) {
      out.passport_expiry = null;
      out.issue_date = null;
      dropped.push(`issue_date + passport_expiry: ${years.toFixed(1)}-year validity is not issuable`);
    }
  }
  return { dates: out, dropped };
}
