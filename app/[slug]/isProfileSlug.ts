import { ADMIN_PROFILE_SLUG, RESERVED_SLUGS, parseProfileSlug } from "@/lib/profile-slug";

/**
 * Could this single path segment POSSIBLY name a public profile?
 *
 * /[slug] is the last route in the tree, so every one-segment address nobody
 * else claims lands here. Until this check existed the page answered 200 with
 * ~21 KB of app shell for ALL of them. Measured in production on 2026-09-20:
 * /key.json, /google-key.json, /credentials.json, /gcp-sa.json, /sa.json and
 * /.env each returned 200 and 21 KB while a scanner walked exactly that list.
 * Nothing secret was served — but every probe cost a Worker render, and "200"
 * is a lie about a page that does not exist. Two-segment misses (/foo/bar)
 * already 404ed correctly; only this route was answering for the unknown.
 *
 * WHY A SHAPE TEST AND NOT A LOOKUP: the page can only ever display a profile
 * when GET /api/p/<slug> answers 200, and that route returns 404 outright, before
 * touching the database, whenever `parseProfileSlug(slug)` is null and the slug
 * is not the admin's vanity slug. Refusing exactly the segments that route
 * refuses therefore cannot hide a profile that would otherwise have rendered —
 * which is the failure that matters here, a real nurse's page 404ing.
 *
 * What it deliberately does NOT do is ask whether the profile exists. A
 * well-formed-but-unused slug still renders the page's own "profile not found"
 * card at 200. Answering 404 there would need a database read before first byte
 * on every real profile view, and a transient failure on that read would 404 a
 * live nurse — strictly worse than the junk it would tidy up.
 */
export function isPossibleProfileSlug(slug: string): boolean {
  const lower = slug.toLowerCase();

  // Reserved top-level paths. Every one of them also fails the shape test
  // below, so this is belt-and-braces — it stays because it states the intent,
  // and it keeps holding if the slug grammar is ever loosened.
  if (RESERVED_SLUGS.has(lower)) return false;

  // The admin's hand-picked vanity slug ("borivon") has no 5-digit suffix.
  if (lower === ADMIN_PROFILE_SLUG) return true;

  // Everything else: <ascii-first-name><5 digits>, the only thing
  // buildProfileSlug() can produce and the only thing /api/p accepts.
  return parseProfileSlug(slug) !== null;
}
