import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { bookWorkspaceEvent, listEventsInWindow, BORIVON_TZ } from "@/lib/workspaceCalendar";
import { keepAlive } from "@/lib/keepAlive";
import { getAdminUserId } from "@/lib/telegram";
import {
  DEFAULT_AVAILABILITY, generateSlots, groupByDay, slotLabel, looksLikeEmail,
  followUpsFor, zoneOffsetMinutes, type Availability, type BookingKind, type Interval,
} from "@/lib/booking";

/**
 * PUBLIC booking endpoint — the Calendly-style "book a call with Borivon" page.
 *
 *   GET  → the slots actually on offer (no auth; this is a public page)
 *   POST → take a slot: real Google Calendar event + Meet link + invite email,
 *          a `leads` row so it enters the existing funnel, and the follow-up
 *          reminders that are the entire point of the feature.
 *
 * SECURITY, because this is an UNAUTHENTICATED write:
 *  • rate limited per IP — a public booking form is a spam magnet.
 *  • every field validated and length-capped before it touches the DB.
 *  • the slot must be one the engine currently offers, so nobody can POST an
 *    arbitrary timestamp and land a 3am Sunday meeting in the founder's calendar.
 *  • double-booking is caught by a UNIQUE INDEX, not a read-then-write check.
 *  • the response never echoes anything about OTHER bookings.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Availability resolved against the REAL Casablanca offset at request time, so
 *  the page never shifts by an hour during Morocco's Ramadan clock change. */
function availability(): Availability {
  return { ...DEFAULT_AVAILABILITY, tzOffsetMinutes: zoneOffsetMinutes(BORIVON_TZ) };
}
const KINDS: BookingKind[] = ["nurse", "clinic", "company"];
const isKind = (k: unknown): k is BookingKind => typeof k === "string" && (KINDS as string[]).includes(k);

/** The founder's real calendar for the offer window, as busy intervals. */
async function busyIntervals(from: number, to: number): Promise<Interval[]> {
  try {
    const res = await listEventsInWindow({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    if (!res.ok) return [];
    return res.events
      // All-day entries ("Ramadan", "Youness in Berlin") and "Show as: Free"
      // events are on the calendar but are not meetings — they must not close
      // the whole day. Only real timed, busy events block.
      .filter((e) => !e.allDay && !e.transparent && e.start && e.end)
      .map((e) => ({ start: Date.parse(e.start!), end: Date.parse(e.end!) }))
      .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start);
  } catch {
    // Calendar unreachable → offer the plain schedule rather than nothing. A
    // rare double-book the founder can move beats a booking page that is dead.
    return [];
  }
}

/** Slots already taken in our own table (the calendar may lag, and admin-made
 *  bookings might have no calendar event at all). */
async function takenSlots(from: number, to: number): Promise<Set<number>> {
  try {
    const { data } = await getServiceSupabase()
      .from("bookings")
      .select("starts_at,status")
      .gte("starts_at", new Date(from).toISOString())
      .lte("starts_at", new Date(to).toISOString());
    return new Set((data ?? [])
      .filter((b) => (b as { status?: string }).status !== "cancelled")
      .map((b) => Date.parse((b as { starts_at: string }).starts_at)));
  } catch { return new Set(); }
}

export async function GET(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "book-slots", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const av = availability();
  const now = Date.now();
  const horizonEnd = now + (av.horizonDays + 1) * 86_400_000;
  const [busy, taken] = await Promise.all([busyIntervals(now, horizonEnd), takenSlots(now, horizonEnd)]);
  const slots = generateSlots({ now, availability: av, busy }).filter((s) => !taken.has(s));

  return NextResponse.json({
    tzOffsetMinutes: av.tzOffsetMinutes,
    slotMinutes: av.slotMinutes,
    days: groupByDay(slots, av.tzOffsetMinutes).map((d) => ({
      day: d.day,
      slots: d.slots.map((s) => ({ at: s, label: slotLabel(s, av.tzOffsetMinutes) })),
    })),
  });
}

export async function POST(req: NextRequest) {
  // Tighter than GET: booking WRITES, and creates a calendar event + emails.
  // Distributed (Postgres-backed) because each Workers isolate has its OWN
  // memory — an in-process counter barely limits anything at the edge.
  const rl = await enforceRateLimitDistributed(req, "book-create", { limit: 5, windowMs: 10 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited", message: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  }

  // A real booking is well under 1 KB; cap the body so a bot can't POST megabytes.
  if (Number(req.headers.get("content-length") ?? 0) > 8 * 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind;
  const at = Number(body?.at);
  const name = String(body?.name ?? "").trim().slice(0, 120);
  const email = String(body?.email ?? "").trim().slice(0, 254).toLowerCase();
  const phone = String(body?.phone ?? "").trim().slice(0, 40) || null;
  const company = String(body?.company ?? "").trim().slice(0, 160) || null;
  const note = String(body?.note ?? "").trim().slice(0, 1000) || null;

  if (!isKind(kind)) return NextResponse.json({ error: "bad_kind" }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "bad_name" }, { status: 400 });
  if (!looksLikeEmail(email)) return NextResponse.json({ error: "bad_email" }, { status: 400 });
  if (!Number.isFinite(at)) return NextResponse.json({ error: "bad_slot" }, { status: 400 });

  // The slot must be one we CURRENTLY offer. Without this a crafted POST could
  // put any timestamp — 3am, a Sunday, next year — into the founder's calendar.
  const av = availability();
  const now = Date.now();
  const horizonEnd = now + (av.horizonDays + 1) * 86_400_000;
  const [busy, taken] = await Promise.all([busyIntervals(now, horizonEnd), takenSlots(now, horizonEnd)]);
  const offered = generateSlots({ now, availability: av, busy }).filter((s) => !taken.has(s));
  if (!offered.includes(at)) {
    return NextResponse.json({ error: "slot_unavailable", message: "That time was just taken. Please pick another." }, { status: 409 });
  }

  const endsAt = at + av.slotMinutes * 60_000;
  const db = getServiceSupabase();

  // Claim the slot FIRST. The partial unique index on starts_at is what makes
  // two simultaneous bookings safe — the loser gets 23505 here, before we've
  // created a calendar event or emailed anybody.
  const ins = await db.from("bookings").insert({
    kind, name, email, phone, company, note,
    starts_at: new Date(at).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    source: "public",
  }).select("id").single();

  if (ins.error) {
    if ((ins.error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "slot_unavailable", message: "That time was just taken. Please pick another." }, { status: 409 });
    }
    console.error("[book] insert failed:", ins.error.message);
    return NextResponse.json({ error: "booking_failed" }, { status: 500 });
  }
  const bookingId = ins.data?.id as number;

  const TITLES: Record<BookingKind, string> = {
    nurse: `Borivon — ${name} (nurse, work in Germany)`,
    clinic: `Borivon — ${company || name} (clinic, needs nurses)`,
    company: `Borivon — ${company || name} (German training)`,
  };

  // Calendar + lead + reminders run AFTER the response on Workers (keepAlive →
  // waitUntil), so the visitor gets their confirmation immediately instead of
  // waiting on Google. The slot is already safely claimed above.
  keepAlive(async () => {
    let eventId: string | null = null;
    let meet: string | null = null;
    try {
      const ev = await bookWorkspaceEvent({
        title: TITLES[kind],
        startsAt: new Date(at).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        description: [company ? `Organisation: ${company}` : null, phone ? `Phone: ${phone}` : null, note ? `Note: ${note}` : null]
          .filter(Boolean).join("\n") || undefined,
        addMeet: true,
        attendees: [email],
        sendUpdates: "all",
      });
      if (ev.ok) {
        eventId = ev.id ?? null;
        meet = ev.meetLink ?? null;
        await db.from("bookings").update({ calendar_event_id: eventId, meet_link: meet }).eq("id", bookingId);
      }
    } catch (e) {
      console.error("[book] calendar event failed:", e instanceof Error ? e.message : e);
    }

    // Into the existing funnel. `leads` declares name/phone/message/details as
    // NOT NULL DEFAULT '' — passing null would be rejected, so coalesce.
    try {
      const lead = await db.from("leads").insert({
        kind, email,
        name, phone: phone ?? "",
        message: [company ? `Org: ${company}` : null, note].filter(Boolean).join(" — ") || `Booked a ${kind} call`,
        details: { source: "booking", company: company ?? "", at: new Date(at).toISOString() },
      }).select("id").single();
      if (lead.data?.id) await db.from("bookings").update({ lead_id: lead.data.id }).eq("id", bookingId);
    } catch (e) {
      console.error("[book] lead insert failed:", e instanceof Error ? e.message : e);
    }

    // THE FOLLOW-UPS — the reason this feature exists.
    try {
      const owner = await getAdminUserId();
      if (owner) {
        await db.from("assistant_reminders").insert(
          followUpsFor({ startsAt: at, name: company || name, kind }).map((f) => ({
            owner_user_id: owner,
            text: f.text,
            due_at: new Date(f.dueAt).toISOString(),
            due_date: new Date(f.dueAt).toISOString().slice(0, 10),
          })),
        );
      }
    } catch (e) {
      console.error("[book] follow-up reminders failed:", e instanceof Error ? e.message : e);
    }
  });

  return NextResponse.json({ ok: true, at, endsAt, kind });
}
