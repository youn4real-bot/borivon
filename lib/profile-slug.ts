/**
 * Deterministic profile-slug helpers.
 *
 * Format: `firstname<NNNNN>` (lowercased, ASCII-folded, no hyphen, no last
 * name). Example: "yassine78492". The 5-digit suffix is derived
 * deterministically from the user's UUID so the URL never changes for the
 * same candidate.
 *
 * Conflicts within the 100k-digit space are extremely unlikely for hundreds
 * of candidates, but the lookup layer also matches against first name as
 * a tiebreaker just in case.
 */

function ascii(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")    // strip combining marks (é → e)
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9]+/g, "") // strip ALL non-alnum (no separators)
    .toLowerCase();
}

/** djb2 hash for the 5-digit suffix — stable across runs, no crypto needed. */
function suffix5(userId: string): string {
  let h = 5381;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) + h + userId.charCodeAt(i)) | 0;
  }
  const n = Math.abs(h) % 100000;
  return String(n).padStart(5, "0");
}

/** Hard-coded vanity slug for the head admin (the "Borivon" team account). */
export const ADMIN_PROFILE_SLUG = "borivon";

/** Reserved top-level paths — must NOT be matched by /[slug] catch-all. */
export const RESERVED_SLUGS = new Set<string>([
  "p", "portal", "api", "_next", "robots.txt", "sitemap.xml",
  "favicon.ico", "static", "public", "assets", "admin", "login",
  "signup", "signin", "signout", "logout", "auth",
]);

/** lastName param is kept for backwards compatibility but ignored. */
export function buildProfileSlug(firstName: string, _lastName: string, userId: string): string {
  const fn = ascii(firstName) || "user";
  return `${fn}${suffix5(userId)}`;
}

/** Parse a slug back into its parts so the lookup endpoint can match.
   The trailing 5 digits are the deterministic hash; everything before is
   the ASCII-folded first name. Slugs are matched case-insensitively so a
   hand-typed `Yassine78492` resolves the same as `yassine78492`. */
export function parseProfileSlug(slug: string): { firstName: string; suffix: string } | null {
  const m = slug.toLowerCase().match(/^([a-z][a-z0-9]*?)(\d{5})$/);
  if (!m) return null;
  return { firstName: m[1], suffix: m[2] };
}
