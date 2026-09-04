/**
 * LAW #35 filename builder for STANDARD document keys, shared by the login-less
 * upload-link route. Mirrors FILE_KEY_MAP + buildFileName in
 * app/api/portal/upload/route.ts (the source of truth for candidate uploads) —
 * keep the two in sync if a standard key is added. Pure; no side effects.
 */
const FILE_KEY_MAP: Record<string, { name: string; suffix: string }> = {
  id:                    { name: "reisepass",           suffix: "" },
  langcert:              { name: "b2_sprachzertifikat",  suffix: "" },
  letter:                { name: "motivationsschreiben", suffix: "" },
  cv_de:                 { name: "lebenslauf",           suffix: "" },
  diploma:               { name: "diplom",                    suffix: "original" },
  studyprog:             { name: "ausbildungsprogramm",       suffix: "original" },
  transcript:            { name: "notenuebersicht",           suffix: "original" },
  abitur:                { name: "abitur",                     suffix: "original" },
  abitur_transcript:     { name: "abitur_notenuebersicht",    suffix: "original" },
  praktikum:             { name: "ausbildungspraktikum",      suffix: "original" },
  workcert:              { name: "berufserlaubnis",           suffix: "original" },
  work_experience:       { name: "berufserfahrung",           suffix: "original" },
  impfung:               { name: "impfung",                   suffix: "original" },
  diploma_de:            { name: "diplom",                    suffix: "uebersetzt" },
  studyprog_de:          { name: "ausbildungsprogramm",       suffix: "uebersetzt" },
  transcript_de:         { name: "notenuebersicht",           suffix: "uebersetzt" },
  abitur_de:             { name: "abitur",                     suffix: "uebersetzt" },
  abitur_transcript_de:  { name: "abitur_notenuebersicht",    suffix: "uebersetzt" },
  praktikum_de:          { name: "ausbildungspraktikum",      suffix: "uebersetzt" },
  workcert_de:           { name: "berufserlaubnis",           suffix: "uebersetzt" },
  work_experience_de:    { name: "berufserfahrung",           suffix: "uebersetzt" },
  impfung_de:            { name: "impfung",                   suffix: "uebersetzt" },
};

/** The fileKeys a login-less link may request (excludes passport "id" + wizard
 *  slots + Sonstiges in v1 — passport has its own LAW #39 flow). */
export const UPLOAD_LINK_ALLOWED_KEYS = new Set(Object.keys(FILE_KEY_MAP).filter((k) => k !== "id"));

export function isUploadLinkKey(k: unknown): k is string {
  return typeof k === "string" && UPLOAD_LINK_ALLOWED_KEYS.has(k);
}

export function buildFileName(firstName: string, lastName: string, fileKey: string, ext: string): string {
  const fn = firstName.trim().toLowerCase().replace(/\s+/g, "_") || "kandidat";
  const ln = lastName.trim().toLowerCase().replace(/\s+/g, "_") || "unbekannt";
  const mapping = FILE_KEY_MAP[fileKey] ?? { name: "dokument", suffix: "" };
  const suffix = mapping.suffix ? `_${mapping.suffix}` : "";
  return `${fn}_${ln}_pflegekraft_${mapping.name}${suffix}.${ext}`;
}
