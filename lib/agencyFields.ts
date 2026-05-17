/**
 * Catalog of employer/agency fields for auto-filling section C of forms like
 * the BA EzB. Mirror of `lib/candidateFields.ts` but for the agency side.
 *
 * Source: a single row per admin user in `agency_profiles` (entered once on
 * the admin settings page, reused for every candidate).
 *
 * The `AutoFillReviewModal` merges this catalog with `FIELD_CATALOG` in the
 * click-to-map dropdown — admin sees both candidate fields and agency fields
 * grouped, picks whichever matches the form field.
 */

export type AgencyProfile = {
  firma?:          string | null;
  strasse?:        string | null;
  hausnummer?:     string | null;
  plz?:            string | null;
  ort?:            string | null;
  kontaktperson?:  string | null;
  telefon?:        string | null;
  email?:          string | null;
  telefax?:        string | null;
  betriebsnummer?: string | null;
};

/** Prefixed with `agency_` so IDs never collide with `candidateFields`. */
export type AgencyFieldId =
  | "agency_firma"
  | "agency_strasse"
  | "agency_hausnummer"
  | "agency_plz"
  | "agency_ort"
  | "agency_kontaktperson"
  | "agency_telefon"
  | "agency_email"
  | "agency_telefax"
  | "agency_betriebsnummer";

export type AgencyField = {
  id: AgencyFieldId;
  /** Column on the `agency_profiles` row. */
  col: keyof AgencyProfile;
  label: string;
  labelDe: string;
  labelFr: string;
};

export const AGENCY_FIELD_CATALOG: AgencyField[] = [
  { id: "agency_firma",          col: "firma",          label: "Company (employer)",     labelDe: "Firma (Arbeitgeber)",     labelFr: "Société (employeur)" },
  { id: "agency_strasse",        col: "strasse",        label: "Street (employer)",      labelDe: "Straße (Arbeitgeber)",    labelFr: "Rue (employeur)" },
  { id: "agency_hausnummer",     col: "hausnummer",     label: "House no. (employer)",   labelDe: "Hausnummer (Arbeitgeber)", labelFr: "N° (employeur)" },
  { id: "agency_plz",            col: "plz",            label: "Postal code (employer)", labelDe: "PLZ (Arbeitgeber)",       labelFr: "CP (employeur)" },
  { id: "agency_ort",            col: "ort",            label: "City (employer)",        labelDe: "Ort (Arbeitgeber)",       labelFr: "Ville (employeur)" },
  { id: "agency_kontaktperson",  col: "kontaktperson",  label: "Contact person",         labelDe: "Kontaktperson",           labelFr: "Personne de contact" },
  { id: "agency_telefon",        col: "telefon",        label: "Phone (employer)",       labelDe: "Telefon (Arbeitgeber)",   labelFr: "Téléphone (employeur)" },
  { id: "agency_email",          col: "email",          label: "Email (employer)",       labelDe: "E-Mail (Arbeitgeber)",    labelFr: "Email (employeur)" },
  { id: "agency_telefax",        col: "telefax",        label: "Fax (employer)",         labelDe: "Telefax",                  labelFr: "Fax" },
  { id: "agency_betriebsnummer", col: "betriebsnummer", label: "Establishment no.",      labelDe: "Betriebsnummer",          labelFr: "N° d'établissement" },
];

export function agencyFieldLabel(id: AgencyFieldId, lang: string): string {
  const entry = AGENCY_FIELD_CATALOG.find(f => f.id === id);
  if (!entry) return id;
  return lang === "de" ? entry.labelDe : lang === "fr" ? entry.labelFr : entry.label;
}

export function resolveAgencyField(id: AgencyFieldId, profile: AgencyProfile | null | undefined): string {
  if (!profile) return "";
  const entry = AGENCY_FIELD_CATALOG.find(f => f.id === id);
  if (!entry) return "";
  const v = profile[entry.col];
  return (v ?? "").toString();
}
