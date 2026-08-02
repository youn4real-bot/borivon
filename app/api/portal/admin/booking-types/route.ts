import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { loadBookingConfig } from "@/lib/bookingConfig";
import { listEventTypesForAdmin, looksLikeSlug, parseEventTypePatch } from "@/lib/bookingEventTypes";

/**
 * The shareable booking links — /book/nurse, /book/clinic, /book/company.
 *
 *   GET   → every type (active AND inactive) plus the GLOBAL values they
 *           inherit, so the editor can show "inherits 30 min" instead of an
 *           unexplained empty box.
 *   PATCH → one type by slug: on/off, and the four per-audience overrides.
 *
 * SUPREME ADMIN ONLY, exactly like booking-availability: this is the founder's
 * own diary geometry, and a sub-admin has no business setting how long his
 * calls are or which links are live.
 *
 * NULL IS THE POINT. An override left empty is stored as NULL, which means
 * "inherit the global booking_availability row" — the state every seeded row
 * starts in, and the reason adding this feature changed nothing about /book.
 * So the PATCH must be able to WRITE null, not merely skip the field, or an
 * override could be set and never taken back off.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The link the founder actually hands out — the prod origin, not localhost. */
const SITE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://www.borivon.com")
  .replace(/\/+$/, "");

async function payload() {
  // Both reads fail open on their own, and neither depends on the other.
  const [{ types, migrated }, cfg] = await Promise.all([listEventTypesForAdmin(), loadBookingConfig()]);
  return {
    types: types.map((t) => ({
      slug: t.slug,
      kind: t.kind,
      active: t.active,
      url: `${SITE}/book/${t.slug}`,
      slot_minutes: t.slotMinutes,
      buffer_minutes: t.bufferMinutes,
      min_notice_hours: t.minNoticeHours,
      horizon_days: t.horizonDays,
      title: t.title,
      blurb: t.blurb,
    })),
    // What an unset override resolves to right now. The editor shows these
    // next to every empty box — "inherit 30" and "explicitly 30" have to be
    // distinguishable, and a blank input alone cannot do that.
    defaults: {
      slot_minutes: cfg.availability.slotMinutes,
      buffer_minutes: cfg.availability.bufferMinutes ?? 0,
      min_notice_hours: cfg.availability.minNoticeHours,
      horizon_days: cfg.availability.horizonDays,
      accepting: cfg.accepting,
    },
    baseUrl: SITE,
    migrated,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  return NextResponse.json(await payload());
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  // Shape-checked BEFORE it reaches a query, same as every other slug path.
  const slug = body?.slug;
  if (!looksLikeSlug(slug)) return NextResponse.json({ error: "bad_slug" }, { status: 400 });

  // Empty = NULL = inherit; out of range is REFUSED, never clamped. Both rules
  // live in the lib so they can be unit-tested away from the network.
  const parsed = parseEventTypePatch(body);
  if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });
  const patch = parsed.patch;

  const { data, error } = await getServiceSupabase()
    .from("booking_event_types")
    .update(patch)
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();

  if (error) {
    const notMigrated = /booking_event_types|does not exist|schema cache/i.test(error.message ?? "");
    if (notMigrated) {
      return NextResponse.json(
        { error: "not_migrated", message: "Run supabase/booking_event_types.sql first." },
        { status: 409 },
      );
    }
    console.error("[booking-types] save failed:", error.message);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  // The table is there but that slug is not a row — a built-in shown from the
  // fallback catalog, or a stale tab. Say so rather than reporting success for
  // a write that touched nothing.
  if (!data) return NextResponse.json({ error: "unknown_type" }, { status: 404 });

  return NextResponse.json({ ok: true, ...(await payload()) });
}
