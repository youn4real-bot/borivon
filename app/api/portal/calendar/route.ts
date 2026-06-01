import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, requireAdminRole } from "@/lib/admin-auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { UUID_RE } from "@/lib/uuid";
import { signFeedToken } from "@/lib/calendarFeed";
import { googleStatus, fanOutUpsert, fanOutDelete, type PushEvent } from "@/lib/googleCalendar";

/**
 * Community calendar (the "Calendar" tab).
 *
 * GET    — any logged-in portal user. Returns every event newest-first.
 *          VIP-only events come back as { locked:true } for non-premium
 *          candidates with their join link + description withheld server-side,
 *          so the lock can't be bypassed by reading the network response.
 * POST   — supreme admin only (role==="admin"): create an event.
 * DELETE — supreme admin only: ?id=<uuid>.
 *
 * Run supabase/calendar_events.sql once before this works.
 */

type EventRow = {
  id: string; title: string; description: string;
  starts_at: string; ends_at: string | null;
  image_url: string; link_url: string; location: string;
  vip_only: boolean; created_at: string; attendee_ids: string[] | null;
};

const MAX = (s: unknown, n: number) => (typeof s === "string" ? s : "").trim().slice(0, n);

/** Accept only renderable, non-script image sources (https or inline image data). */
function safeImageUrl(s: unknown): string {
  const v = MAX(s, 200_000); // data URLs can be large; cap generously
  if (/^https:\/\/[^\s]+$/i.test(v)) return v.slice(0, 2000);
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(v)) return v;
  return "";
}

/** Accept only http(s) links (no javascript:, data:, etc.). */
function safeLinkUrl(s: unknown): string {
  const v = MAX(s, 500);
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : "";
}

function isAdminEmail(email: string): boolean {
  return !!email && email === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

/**
 * Notify each tagged attendee that they've been invited to an event.
 *
 * IDENTITY MASKING (privacy requirement): the row stores only the event title —
 * never the creating admin's name. The candidate bell renders these invites as
 * coming from "Borivon" (the organisation), so a candidate / org member never
 * sees the individual admin or sub-admin behind the invite. Admins still see
 * each other elsewhere; candidates only ever see the org. doc_id = event id so
 * the bell can deep-link to the Calendar tab.
 *
 * Best-effort: a notify failure is logged but never fails the event write.
 */
async function notifyAttendees(
  db: ReturnType<typeof getServiceSupabase>,
  eventId: string,
  title: string,
  userIds: string[],
) {
  if (!eventId || userIds.length === 0) return;
  const rows = userIds.map((uid) => ({
    user_id: uid,
    doc_id: eventId,
    doc_name: title.slice(0, 200) || "Event",
    doc_type: "event_invite",
    action: "event_invite",
    feedback: null,
    read: false,
  }));
  const { error } = await db.from("notifications").insert(rows);
  if (error) console.error("[portal/calendar] attendee notify error:", error.message);
}

// ── GET: list events (everyone logged-in) ────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Supreme admin never has anything locked (they manage events). Everyone else
  // is "premium" only via a paid tier or a manual verification flag.
  const canManage = isAdminEmail(auth.email);
  let premium = canManage;
  if (!premium) {
    const { data: prof } = await db
      .from("candidate_profiles")
      .select("payment_tier, manually_verified")
      .eq("user_id", auth.userId)
      .maybeSingle();
    const p = prof as { payment_tier?: string | null; manually_verified?: boolean } | null;
    premium = !!p && (p.payment_tier === "premium" || !!p.manually_verified);
  }

  // Google "instant sync" connection status for this user (drives the Sync UI).
  const googleSync = await googleStatus(auth.userId);

  const { data, error } = await db
    .from("calendar_events")
    .select("id, title, description, starts_at, ends_at, image_url, link_url, location, vip_only, created_at, attendee_ids")
    .order("starts_at", { ascending: true })
    .limit(1000);

  if (error) {
    // Degrade gracefully (200, empty list) but STILL return canManage — so the
    // admin's "+ Add event" button never disappears just because the events
    // query hiccuped. A hard 500 here used to hide the admin controls entirely.
    console.error("[portal/calendar] list error:", error.message);
    return NextResponse.json({ events: [], premium, canManage, feedToken: signFeedToken(auth.userId), googleSync }, { status: 200 });
  }

  const events = ((data ?? []) as EventRow[])
    // Tagged-attendee events are PRIVATE: only the tagged people (+ admins) see
    // them. An empty attendee list means the event is public to everyone.
    .filter((e) => {
      if (canManage) return true;
      const att = e.attendee_ids ?? [];
      return att.length === 0 || att.includes(auth.userId);
    })
    .map((e) => {
      const locked = e.vip_only && !premium;
      return {
        id: e.id,
        title: e.title,
        // Withhold the payoff fields from non-premium viewers of a legacy VIP event.
        description: locked ? "" : e.description,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        image_url: e.image_url,
        link_url: locked ? "" : e.link_url,
        location: locked ? "" : e.location,
        vip_only: e.vip_only,
        locked,
        // Tagged attendee ids — only exposed to admins (for the manage view).
        attendee_ids: canManage ? (e.attendee_ids ?? []) : undefined,
      };
    });

  return NextResponse.json({ events, premium, canManage, feedToken: signFeedToken(auth.userId), googleSync });
}

// ── POST: create event (supreme admin) ───────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rl = enforceRateLimit(req, "calendar-write", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  let body: {
    title?: string; description?: string; starts_at?: string; ends_at?: string;
    image_url?: string; link_url?: string; location?: string; vip_only?: boolean;
    attendee_ids?: unknown;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const title = MAX(body.title, 200);
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });

  const startMs = Date.parse(MAX(body.starts_at, 40));
  if (!Number.isFinite(startMs)) return NextResponse.json({ error: "invalid_start" }, { status: 400 });

  let endMs: number | null = null;
  const endRaw = MAX(body.ends_at, 40);
  if (endRaw) {
    const parsed = Date.parse(endRaw);
    if (Number.isFinite(parsed) && parsed >= startMs) endMs = parsed;
  }

  // Tagged attendees (uuid[]). Empty → public event; otherwise only these
  // people (any candidate / sub-admin / org admin) + admins see it.
  const attendee_ids = Array.isArray(body.attendee_ids)
    ? Array.from(new Set((body.attendee_ids as unknown[]).filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))).slice(0, 500)
    : [];

  const baseRow = {
    title,
    description: MAX(body.description, 4000),
    image_url: safeImageUrl(body.image_url),
    link_url: safeLinkUrl(body.link_url),
    location: MAX(body.location, 200),
    vip_only: body.vip_only === true,
    attendee_ids,
    created_by: auth.userId,
  };

  // Optional weekly recurrence — expand into N independent rows (each can be
  // edited / deleted on its own). Clamped 1..52 so a bad value can't flood the
  // table. repeat_weekly absent or 1 → a single event (the common case).
  const repeat = Math.max(1, Math.min(52, Math.floor(Number((body as { repeat_weekly?: unknown }).repeat_weekly) || 1)));
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const rows = Array.from({ length: repeat }, (_, i) => ({
    ...baseRow,
    starts_at: new Date(startMs + i * WEEK).toISOString(),
    ends_at: endMs != null ? new Date(endMs + i * WEEK).toISOString() : null,
  }));

  const db = getServiceSupabase();
  const { data: inserted, error } = await db.from("calendar_events")
    .insert(rows)
    .select("id, title, description, starts_at, ends_at, location, link_url, attendee_ids");
  if (error) {
    console.error("[portal/calendar] insert error:", error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  const created = (inserted ?? []) as PushEvent[];
  // Notify tagged attendees ONCE (not once per recurrence) — masked as "Borivon".
  // Skip the creator themselves (they obviously know about their own event).
  const anchorId = created[0]?.id ?? "";
  const recipients = attendee_ids.filter((uid) => uid !== auth.userId);
  await notifyAttendees(db, anchorId, title, recipients);
  // Instant push into connected Google calendars (no-op unless OAuth configured).
  try { await fanOutUpsert(created); } catch (e) { console.error("[portal/calendar] gcal push:", (e as Error)?.message); }
  return NextResponse.json({ ok: true, count: rows.length });
}

// ── PATCH: edit an existing event (supreme admin) ────────────────────────────
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  let body: {
    title?: string; description?: string; starts_at?: string; ends_at?: string;
    image_url?: string; link_url?: string; location?: string; attendee_ids?: unknown;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const title = MAX(body.title, 200);
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });
  const startMs = Date.parse(MAX(body.starts_at, 40));
  if (!Number.isFinite(startMs)) return NextResponse.json({ error: "invalid_start" }, { status: 400 });
  let ends_at: string | null = null;
  const endRaw = MAX(body.ends_at, 40);
  if (endRaw) { const p = Date.parse(endRaw); if (Number.isFinite(p) && p >= startMs) ends_at = new Date(p).toISOString(); }
  const attendee_ids = Array.isArray(body.attendee_ids)
    ? Array.from(new Set((body.attendee_ids as unknown[]).filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))).slice(0, 500)
    : [];

  const db = getServiceSupabase();
  // Snapshot the existing attendees first so we can notify ONLY the newly-added
  // people on edit (re-notifying everyone on every save would be spam).
  const { data: existing } = await db.from("calendar_events").select("attendee_ids").eq("id", id).maybeSingle();
  const oldIds = new Set(((existing as { attendee_ids?: string[] } | null)?.attendee_ids) ?? []);

  const { error } = await db.from("calendar_events").update({
    title,
    description: MAX(body.description, 4000),
    starts_at: new Date(startMs).toISOString(),
    ends_at,
    image_url: safeImageUrl(body.image_url),
    link_url: safeLinkUrl(body.link_url),
    location: MAX(body.location, 200),
    attendee_ids,
  }).eq("id", id);
  if (error) {
    console.error("[portal/calendar] update error:", error.message);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  // Notify only people added in THIS edit (never the editor themselves) — masked as "Borivon".
  await notifyAttendees(db, id, title, attendee_ids.filter((uid) => !oldIds.has(uid) && uid !== auth.userId));
  const edited: PushEvent = {
    id, title, description: MAX(body.description, 4000),
    starts_at: new Date(startMs).toISOString(), ends_at,
    location: MAX(body.location, 200), link_url: safeLinkUrl(body.link_url), attendee_ids,
  };
  // Push the edit into connected Google calendars (no-op unless OAuth configured).
  try { await fanOutUpsert([edited]); } catch (e) { console.error("[portal/calendar] gcal push:", (e as Error)?.message); }
  return NextResponse.json({ ok: true });
}

// ── DELETE: remove event (supreme admin) ─────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db.from("calendar_events").delete().eq("id", id);
  if (error) {
    console.error("[portal/calendar] delete error:", error.message);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  // Remove it from connected Google calendars (no-op unless OAuth configured).
  try { await fanOutDelete(id); } catch (e) { console.error("[portal/calendar] gcal delete:", (e as Error)?.message); }
  return NextResponse.json({ ok: true });
}
