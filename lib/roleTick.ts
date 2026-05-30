/**
 * Verified-tick rule — the SINGLE source of truth.
 *
 * Who gets which badge (automatic, role-derived — no manual "verify" step):
 *   • Supreme admin + sub-admins → BLACK  (official Borivon account)
 *   • Org admins                 → ORG    (black tick, "official organization
 *                                          account" — never names the org)
 *   • Candidates                 → GOLD   only if manually granted OR premium
 *   • everyone else              → none
 *
 * NOTE: the old RED tick (org member) is RETIRED. Org admins now render the
 * BLACK tick visually; "org" is a text-only variant kept distinct so the popup
 * can say "official organization account" instead of the Borivon name. The red
 * tick is reserved for a future project — do not reintroduce it.
 *
 * Server routes resolve the role flags (sub_admins / organization_members /
 * payment_tier — all case-insensitive). UI just maps those flags → a colour
 * here so the rule never drifts between feed / profile / users panel as we
 * build on it. Keep ALL tick logic flowing through this file.
 */

export type TickColor = "black" | "org" | "gold" | "default";

export interface TickSignals {
  /** supreme admin OR a Borivon sub-admin */
  isBorivonTeam?: boolean;
  /** admin of a partner organization */
  isOrgAdmin?: boolean;
  /** candidate verified (manual grant) OR on the premium plan */
  candidateVerified?: boolean;
}

export function tickColor(s: TickSignals): TickColor {
  if (s.isBorivonTeam)     return "black";
  if (s.isOrgAdmin)        return "org";
  if (s.candidateVerified) return "gold";
  return "default";
}

/** Post/comment accent (border + gradient) that matches the tick colour. */
export function tickAccent(c: TickColor): { border: string; gradient: string; line: boolean } {
  switch (c) {
    case "black": return { border: "var(--border-admin)", gradient: "var(--gradient-admin)", line: true };
    case "org":   return { border: "var(--border-admin)", gradient: "var(--gradient-admin)", line: true };
    case "gold":  return { border: "var(--border-gold)",  gradient: "linear-gradient(90deg,transparent,var(--gold),transparent)",   line: true };
    default:      return { border: "var(--border)",       gradient: "", line: false };
  }
}
