import { translations } from "./translations";

const KEY_TO_TKEY: Record<string, keyof typeof translations.fr> = {
  id:                   "pTypeID",
  cv:                   "pTypeCV",
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
  cv_de:                "pTypeCVde",
  diploma_de:           "pTypeDiplomaDE",
  studyprog_de:         "pTypeStudyProgDE",
  transcript_de:        "pTypeTranscriptDE",
  abitur_de:            "pTypeAbiturDE",
  abitur_transcript_de: "pTypeAbiturTranscriptDE",
  praktikum_de:         "pTypePraktikumDE",
  workcert_de:          "pTypeWorkcertDE",
  work_experience_de:   "pTypeWorkExpDE",
};

/** fileKey → all translated labels (every supported language) */
export const FILE_KEY_LABELS: Record<string, string[]> = {};
for (const [key, tKey] of Object.entries(KEY_TO_TKEY)) {
  const labels = new Set(Object.values(translations).map(lang => lang[tKey] as string));
  // Legacy aliases kept for backward compatibility
  if (key === "workcert")          labels.add("Berufserlaubnis");
  if (key === "abitur_transcript") labels.add("Abitur Transcript");
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
