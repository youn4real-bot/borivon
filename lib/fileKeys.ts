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
  // Visum") apart. The bare "Motivationsschreiben" alias on letter_visa rescues
  // a brief earlier build that stored the visa tag without the "Visum" suffix;
  // KEY_TO_TKEY lists letter before letter_visa, so it resolves to letter_visa.
  if (key === "letter")            { labels.add("Anschreiben"); labels.add("Lettre de motivation"); labels.add("Cover letter"); }
  if (key === "letter_visa")       { labels.add("Anschreiben Visum"); labels.add("Motivationsschreiben Visum"); labels.add("Motivationsschreiben"); }
  FILE_KEY_LABELS[key] = [...labels];
}

/** label (any language) → fileKey (reverse lookup) */
export const LABEL_TO_FILE_KEY: Record<string, string> = {};
for (const [key, labels] of Object.entries(FILE_KEY_LABELS)) {
  for (const lbl of labels) LABEL_TO_FILE_KEY[lbl] = key;
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

/** fileKey → Set of all translated labels (every supported language).
 *  Used by admin + dashboard getDoc() to match docs regardless of upload language. */
export const FILE_KEY_ALL_LABELS: Record<string, Set<string>> = {};
for (const [key, labels] of Object.entries(FILE_KEY_LABELS)) {
  FILE_KEY_ALL_LABELS[key] = new Set(labels);
}
