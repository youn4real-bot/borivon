import { translations } from "./translations";

const KEY_TO_TKEY: Record<string, keyof typeof translations.fr> = {
  id:                   "pTypeID",
  langcert:             "pTypeLangCert",
  diploma:              "pTypeDiploma",
  studyprog:            "pTypeStudyProg",
  transcript:           "pTypeTranscript",
  abitur:               "pTypeAbitur",
  abitur_transcript:    "pTypeAbiturTranscript",
  praktikum:            "pTypePraktikum",
  workcert:             "pTypeWorkCert",
  letter:               "pTypeLetter",
  letter_visa:          "pTypeLetterVisa",
  other:                "pTypeOther",
  work_experience:      "pTypeWorkExp",
  impfung:              "pTypeImpfung",
  cv_de:                "pTypeCVde",
  cv_visa:              "pTypeCVvisa",
  // Visum permanent document boxes (plain upload/download, both sides).
  ezb:                     "pTypeEZB",
  zusatzblatt_a:           "pTypeZusatzblattA",
  defizitbescheid:         "pTypeDefizitbescheid",
  videx:                   "pTypeVidex",
  bildungsplan:            "pTypeBildungsplan",
  vorabzustimmung:         "pTypeVorabzustimmung",
  arbeitsvertrag:          "pTypeArbeitsvertrag",
  mawista:                 "pTypeMawista",
  versicherung:            "pTypeVersicherung",
  tls_rechnung:            "pTypeTlsRechnung",
  tls_bestaetigungstermin: "pTypeTlsBestaetigung",
  berufserfahrung_visum:   "pTypeBerufserfahrungVisum",
  diploma_de:           "pTypeDiplomaDE",
  studyprog_de:         "pTypeStudyProgDE",
  transcript_de:        "pTypeTranscriptDE",
  abitur_de:            "pTypeAbiturDE",
  abitur_transcript_de: "pTypeAbiturTranscriptDE",
  praktikum_de:         "pTypePraktikumDE",
  workcert_de:          "pTypeWorkcertDE",
  work_experience_de:   "pTypeWorkExpDE",
  impfung_de:           "pTypeImpfungDE",
};

/** fileKey → all translated labels (every supported language) */
export const FILE_KEY_LABELS: Record<string, string[]> = {};
for (const [key, tKey] of Object.entries(KEY_TO_TKEY)) {
  const labels = new Set(Object.values(translations).map(lang => lang[tKey] as string));
  // ── Legacy aliases — keep so docs uploaded under the OLD German labels
  // remain findable after the LAW #35 rename batch. Each line preserves a
  // pre-rename label that may still appear as `file_type` on existing rows. ──
  if (key === "workcert")          { labels.add("Berufserlaubnis für Krankenpflege"); labels.add("Arbeitszeugnis"); }
  if (key === "workcert_de")       { labels.add("Berufserlaubnis für Krankenpflege (DE)"); }
  if (key === "abitur_transcript") { labels.add("Abitur Transcript"); labels.add("Abitur Notenblatt"); labels.add("Abitur Übersicht"); }
  if (key === "abitur_transcript_de") { labels.add("Abitur Notenblatt (DE)"); labels.add("Abitur Übersicht (DE)"); }
  if (key === "langcert")          { labels.add("Sprachzertifikat"); }  // pre-B2 label in DB
  if (key === "diploma")           { labels.add("Pflegediplom"); }
  if (key === "diploma_de")        { labels.add("Pflegediplom (DE)"); }
  if (key === "studyprog")         { labels.add("Pflegestudienprogramm"); labels.add("Studienprogramm"); }
  if (key === "studyprog_de")      { labels.add("Pflegestudienprogramm (DE)"); }
  if (key === "transcript")        { labels.add("Pflegenotenblatt"); labels.add("Notenblatt"); }
  if (key === "transcript_de")     { labels.add("Pflegenotenblatt (DE)"); }
  if (key === "praktikum")         { labels.add("Pflegepraktikumsnachweis"); labels.add("Praktikum"); }
  if (key === "praktikum_de")      { labels.add("Pflegepraktikumsnachweis (DE)"); }
  if (key === "impfung")           { labels.add("Impfnachweis"); }
  if (key === "impfung_de")        { labels.add("Impfnachweis (DE)"); }
  // cv_de used to carry a "(DE)" / "(German)" / "(Allemand)" suffix in the
  // display label. We dropped it because there's only one Lebenslauf box.
  // Keep the old labels as aliases so already-uploaded CVs stay findable.
  if (key === "cv_de")             { labels.add("Lebenslauf (DE)"); labels.add("CV (German)"); labels.add("CV (Allemand)"); }
  // cv_visa canonical label is now "Lebenslauf Visum" — keep the first-day
  // labels as aliases so any Visa CV already generated stays findable.
  if (key === "cv_visa")           { labels.add("Visa CV"); labels.add("CV Visa"); labels.add("Lebenslauf (Visum)"); }
  // Essentials letter DISPLAYS as "Motivationsschreiben", the Visum letter as
  // "Motivationsschreiben Visum" (pTypeLetter / pTypeLetterVisa). Keep every
  // pre-rename label as an alias so old rows still resolve, and keep the two
  // internal file_type tags DISTINCT so the reverse lookup tells Essentials
  // (letter → "Anschreiben") from Visum (letter_visa → "Motivationsschreiben
  // Visum") apart.
  //
  // letter_visa MUST NOT claim the bare "Motivationsschreiben". That string is
  // pTypeLetter — the Essentials label in all three languages — so with it
  // listed here the reverse map (built in key order, letter before letter_visa,
  // last write wins) resolved every Essentials motivation letter to the VISA
  // key. The consequence was not cosmetic: driveMirror's isPreMatchDoc said
  // false, so the letter was filed under "Nach Matching" and went MISSING from
  // the pre-matching dossier sent to German clinics; the Visum box showed an
  // embassy letter that did not exist; and re-upload could not find the prior
  // row, so the LAW #33 archive step was skipped.
  //
  // It was added to rescue a brief earlier build that stored the visa tag
  // without the "Visum" suffix. Measured against the live database before
  // removing it: ZERO rows carry the bare label (Essentials letters are stored
  // as "Anschreiben"/"Lettre de motivation", visa ones as "Motivationsschreiben
  // Visum"), so it rescued nothing and cost the common case.
  if (key === "letter")            { labels.add("Anschreiben"); labels.add("Lettre de motivation"); labels.add("Cover letter"); }
  if (key === "letter_visa")       { labels.add("Anschreiben Visum"); labels.add("Motivationsschreiben Visum"); }
  FILE_KEY_LABELS[key] = [...labels];
}

/** label (any language) → fileKey (reverse lookup)
 *
 *  FIRST WRITE WINS. The old `LABEL_TO_FILE_KEY[lbl] = key` let a later key
 *  silently steal a label an earlier one already owned, which is exactly how
 *  "Motivationsschreiben" — the Essentials label — ended up resolving to
 *  letter_visa. A canonical label is now unstealable: whichever key declares it
 *  first keeps it, and tests/fileKeysCollision.test.ts fails the build if two
 *  keys ever declare the same label at all. */
export const LABEL_TO_FILE_KEY: Record<string, string> = {};
for (const [key, labels] of Object.entries(FILE_KEY_LABELS)) {
  for (const lbl of labels) if (!(lbl in LABEL_TO_FILE_KEY)) LABEL_TO_FILE_KEY[lbl] = key;
}

/** Translate a stored document label (in whatever language the candidate
 *  uploaded it, incl. legacy aliases) into the viewer's current UI language.
 *  Unknown labels (custom Bearbeitung/Visum slots, org docs, …) pass through
 *  unchanged so nothing ever shows blank. */
export function translateDocLabel(
  label: string | null | undefined,
  lang: "fr" | "en" | "de",
): string {
  const v = (label ?? "").trim();
  if (!v) return v;
  const key = LABEL_TO_FILE_KEY[v];
  if (!key) return v;
  const tKey = KEY_TO_TKEY[key];
  if (!tKey) return v;
  const dict = translations[lang] ?? translations.en ?? translations.fr;
  return (dict[tKey] as string) || v;
}

/**
 * Resolve a stored `documents.file_type` to its canonical fileKey. The column
 * holds a translated LABEL (any language, incl. legacy aliases) OR — on some
 * paths — the fileKey itself. This collapses BOTH to the key so evidence checks
 * (CV finalized, diploma approved, …) work regardless of the candidate's upload
 * language or how the row was written. Unknown values pass through unchanged so
 * callers can still compare/skip them.
 */
export function resolveFileKey(fileType: string | null | undefined): string {
  const v = (fileType ?? "").trim();
  if (!v) return "";
  return LABEL_TO_FILE_KEY[v] ?? v;
}

/** The label a box DISPLAYS for `fileKey` in `lang` — and therefore the exact
 *  string an upload from that box must store as `documents.file_type`. Empty
 *  for a key outside the catalog (a wizard-slot UUID, an org doc). */
export function canonicalDocLabel(fileKey: string, lang: "fr" | "en" | "de"): string {
  const key = (fileKey ?? "").trim();
  // hasOwnProperty, not a bare lookup: fileKey is caller-supplied, and "constructor"
  // would otherwise answer with Object's own and walk on as if it were a doc key.
  if (!Object.prototype.hasOwnProperty.call(KEY_TO_TKEY, key)) return "";
  const tKey = KEY_TO_TKEY[key];
  const dict = translations[lang] ?? translations.en ?? translations.fr;
  return (dict[tKey] as string) || "";
}

/** Which UI language spells a canonical label, so a WRONG label can be replaced
 *  without also switching the row's language. A label two languages share (e.g.
 *  "Zusatzblatt A") answers with the first of de, fr, en. A Map, not an object:
 *  the argument is caller-supplied, and a plain object would answer "constructor"
 *  with Object's own. */
const LABEL_LANG = new Map<string, "fr" | "en" | "de">();
for (const lang of ["de", "fr", "en"] as const) {
  for (const tKey of Object.values(KEY_TO_TKEY)) {
    const lbl = translations[lang][tKey] as string;
    if (lbl && !LABEL_LANG.has(lbl)) LABEL_LANG.set(lbl, lang);
  }
}
export function docLabelLang(label: string | null | undefined): "fr" | "en" | "de" | null {
  return LABEL_LANG.get((label ?? "").trim()) ?? null;
}

/**
 * The `file_type` to STORE for an upload of `fileKey` that a caller labelled
 * `sent`. Returns `sent` untouched unless the two disagree.
 *
 * Both halves of an upload name the box, and they can disagree: the KEY builds
 * the filename (LAW #35's `_original` / `_uebersetzt` suffix), while the LABEL
 * is what lands in `documents.file_type` — which every reader turns back into a
 * key with resolveFileKey to decide which box shows the file and which earlier
 * row the upload retires. When they disagree the key wins: it is the box the
 * uploader actually clicked, and it already decided the filename.
 *
 * This is not hypothetical. The admin panel's paired Qualification rows passed
 * the ORIGINAL's label to the "Übersetzt" sub-box, so a sub-admin uploading a
 * translation sent fileKey=diploma_de with fileType="Diplom". Measured on the
 * live database: 30 translated documents (3 candidates, every one an admin
 * upload) were filed in the Original box, and because the retire pass matched
 * on the label they also superseded the real original — 29 of those slots were
 * left with no live original at all.
 *
 * Only standard catalog keys are corrected. A Bearbeitung/Visum slot stores its
 * own UUID as file_type, and "other"/Sonstiges is counted per exact label, so
 * both are returned as sent.
 */
export function canonicalizeFileType(fileKey: string | null | undefined, sent: string): string {
  const key = (fileKey ?? "").trim();
  if (!key || key === "other" || !Object.prototype.hasOwnProperty.call(KEY_TO_TKEY, key)) return sent;
  if (resolveFileKey(sent) === key) return sent;
  return canonicalDocLabel(key, docLabelLang(sent) ?? "de") || sent;
}

/**
 * POST-match / Visum-phase document keys — generated or collected AFTER a
 * candidate is matched to an employer (visa CV + visa letter, EZB, Zusatzblatt,
 * Vorabzustimmung, Arbeitsvertrag, insurance, TLS, etc.). Everything else — CV,
 * passport, diploma, study programme, transcripts, Abitur, language cert, the
 * (non-visa) Anschreiben, work certs/experience, vaccination, "other" — is the
 * PRE-match dossier ("Essentials + Unterlagen" the founder shares to find a
 * match). Mirrors the "Visum permanent document boxes" block above.
 */
export const POST_MATCH_FILE_KEYS = new Set<string>([
  "letter_visa", "cv_visa", "ezb", "zusatzblatt_a", "defizitbescheid", "videx",
  "bildungsplan", "vorabzustimmung", "arbeitsvertrag", "mawista", "versicherung",
  "tls_rechnung", "tls_bestaetigungstermin", "berufserfahrung_visum",
]);

const SLOT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True if a documents.file_type belongs to the PRE-match dossier (Essentials +
 * Qualifications). False for Visum-phase boxes and Bearbeitung/Visum wizard slot
 * docs (whose file_type is a phase_slots UUID) — those are post-match.
 */
export function isPreMatchDoc(fileType: string | null | undefined): boolean {
  const v = (fileType ?? "").trim();
  if (!v) return true;                     // untyped → treat as dossier
  if (SLOT_UUID_RE.test(v)) return false;  // wizard slot doc → post-match
  const key = resolveFileKey(v);
  if (SLOT_UUID_RE.test(key)) return false;
  return !POST_MATCH_FILE_KEYS.has(key);
}

/** fileKey → Set of all translated labels (every supported language).
 *  Used by admin + dashboard getDoc() to match docs regardless of upload language. */
export const FILE_KEY_ALL_LABELS: Record<string, Set<string>> = {};
for (const [key, labels] of Object.entries(FILE_KEY_LABELS)) {
  FILE_KEY_ALL_LABELS[key] = new Set(labels);
}
