/**
 * Recognition document pack — the set of documents a Moroccan nurse needs for
 * German diploma recognition + the embassy. Status is DERIVED from the
 * candidate's real uploaded documents (no manual ticking): a doc's file_type
 * (stored as a label, possibly a legacy alias) maps back to a fileKey via
 * LABEL_TO_FILE_KEY, and the best status per required key wins
 * (approved > pending > missing).
 *
 * Pure / server-safe.
 */

import { resolveFileKey } from "./fileKeys";

export type DocStatus = "approved" | "pending" | "missing";

// The required keys (from lib/fileKeys.ts) + short display labels. Trim freely.
export const RECOGNITION_DOCS: { key: string; label: { en: string; fr: string; de: string } }[] = [
  { key: "id",        label: { en: "Passport",            fr: "Passeport",            de: "Reisepass" } },
  { key: "diploma",   label: { en: "Nursing diploma",     fr: "Diplôme infirmier",    de: "Pflegediplom" } },
  { key: "transcript",label: { en: "Transcript of grades", fr: "Relevé de notes",     de: "Notenblatt" } },
  { key: "studyprog", label: { en: "Study programme",     fr: "Programme d'études",   de: "Studienprogramm" } },
  { key: "langcert",  label: { en: "B2 certificate",      fr: "Certificat B2",        de: "B2-Zertifikat" } },
  { key: "cv_de",     label: { en: "CV (German)",         fr: "CV (allemand)",        de: "Lebenslauf" } },
  { key: "workcert",  label: { en: "Work experience",     fr: "Expérience pro.",      de: "Arbeitszeugnis" } },
];

export function recognitionDocLabel(key: string, lang: string): string {
  const d = RECOGNITION_DOCS.find((x) => x.key === key);
  if (!d) return key;
  return d.label[(lang as "en" | "fr" | "de")] ?? d.label.en;
}

export type DocPack = { items: { key: string; status: DocStatus }[]; collected: number; total: number };

export function computeDocPack(docs: { file_type: string | null; status: string | null }[]): DocPack {
  // Best status per fileKey across the candidate's documents.
  const best = new Map<string, DocStatus>();
  for (const d of docs) {
    const key = resolveFileKey(d.file_type);
    if (!key) continue;
    if (d.status === "approved") best.set(key, "approved");
    else if (d.status === "pending" && best.get(key) !== "approved") best.set(key, "pending");
  }
  const items = RECOGNITION_DOCS.map((rd) => ({ key: rd.key, status: best.get(rd.key) ?? ("missing" as DocStatus) }));
  const collected = items.filter((i) => i.status === "approved").length;
  return { items, collected, total: RECOGNITION_DOCS.length };
}
