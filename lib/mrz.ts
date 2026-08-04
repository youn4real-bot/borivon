/**
 * MRZ (Machine Readable Zone) reading — ICAO 9303 TD3, the two 44-character rows
 * at the bottom of every passport.
 *
 * Lifted out of app/api/portal/upload/route.ts so it can be unit-tested without
 * dragging in googleapis, R2 and the rest of the upload pipeline. The route still
 * owns everything around it (OCR calls, Azure cross-check, persistence); this file
 * is pure string work with no I/O.
 */

// ── MRZ check-digit (ICAO 9303) ───────────────────────────────────────────────
export function mrzCheck(s: string): number {
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
export const MRZ_COUNTRIES = new Set([
  "MAR","DZA","TUN","EGY","LBY","SYR","LBN","JOR","FRA","DEU","GBR","USA",
  "ESP","ITA","TUR","SEN","NGA","GHA","MLI","PSE","IRQ","IRN","PAK","IND",
  "PHL","MRT","BEL","NLD","CHE","AUT","PRT","GRC","POL","ROU","BGR","HRV",
  "SRB","ALB","CAN","AUS","NZL","JPN","CHN","KOR","BRA","ARG","MEX","ZAF",
  "ETH","KEN","TZA","UGA","RUS","UKR","SAU","ARE","QAT","KWT","BHR","OMN",
  "YEM","CIV","CMR","COD","SOM","SDN","LKA","BGD","NPL","MMR","VNM","THA",
  "IDN","MYS","SGP","PHL","HKG","TWN","AFG","UZB","KAZ","AZE","GEO",
  "D<<",  // Germany in older MRZ
]);

export type MrzFields = {
  first_name: string;
  last_name: string;
  dob: string;
  sex: string;
  nationality: string;
  passport_no: string;
  passport_expiry: string;
};

/**
 * Split an MRZ name zone ("SURNAME<<GIVEN<NAMES<<<<…") into the two names.
 *
 * ICAO 9303: inside the name field a single `<` separates words and the FIRST
 * `<<` after the given names ENDS the field — everything past it is filler. That
 * terminator is the whole point of this helper. Without it, anything that
 * followed the name zone was read as another given name, and a candidate ended up
 * stored as "IKRAM    EX83287939MAR991OO9OF2" — her own MRZ row 2, glued onto her
 * first name, shown to admins as her name.
 */
export function splitMrzNameZone(nameZone: string): { firstName: string; lastName: string } {
  const doubleBrk = nameZone.indexOf("<<");
  let last = "", first = "";
  if (doubleBrk >= 0) {
    last = nameZone.slice(0, doubleBrk);
    const rest = nameZone.slice(doubleBrk + 2);
    const endOfGiven = rest.indexOf("<<");
    first = endOfGiven >= 0 ? rest.slice(0, endOfGiven) : rest;
  } else {
    last = nameZone;
  }
  // MRZ names only contain A-Z — any leftover 0 was an OCR mis-read of O. Then
  // drop any word that still holds a digit: a real MRZ name cannot contain one,
  // so such a word is document data (passport number, dates) that leaked in.
  const clean = (s: string) =>
    s.replace(/0/g, "O")
     .replace(/</g, " ")
     .split(/\s+/)
     .filter(w => w && !/[0-9]/.test(w))
     .join(" ")
     .trim();
  return { firstName: clean(first), lastName: clean(last) };
}

// ── MRZ parser (TD3 — two lines of 44 chars) ─────────────────────────────────
export function parseMRZ(ocrText: string): MrzFields | null {

  // ── Step 1: normalise each OCR line into a MRZ-safe string ────────────────
  // Important: we do NOT replace O→0 here because names contain the letter O.
  // We only do it when inspecting numeric positions (DOB, expiry, check digits).
  const rawLines = ocrText.split("\n");
  const cleaned = rawLines.map(l =>
    l.replace(/\s/g, "")           // strip spaces (OCR sometimes inserts them)
     .toUpperCase()
     .replace(/[^A-Z0-9<]/g, "<") // replace unexpected chars with MRZ filler
  );

  // Also try merging consecutive lines in case OCR broke one MRZ row into two.
  //
  // ORDER MATTERS: whole lines first, merged pairs only as a fallback. OCR often
  // drops the trailing `<` filler, so a perfectly good Line 1 arrives short
  // ("P<MARAATMAN<<IKRAM<<<<", 22 chars). When merged pairs were allowed to win,
  // the matcher took "<line 1><line 2>" as Line 1 and the given-name field
  // swallowed the whole of Line 2. Singles first, and Line 1's length floor is
  // the length of a real name row, not of a full 44-char MRZ row.
  const singles: string[] = [];
  const mergedPairs: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i].length >= 12) singles.push(cleaned[i]);
    if (i + 1 < cleaned.length) {
      const merged = cleaned[i] + cleaned[i + 1];
      if (merged.length >= 40) mergedPairs.push(merged);
    }
  }
  const candidates: string[] = [...singles, ...mergedPairs];

  // ── Step 2: find MRZ Line 1 with strict country-code anchor ───────────────
  // TD3 Line 1 format: P<CCC[surname]<<[given]<<...
  // The key guard: positions 2-4 must be a known ICAO country code.
  // This rejects "PREFECTURE DE RABAT" → normalized "PREFECTUREDERABAT" whose
  // positions 2-4 are "EFE" (not a country code).
  function findLine1(pool: string[]): string {
    for (const s of pool) {
      if (s[0] !== "P") continue;
      // "P<" + country(3) + a 2-char surname + "<<" + a 2-char given name = 12.
      // Anything shorter cannot carry both names; anything longer is padded to 44
      // below. The real guard here is the country-code anchor + "<<", not length.
      if (s.length < 12) continue;
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
  const { firstName, lastName } = splitMrzNameZone(line1.slice(nameOffset));

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

/**
 * Is this stored name actually a chunk of MRZ that leaked into the name field?
 *
 * Used to repair rows written before splitMrzNameZone terminated the given-name
 * field, and as a last-ditch guard on the write path so a bad OCR read can never
 * be shown to an admin (or printed on a CV) as somebody's name.
 */
export function looksLikeMrzJunk(name: string): boolean {
  if (!name) return false;
  // A real name has no digits and no `<`. Both are MRZ-only characters.
  return /[0-9<]/.test(name);
}

/** Strip MRZ leakage from a stored name, keeping the words that are plausibly a name. */
export function scrubMrzJunk(name: string): string {
  return name
    .replace(/</g, " ")
    .split(/\s+/)
    .filter(w => w && !/[0-9]/.test(w))
    .join(" ")
    .trim();
}
