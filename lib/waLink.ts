/**
 * WhatsApp click-to-chat helpers. wa.me needs the full international number in
 * DIGITS ONLY (country code, no +, no spaces). Candidates enter Moroccan numbers
 * inconsistently, so normalize what we safely can and FLAG what we can't — never
 * silently message a wrong person.
 */

/**
 * Best-effort normalize a stored phone → wa.me digits.
 *  - strips non-digits and a leading 00 (00212… → 212…)
 *  - Morocco (212…): if the national part kept a local leading 0
 *    (+212 06… — the candidate typed the local form under +212), drop that 0.
 * It NEVER invents a missing digit — a number short a digit stays short so
 * isValidWaPhone() flags it.
 */
export function normalizeWaPhone(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("212")) {
    let nat = d.slice(3);
    if (nat.startsWith("0")) nat = nat.slice(1);
    d = "212" + nat;
  } else if (d.startsWith("0") && d.length === 10 && /^0[67]/.test(d)) {
    // Bare Moroccan local mobile (0[67]xxxxxxxx) — no country code. Add it.
    // Every candidate here is Moroccan, so this is the common stored form.
    d = "212" + d.slice(1);
  } else if (d.length === 9 && /^[67]/.test(d)) {
    // National mobile with neither the leading 0 nor a country code.
    d = "212" + d;
  }
  return d;
}

/**
 * Does the normalized number look like a real, dialable WhatsApp number?
 * Morocco: 212 + a 9-digit mobile starting 6 or 7 (→ 12 digits total). That's
 * the exact shape that catches MARIAME's missing-6 (11-digit) case + local-0
 * leftovers. Non-MA: a loose 10–15 digit sanity range.
 */
export function isValidWaPhone(d: string): boolean {
  if (!d) return false;
  // A leftover leading 0 means the number has no country code (normalize could
  // not place it) — flag it rather than compose a wrong wa.me link.
  if (d.startsWith("0")) return false;
  if (d.startsWith("212")) return d.length === 12 && /^212[67]/.test(d);
  return d.length >= 10 && d.length <= 15;
}

/** Pretty-print digits for display in the confirm UI: +212 6 12 34 56 78. */
export function prettyWaPhone(d: string): string {
  if (!d) return "";
  if (d.startsWith("212")) {
    const nat = d.slice(3);
    const groups = nat.replace(/(\d{1})(\d{2})(\d{2})(\d{2})(\d{2}).*/, "$1 $2 $3 $4 $5").trim();
    return `+212 ${groups || nat}`.trim();
  }
  return `+${d}`;
}

export function waMeUrl(phoneDigits: string, text: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`;
}
