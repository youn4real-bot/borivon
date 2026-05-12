/**
 * Catalog of candidate data fields admins can bind to form-field boxes.
 *
 * When admin draws an input box on a PDF, they pick ONE entry from this list.
 * At wizard submit time, the resolver pulls the actual value from the
 * candidate's passport profile (CandidateProfile) and CV draft (CVData), then
 * stamps it into the PDF at the box's coordinates.
 *
 * Adding new fields: append to FIELD_CATALOG and update the resolver — both
 * the binding popup and the value stamping pick up new entries automatically.
 */

import type { CandidateProfile } from "@/types";

/** Subset of CandidateProfile actually used by the resolver — accepts any
 *  shape with these optional fields so admin/page.tsx's local type (which
 *  omits user_id) is assignable too. */
type ResolverProfile = Partial<Omit<CandidateProfile, "user_id">>;

export type CandidateFieldId =
  | "first_name" | "last_name" | "full_name"
  | "dob" | "sex"
  | "nationality" | "passport_no" | "passport_expiry" | "passport_issue_date"
  | "issuing_authority"
  | "city_of_birth" | "country_of_birth"
  | "address_street" | "address_number" | "address_postal"
  | "city_of_residence" | "country_of_residence"
  | "marital_status" | "children_ages"
  | "phone" | "email";

export type CandidateField = {
  id: CandidateFieldId;
  label: string;   // English label for the popup
  labelDe: string; // German label
  labelFr: string; // French label
};

export const FIELD_CATALOG: CandidateField[] = [
  { id: "first_name",          label: "First name",          labelDe: "Vorname",                 labelFr: "Prénom" },
  { id: "last_name",           label: "Last name",           labelDe: "Nachname",                labelFr: "Nom" },
  { id: "full_name",           label: "Full name",           labelDe: "Vollständiger Name",      labelFr: "Nom complet" },
  { id: "dob",                 label: "Date of birth",       labelDe: "Geburtsdatum",            labelFr: "Date de naissance" },
  { id: "sex",                 label: "Sex",                 labelDe: "Geschlecht",              labelFr: "Sexe" },
  { id: "nationality",         label: "Nationality",         labelDe: "Staatsangehörigkeit",     labelFr: "Nationalité" },
  { id: "passport_no",         label: "Passport number",     labelDe: "Reisepass-Nr.",           labelFr: "N° de passeport" },
  { id: "passport_expiry",     label: "Passport expiry",     labelDe: "Reisepass gültig bis",    labelFr: "Passeport expire le" },
  { id: "passport_issue_date", label: "Passport issued",     labelDe: "Reisepass ausgestellt",   labelFr: "Passeport délivré le" },
  { id: "issuing_authority",   label: "Issuing authority",   labelDe: "Ausstellende Behörde",    labelFr: "Autorité émettrice" },
  { id: "city_of_birth",       label: "City of birth",       labelDe: "Geburtsort",              labelFr: "Lieu de naissance" },
  { id: "country_of_birth",    label: "Country of birth",    labelDe: "Geburtsland",             labelFr: "Pays de naissance" },
  { id: "address_street",      label: "Street",              labelDe: "Straße",                  labelFr: "Rue" },
  { id: "address_number",      label: "House number",        labelDe: "Hausnummer",              labelFr: "N°" },
  { id: "address_postal",      label: "Postal code",         labelDe: "PLZ",                     labelFr: "Code postal" },
  { id: "city_of_residence",   label: "City",                labelDe: "Wohnort",                 labelFr: "Ville" },
  { id: "country_of_residence",label: "Country",             labelDe: "Wohnland",                labelFr: "Pays" },
  { id: "marital_status",      label: "Marital status",      labelDe: "Familienstand",           labelFr: "État civil" },
  { id: "children_ages",       label: "Children",            labelDe: "Kinder",                  labelFr: "Enfants" },
  { id: "phone",               label: "Phone",               labelDe: "Telefon",                 labelFr: "Téléphone" },
  { id: "email",               label: "Email",               labelDe: "E-Mail",                  labelFr: "Email" },
];

/** Look up the localized label for a field by ID. */
export function fieldLabel(id: CandidateFieldId, lang: string): string {
  const entry = FIELD_CATALOG.find(f => f.id === id);
  if (!entry) return id;
  return lang === "de" ? entry.labelDe : lang === "fr" ? entry.labelFr : entry.label;
}

/**
 * Resolve a binding ID → string value from the candidate's profile/CV.
 * Returns "" if the candidate hasn't filled that data yet.
 */
export function resolveFieldValue(
  id: CandidateFieldId,
  profile: ResolverProfile | null | undefined,
  cv: { phone?: string | null; email?: string | null } | null | undefined,
): string {
  const p = profile ?? null;
  switch (id) {
    case "first_name":          return p?.first_name ?? "";
    case "last_name":           return p?.last_name ?? "";
    case "full_name":           return [p?.first_name, p?.last_name].filter(Boolean).join(" ");
    case "dob":                 return p?.dob ?? "";
    case "sex":                 return p?.sex ?? "";
    case "nationality":         return p?.nationality ?? "";
    case "passport_no":         return p?.passport_no ?? "";
    case "passport_expiry":     return p?.passport_expiry ?? "";
    case "passport_issue_date": return p?.issue_date ?? "";
    case "issuing_authority":   return p?.issuing_authority ?? "";
    case "city_of_birth":       return p?.city_of_birth ?? "";
    case "country_of_birth":    return p?.country_of_birth ?? "";
    case "address_street":      return p?.address_street ?? "";
    case "address_number":      return p?.address_number ?? "";
    case "address_postal":      return p?.address_postal ?? "";
    case "city_of_residence":   return p?.city_of_residence ?? "";
    case "country_of_residence":return p?.country_of_residence ?? "";
    case "marital_status":      return p?.marital_status ?? "";
    case "children_ages":       return p?.children_ages ?? "";
    case "phone":               return cv?.phone ?? "";
    case "email":               return cv?.email ?? "";
  }
}
