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
  other:                "pTypeOther",
  work_experience:      "pTypeWorkExp",
  impfung:              "pTypeImpfung",
  cv_de:                "pTypeCVde",
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
  FILE_KEY_LABELS[key] = [...labels];
}

/** label (any language) → fileKey (reverse lookup) */
export const LABEL_TO_FILE_KEY: Record<string, string> = {};
for (const [key, labels] of Object.entries(FILE_KEY_LABELS)) {
  for (const lbl of labels) LABEL_TO_FILE_KEY[lbl] = key;
}

/** fileKey → Set of all translated labels (every supported language).
 *  Used by admin + dashboard getDoc() to match docs regardless of upload language. */
export const FILE_KEY_ALL_LABELS: Record<string, Set<string>> = {};
for (const [key, labels] of Object.entries(FILE_KEY_LABELS)) {
  FILE_KEY_ALL_LABELS[key] = new Set(labels);
}
