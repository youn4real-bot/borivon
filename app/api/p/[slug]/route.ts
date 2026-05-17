import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { buildProfileSlug, parseProfileSlug, ADMIN_PROFILE_SLUG } from "@/lib/profile-slug";
import { enforceRateLimit } from "@/lib/rateLimit";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
// A miss falls through to scanning auth.users. Bound that hard so a bot
// probing random slugs can't fan each request into a full-table sweep.
const MAX_SCAN_PAGES = 10; // 10 × 200 = 2000 users / request, then give up

/**
 * Public profile lookup.
 *
 * GET /api/p/[slug]
 *
 * No auth required. Only returns sanitized fields — no DOB, address,
 * postal code, phone, email. The slug is derived from name + a 4-digit
 * hash of the user's UUID so a candidate's URL is permanent.
 *
 * "Verified" = has both an approved passport AND an approved Lebenslauf
 * (cv_de). Anything less and the profile is hidden behind 404.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  // Unauthenticated and returns candidate PII (name/city/country/photo).
  // Edge cache softens repeat hits but unique-slug enumeration bypasses it —
  // throttle per trusted IP so a scraper can't walk the slug space.
  const rl = enforceRateLimit(req, "pub-profile", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { slug } = await ctx.params;
  const slugLower = slug.toLowerCase();
  const isAdminSlug = slugLower === ADMIN_PROFILE_SLUG;
  const parsed = isAdminSlug ? null : parseProfileSlug(slug);
  if (!parsed && !isAdminSlug) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Single service-role client for all operations (DB queries + auth admin API)
  const db = getServiceSupabase();

  // Special case: the admin's vanity slug → resolve via ADMIN_EMAIL.
  let isAdminUser = false;

  let match: {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    city_of_residence: string | null;
    country_of_residence: string | null;
    nationality: string | null;
    profile_photo: string | null;
  } | null = null;

  if (isAdminSlug) {
    // Resolve "borivon" → admin user via ADMIN_EMAIL
    if (ADMIN_EMAIL) {
      try {
        let page = 1;
        while (page <= MAX_SCAN_PAGES) {
          const { data: usersList } = await db.auth.admin.listUsers({ perPage: 200, page });
          const list = usersList?.users ?? [];
          if (list.length === 0) break;
          const u = list.find(u => (u.email ?? "").toLowerCase() === ADMIN_EMAIL);
          if (u) {
            match = {
              user_id: u.id,
              first_name: (u.user_metadata?.first_name as string) ?? "Borivon",
              last_name:  (u.user_metadata?.last_name  as string) ?? "",
              city_of_residence: null,
              country_of_residence: null,
              nationality: null,
              profile_photo: null,
            };
            isAdminUser = true;
            break;
          }
          if (list.length < 200) break;
          page++;
        }
      } catch (err) {
        console.warn("[/api/p admin lookup]:", err);
      }
    }
  } else if (parsed) {
    // Scope the candidate_profiles query to the slug's first-name prefix —
    // a public-profile bot probing random slugs can't melt the DB this way.
    const { data: profiles } = await db
      .from("candidate_profiles")
      .select("user_id,first_name,last_name,city_of_residence,country_of_residence,nationality,profile_photo")
      .ilike("first_name", `${parsed.firstName.replace(/_/g, "\\_").replace(/%/g, "\\%")}%`);

    match = (profiles ?? []).find(p =>
      buildProfileSlug(p.first_name ?? "", p.last_name ?? "", p.user_id) === slugLower,
    ) ?? null;
  }

  // Fall back to scanning auth.users metadata when there's no profile row.
  if (!match && !isAdminSlug) {
    try {
      let page = 1;
      while (page <= MAX_SCAN_PAGES) {
        const { data: usersList } = await db.auth.admin.listUsers({ perPage: 200, page });
        const list = usersList?.users ?? [];
        if (list.length === 0) break;
        const u = list.find(u => {
          const fn = (u.user_metadata?.first_name as string | undefined) ?? "";
          const ln = (u.user_metadata?.last_name  as string | undefined) ?? "";
          return buildProfileSlug(fn, ln, u.id) === slugLower;
        });
        if (u) {
          // Try to fetch profile_photo from candidate_profiles even without
          // a name match (the legacy listUsers fallback path).
          const { data: prof } = await db
            .from("candidate_profiles")
            .select("profile_photo")
            .eq("user_id", u.id)
            .maybeSingle();
          match = {
            user_id: u.id,
            first_name: (u.user_metadata?.first_name as string) ?? null,
            last_name:  (u.user_metadata?.last_name  as string) ?? null,
            city_of_residence: null,
            country_of_residence: null,
            nationality: null,
            profile_photo: (prof as { profile_photo?: string | null } | null)?.profile_photo ?? null,
          };
          break;
        }
        if (list.length < 200) break;
        page++;
      }
    } catch (err) {
      console.warn("[/api/p] listUsers fallback failed:", err);
    }
  }

  if (!match) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } },
    );
  }

  // Verification: passport approved + cv_de approved. Admin user is always
  // verified — the blue check is their identity badge, not a doc-status flag.
  let verified = false;
  if (isAdminUser) {
    verified = true;
  } else {
    // Detect "this match IS the admin" even when slug isn't /borivon
    try {
      const { data } = await db.auth.admin.getUserById(match.user_id);
      if (ADMIN_EMAIL && (data?.user?.email ?? "").toLowerCase() === ADMIN_EMAIL) {
        verified = true;
        isAdminUser = true;
      }
    } catch { /* ignore */ }

    if (!verified) {
      // Verification is tied ONLY to an explicit admin grant
      // (manually_verified) or a paid premium subscription — NOT passport
      // / CV approval.
      const { data: prof } = await db
        .from("candidate_profiles")
        .select("manually_verified, payment_tier")
        .eq("user_id", match.user_id)
        .maybeSingle();
      const p = prof as { manually_verified?: boolean; payment_tier?: string | null } | null;
      if (p && (p.manually_verified || p.payment_tier === "premium")) {
        verified = true;
      }
    }
  }

  // Display name fall-back: when candidate_profiles has nulls, look up
  // the user's auth metadata for a nicer rendered name.
  let avatarInitial = (match.first_name ?? "?").charAt(0).toUpperCase();
  let displayName   = [match.first_name, match.last_name].filter(Boolean).join(" ");
  try {
    const { data } = await db.auth.admin.getUserById(match.user_id);
    if (data?.user?.user_metadata?.full_name) {
      displayName = String(data.user.user_metadata.full_name).slice(0, 200);
      avatarInitial = displayName.charAt(0).toUpperCase();
    } else if (data?.user?.email && !displayName) {
      displayName = data.user.email.split("@")[0];
      avatarInitial = displayName.charAt(0).toUpperCase();
    }
  } catch { /* fall back */ }
  if (!displayName) displayName = "Borivon User";

  return NextResponse.json(
    {
      slug: isAdminUser ? ADMIN_PROFILE_SLUG : slug,
      name: isAdminUser ? "Borivon" : displayName,
      initial: isAdminUser ? "B" : avatarInitial,
      photoUrl: isAdminUser ? null : (match.profile_photo ?? null),
      cityOfResidence: match.city_of_residence ?? null,
      countryOfResidence: match.country_of_residence ?? null,
      nationality: match.nationality ?? null,
      verified,
      isAdmin: isAdminUser,
    },
    {
      // Short edge cache so a bot scraping random slugs can't fan out
      // every hit into a fresh DB scan + admin-API call.
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    },
  );
}
