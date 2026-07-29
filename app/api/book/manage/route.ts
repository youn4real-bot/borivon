import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { bookWorkspaceEvent, cancelWorkspaceEvent, updateWorkspaceEvent, listEventsInWindow, BORIVON_TZ } from "@/lib/workspaceCalendar";
import { keepAlive } from "@/lib/keepAlive";
import { getAdminUserId, tgSend } from "@/lib/telegram";
import { sendBookingChangedEmail } from "@/lib/email";
import { loadBookingConfig, looksLikeManageToken } from "@/lib/bookingConfig";
import { generateSlots, groupByDay, slotLabel, followUpsFor, zoneOffsetMinutes, type BookingKind, type Interval } from "@/lib/booking";

/**
 * SELF-SERVICE booking management — the "reschedule or cancel" link.
 *
 * Someone who can move their own call moves it; someone who can't simply doesn't
 * turn up. This is the single biggest lever on no-shows, and it's why the link
 * goes in both the confirmation and the reminder email.
 *
 * AUTH IS THE TOKEN, and nothing else. 32 bytes of CSPRNG entropy in the URL is
 * the whole credential, so:
 *  • the token is validated by SHAPE before it ever reaches the database;
 *  • lookups are rate limited, so it can't be brute-forced;
 *  • an unknown token returns the SAME generic 404 as an expired one, revealing
 *    nothing about whether a booking exists;
 *  • the response carries only that booking — never a list, never another
 *    person's details.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: number; kind: BookingKind; name: string; email: string | null; company: string | null;
  starts_at: string; ends_at: string; status: string; meet_link: string | null;
  calendar_event_id: string | null;
  /** The language they booked in. Null for admin-entered bookings → English. */
  lang: "fr" | "en" | "de" | null;
};

const NOT_FOUND = NextResponse.json({ error: "not_found" }, { status: 404 });

const BASE_COLS = "id,kind,name,email,company,starts_at,ends_at,status,meet_link,calendar_event_id";

/**
 * The booking behind a token.
 *
 * SELECTING `lang` MUST NOT BE ABLE TO KILL THIS. Before booking_lang.sql is
 * run, asking for that column errors the whole query — which returned null,
 * which the caller reads as "no such booking". Every reschedule/cancel link in
 * existence would have shown "Link not valid" over a missing translation hint,
 * taking out the entire no-show defence. (Measured: the page said exactly that.)
 * So the language is a second, optional attempt on top of a query that works.
 */
async function findByToken(token: string): Promise<Row | null> {
  const db = getServiceSupabase();
  const withLang = await db.from("bookings").select(`${BASE_COLS},lang`).eq("manage_token", token).maybeSingle();
  if (!withLang.error) return (withLang.data as Row | null) ?? null;

  const bare = await db.from("bookings").select(BASE_COLS).eq("manage_token", token).maybeSingle();
  if (bare.error || !bare.data) return null;
  return { ...(bare.data as Omit<Row, "lang">), lang: null };
}

/** Busy = the founder's real calendar, minus THIS booking's own event (moving a
 *  call must not be blocked by the slot it currently occupies). */
async function busyExcluding(from: number, to: number, ownEventId: string | null): Promise<Interval[]> {
  try {
    const res = await listEventsInWindow({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    if (!res.ok) return [];
    return res.events
      .filter((e) => !e.allDay && !e.transparent && e.start && e.end && e.eventId !== ownEventId)
      .map((e) => ({ start: Date.parse(e.start!), end: Date.parse(e.end!) }))
      .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start);
  } catch { return []; }
}

/** Other live bookings as intervals — again excluding this one. */
async function otherBookings(from: number, to: number, slotMs: number, ownId: number): Promise<Interval[]> {
  try {
    const { data } = await getServiceSupabase()
      .from("bookings")
      .select("id,starts_at,ends_at,status")
      .gte("starts_at", new Date(from - Math.max(slotMs, 4 * 3_600_000)).toISOString())
      .lte("starts_at", new Date(to).toISOString());
    return (data ?? [])
      .filter((b) => (b as { status?: string }).status !== "cancelled" && (b as { id: number }).id !== ownId)
      .map((b) => {
        const r = b as { starts_at: string; ends_at: string | null };
        const start = Date.parse(r.starts_at);
        const end = r.ends_at ? Date.parse(r.ends_at) : NaN;
        return { start, end: Number.isFinite(end) && end > start ? end : start + slotMs };
      })
      .filter((i) => Number.isFinite(i.start));
  } catch { return []; }
}

/** GET — the booking behind this token, plus the times it could move to. */
export async function GET(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "book-manage-get", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!looksLikeManageToken(token)) return NOT_FOUND;
  const row = await findByToken(token);
  if (!row) return NOT_FOUND;

  const { availability: av } = await loadBookingConfig();
  const now = Date.now();
  const horizonEnd = now + (av.horizonDays + 1) * 86_400_000;
  const slotMs = av.slotMinutes * 60_000;
  const [cal, others] = await Promise.all([
    busyExcluding(now, horizonEnd, row.calendar_event_id),
    otherBookings(now, horizonEnd, slotMs, row.id),
  ]);
  const slots = generateSlots({ now, availability: av, busy: [...cal, ...others] });

  return NextResponse.json({
    booking: {
      kind: row.kind,
      name: row.name,
      company: row.company,
      startsAt: Date.parse(row.starts_at),
      status: row.status,
      meetLink: row.meet_link,
      // Past bookings can be viewed but not changed — the page says so.
      past: Date.parse(row.starts_at) < now,
    },
    slotMinutes: av.slotMinutes,
    days: groupByDay(slots, av.tzOffsetMinutes).map((d) => ({
      day: d.day,
      slots: d.slots.map((s) => ({ at: s, label: slotLabel(s, zoneOffsetMinutes(BORIVON_TZ, s)) })),
    })),
  });
}

/** POST — cancel, or move to another offered slot. */
export async function POST(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "book-manage-post", { limit: 10, windowMs: 10 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "");
  const action = String(body?.action ?? "");
  if (!looksLikeManageToken(token)) return NOT_FOUND;
  if (action !== "cancel" && action !== "reschedule") {
    return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }

  const row = await findByToken(token);
  if (!row) return NOT_FOUND;
  if (row.status === "cancelled") return NextResponse.json({ error: "already_cancelled" }, { status: 409 });
  if (Date.parse(row.starts_at) < Date.now()) {
    return NextResponse.json({ error: "already_past", message: "That appointment has already taken place." }, { status: 409 });
  }

  const db = getServiceSupabase();

  /* ─────────────────────────────── cancel ──────────────────────────────── */
  if (action === "cancel") {
    const { error } = await db.from("bookings").update({ status: "cancelled" }).eq("id", row.id);
    if (error) {
      console.error("[book/manage] cancel failed:", error.message);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
    keepAlive(async () => {
      if (row.calendar_event_id) {
        try { await cancelWorkspaceEvent(row.calendar_event_id); }
        catch (e) { console.error("[book/manage] event cancel failed:", e instanceof Error ? e.message : e); }
      }
      if (row.email) {
        try {
          await sendBookingChangedEmail({
            to: row.email, name: row.name, startsAt: row.starts_at, cancelled: true, manageToken: token,
            lang: row.lang ?? undefined,
          });
        } catch { /* the booking is already cancelled; the email is a courtesy */ }
      }
      await notifyFounder(`Booking cancelled — ${row.kind}`, row, Date.parse(row.starts_at));
      // Their follow-up chase is meaningless now. Drop the ones still pending.
      await dropFollowUps(row);
    });
    return NextResponse.json({ ok: true, cancelled: true });
  }

  /* ────────────────────────────── reschedule ───────────────────────────── */
  const at = Number(body?.at);
  if (!Number.isFinite(at)) return NextResponse.json({ error: "bad_slot" }, { status: 400 });

  const { availability: av, accepting } = await loadBookingConfig();
  if (!accepting) return NextResponse.json({ error: "not_accepting" }, { status: 409 });

  const now = Date.now();
  const horizonEnd = now + (av.horizonDays + 1) * 86_400_000;
  const slotMs = av.slotMinutes * 60_000;
  const [cal, others] = await Promise.all([
    busyExcluding(now, horizonEnd, row.calendar_event_id),
    otherBookings(now, horizonEnd, slotMs, row.id),
  ]);
  // Same gate as a fresh booking: the new time must be one we CURRENTLY offer.
  if (!generateSlots({ now, availability: av, busy: [...cal, ...others] }).includes(at)) {
    return NextResponse.json({ error: "slot_unavailable", message: "That time is no longer free. Please pick another." }, { status: 409 });
  }

  const endsAt = at + slotMs;
  const upd = await db.from("bookings")
    .update({
      starts_at: new Date(at).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      rescheduled_from: row.starts_at,
      // The day-before reminder must be re-armed for the NEW date, or a booking
      // moved after its reminder went out would never be reminded again.
      reminded_at: null,
    })
    .eq("id", row.id);

  if (upd.error) {
    if ((upd.error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "slot_unavailable", message: "That time was just taken. Please pick another." }, { status: 409 });
    }
    // rescheduled_from / reminded_at may not exist yet — retry without them
    // rather than refuse the move.
    if (/rescheduled_from|reminded_at|column .* does not exist|schema cache/i.test(upd.error.message ?? "")) {
      const retry = await db.from("bookings")
        .update({ starts_at: new Date(at).toISOString(), ends_at: new Date(endsAt).toISOString() })
        .eq("id", row.id);
      if (retry.error) {
        console.error("[book/manage] reschedule failed:", retry.error.message);
        return NextResponse.json({ error: "update_failed" }, { status: 500 });
      }
    } else {
      console.error("[book/manage] reschedule failed:", upd.error.message);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
  }

  keepAlive(async () => {
    // Move the real calendar event so the founder's diary and Google's invite
    // both follow. If the booking somehow has no event, create one.
    try {
      if (row.calendar_event_id) {
        // updateWorkspaceEvent already patches with sendUpdates:"all", so Google
        // emails the attendee the new time and their calendar entry moves itself.
        await updateWorkspaceEvent({
          eventId: row.calendar_event_id,
          startsAt: new Date(at).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        });
      } else {
        const ev = await bookWorkspaceEvent({
          title: `Borivon — ${row.company || row.name} (${row.kind})`,
          startsAt: new Date(at).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          addMeet: true,
          attendees: row.email ? [row.email] : [],
          sendUpdates: row.email ? "all" : "none",
        });
        if (ev.ok) {
          await db.from("bookings").update({ calendar_event_id: ev.id ?? null, meet_link: ev.meetLink ?? null }).eq("id", row.id);
        }
      }
    } catch (e) {
      console.error("[book/manage] event move failed:", e instanceof Error ? e.message : e);
    }

    if (row.email) {
      try {
        await sendBookingChangedEmail({
          to: row.email, name: row.name, startsAt: new Date(at).toISOString(), cancelled: false, manageToken: token,
          lang: row.lang ?? undefined,
        });
      } catch { /* the move already stands; the email is a courtesy */ }
    }
    await notifyFounder(`Booking moved — ${row.kind}`, row, at);
    // Re-arm the chase around the NEW time.
    await dropFollowUps(row);
    await addFollowUps(row, at);
  });

  return NextResponse.json({ ok: true, at, endsAt });
}

/* ── shared bits ──────────────────────────────────────────────────────────── */

async function notifyFounder(headline: string, row: Row, at: number): Promise<void> {
  try {
    const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
    if (!chatId) return;
    const when = new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: BORIVON_TZ,
    }).format(new Date(at));
    await tgSend(chatId, [headline, row.company || row.name, when].join("\n"));
  } catch { /* a missed ping must never fail the change itself */ }
}

/**
 * Remove the not-yet-sent chase for THIS booking — and only this one.
 *
 * It used to match on the person's name alone (`ilike text %Name (kind)%`),
 * which is identical for every booking that person ever makes. So a clinic that
 * had an intro call and a second call, cancelling or moving the first, lost the
 * pending chase for the SECOND as well — and only the changed booking's chase
 * was re-armed. The founder simply never got the day-before ping, the
 * log-the-outcome ping or the two-day follow-up for the other call, which is
 * the entire point of the feature.
 *
 * `bookings_slot_unique` (supabase/bookings.sql) guarantees no two live
 * bookings share a `starts_at`, so the exact due instants that followUpsFor
 * derives from a start identify one booking's reminders and no other. On the
 * reschedule path `row` is still the pre-update row, so `row.starts_at` is the
 * OLD start — precisely the rows to remove.
 *
 * The name stays in the filter as a second condition, with LIKE wildcards
 * escaped: a booker called "50%_off" must not widen the match.
 */
async function dropFollowUps(row: Row): Promise<void> {
  try {
    const owner = await getAdminUserId();
    if (!owner) return;
    const startedAt = Date.parse(row.starts_at);
    if (!Number.isFinite(startedAt)) return;

    // Same derivation addFollowUps used to create them. No `now`, so an
    // already-past due time is still returned and therefore still cleaned up.
    const mine = followUpsFor({ startsAt: startedAt, name: row.company || row.name, kind: row.kind });
    if (!mine.length) return;

    const who = `${row.company || row.name} (${row.kind})`.replace(/[\\%_]/g, (c) => `\\${c}`);
    await getServiceSupabase().from("assistant_reminders")
      .delete()
      .eq("owner_user_id", owner)
      .eq("done", false)
      .is("notified_at", null)          // never delete one already sent
      .ilike("text", `%${who}%`)
      .in("due_at", mine.map((f) => new Date(f.dueAt).toISOString()));
  } catch (e) {
    console.error("[book/manage] drop follow-ups failed:", e instanceof Error ? e.message : e);
  }
}

async function addFollowUps(row: Row, at: number): Promise<void> {
  try {
    const owner = await getAdminUserId();
    if (!owner) return;
    const due = followUpsFor({ startsAt: at, name: row.company || row.name, kind: row.kind, now: Date.now() });
    if (!due.length) return;
    await getServiceSupabase().from("assistant_reminders").insert(
      due.map((f) => ({
        owner_user_id: owner,
        text: f.text,
        due_at: new Date(f.dueAt).toISOString(),
        due_date: new Date(f.dueAt).toISOString().slice(0, 10),
      })),
    );
  } catch (e) {
    console.error("[book/manage] re-arm follow-ups failed:", e instanceof Error ? e.message : e);
  }
}
