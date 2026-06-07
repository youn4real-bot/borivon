/**
 * Canonical sex normalization — language-agnostic.
 *
 * A passport / form sex value can arrive as a single MRZ letter ("M" / "F")
 * OR as a full word in the document's language. They all mean the same thing
 * and MUST be treated identically by gender-dependent output (e.g. the German
 * nursing title Pflegepraktikant ↔ Pflegepraktikantin, salutations, etc.):
 *
 *   FEMALE  → F · Female (en) · Femme / Féminin (fr) · Weiblich (de) ·
 *                 Femenino (es) · Femminile (it) · Frau · "W"
 *   MALE    → M · Male (en) · Masculin / Homme (fr) · Männlich (de) ·
 *                 Masculino (es) · Hombre (es) · Mann · "H"
 *
 * Returns the canonical "M" | "F", or null when unknown/blank. Normalize on
 * the way IN (every write path) so storage is always canonical, AND in any
 * gender-branching read so legacy/edge values can never produce the wrong gender.
 */
export function normalizeSex(raw: unknown): "M" | "F" | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  // First letter is decisive across en/fr/de/es/it/pt passport vocabularies:
  //   F (Female/Femme/Féminin/Femenino…) and W (Weiblich) → female
  //   M (Male/Masculin/Männlich…) and H (Homme/Hombre)    → male
  const c = s[0];
  if (c === "F" || c === "W") return "F";
  if (c === "M" || c === "H") return "M";
  // ISO/IEC 5218 numeric fallback (1 = male, 2 = female) — some systems use it.
  if (s === "1") return "M";
  if (s === "2") return "F";
  return null;
}

/** True when the value denotes female, in any supported language. */
export function isFemaleSex(raw: unknown): boolean {
  return normalizeSex(raw) === "F";
}
