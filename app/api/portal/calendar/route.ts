import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, requireAdminRole } from "@/lib/admin-auth";
import { enforceRateLimit, enforceUserRateLimit } from "@/lib/rateLimit";
import { UUID_RE } from "@/lib/uuid";
import { signFeedToken } from "@/lib/calendarFeed";
import { googleStatus, fanOutUpsert, fanOutDelete, type PushEvent } from "@/lib/googleCalendar";
import { listEventsInWindow, BORIVON_TZ } from "@/lib/workspaceCalendar";

/**
 * ONE CALENDAR. Three sources, merged in the GET below for staff:
 *   portal   — community events in `calendar_events` (what this page always was)
 *   booking  — somebody who booked at /book, or an admin-entered call. Carries
 *              who booked and the Google Meet link, so the diary is actionable
 *              rather than just informative.
 *   google   — the founder's real Workspace calendar, so a slot filled ANYWHERE
 *              shows up here and staff never double-book him.
 *
 * PRIVACY: a Google event's real title is only ever sent to the supreme admin.
 * To any other staff member it arrives as "Busy" with no description, no
 * location and no link — enough to see the diary is full, nothing more. His
 * personal appointments are not the team's business.
 */
type MergedSource = "portal" | "booking" | "google";

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

  const rl = await enforceUserRateLimit("cal-read", `u:${auth.userId}`, { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

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

  // ── Merge in bookings + the real Google diary, for STAFF only ──────────────
  // Candidates see the community calendar exactly as before; nothing below is
  // ever sent to them.
  const staff = await staffView(req);
  const merged: unknown[] = events.map((e) => ({ ...e, source: "portal" as MergedSource }));

  if (staff.isStaff) {
    const from = Date.now() - 30 * 86_400_000;
    const to = Date.now() + 120 * 86_400_000;

    const [bookingRows, gcal] = await Promise.all([
      // Wrapped so a missing table (bookings.sql not run) degrades to an empty
      // list instead of taking the whole calendar down.
      (async () => {
        try {
          const r = await db.from("bookings")
            .select("id,kind,name,company,email,phone,starts_at,ends_at,status,meet_link,source")
            .gte("starts_at", new Date(from).toISOString())
            .lte("starts_at", new Date(to).toISOString())
            .neq("status", "cancelled")
            .order("starts_at");
          return r.error ? [] : (r.data ?? []);
        } catch { return []; }
      })(),
      (async () => {
        try {
          const r = await listEventsInWindow({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
          return r.ok ? r.events : [];
        } catch { return []; }
      })(),
    ]);

    type BRow = {
      id: number; kind: string; name: string; company: string | null; email: string | null;
      phone: string | null; starts_at: string; ends_at: string | null; status: string;
      meet_link: string | null; source: string;
    };
    for (const b of bookingRows as BRow[]) {
      merged.push({
        id: `booking:${b.id}`,
        source: "booking" as MergedSource,
        title: `${b.company || b.name} — ${b.kind}`,
        description: [b.email, b.phone].filter(Boolean).join(" · "),
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        image_url: null, link_url: b.meet_link ?? "", location: "",
        vip_only: false, locked: false,
        booking: {
          id: b.id, kind: b.kind, name: b.name, company: b.company,
          email: b.email, phone: b.phone, status: b.status,
          meetLink: b.meet_link, addedByHand: b.source === "admin",
        },
      });
    }

    // The founder's own Workspace events. Skip anything we already show as a
    // booking (those created the Google event in the first place) so one call
    // never appears twice in the same grid.
    const bookedStarts = new Set((bookingRows as BRow[]).map((b) => Date.parse(b.starts_at)));
    for (const g of gcal) {
      if (!g.start || g.allDay) continue;
      const startMs = Date.parse(g.start);
      if (!Number.isFinite(startMs) || bookedStarts.has(startMs)) continue;
      merged.push({
        id: `google:${g.eventId}`,
        source: "google" as MergedSource,
        // Only the supreme admin sees what it actually is.
        title: staff.isSupreme ? (g.title || "(no title)") : "Busy",
        description: "", image_url: null, link_url: "", location: "",
        starts_at: g.start, ends_at: g.end,
        vip_only: false, locked: false,
        readOnly: true,   // lives in Google; the portal doesn't own it
      });
    }
  }

  return NextResponse.json({
    events: merged,
    premium,
    canManage,
    // Staff get the merged diary + the ability to add a booking from it.
    isStaff: staff.isStaff,
    isSupreme: staff.isSupreme,
    feedToken: signFeedToken(auth.userId),
    googleSync,
    tz: BORIVON_TZ,
  });
}

/**
 * Who is allowed to see the merged diary.
 *
 * Supreme admin and Borivon's own sub-admins — never an agency's staff, who
 * have no business seeing when the founder is free or who booked him. Fails
 * CLOSED: any error resolves to "not staff", i.e. the plain community calendar.
 */
async function staffView(req: NextRequest): Promise<{ isStaff: boolean; isSupreme: boolean }> {
  try {
    const a = await requireAdminRole(req);
    if (!a.ok) return { isStaff: false, isSupreme: false };
    if (a.role === "admin") return { isStaff: true, isSupreme: true };
    if (a.role === "sub_admin" && !a.isAgencyAdmin && !a.agencyId) {
      const { data } = await getServiceSupabase()
        .from("organization_members").select("org_id")
        .ilike("sub_admin_email", a.email.trim().toLowerCase()).limit(1);
      if (!(data ?? []).length) return { isStaff: true, isSupreme: false };
    }
    return { isStaff: false, isSupreme: false };
  } catch {
    return { isStaff: false, isSupreme: false };
  }
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
