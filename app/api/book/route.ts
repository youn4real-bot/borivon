import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { bookWorkspaceEvent, listEventsInWindow, BORIVON_TZ } from "@/lib/workspaceCalendar";
import { keepAlive } from "@/lib/keepAlive";
import { getAdminUserId } from "@/lib/telegram";
import { tgSend } from "@/lib/telegram";
import { sendBookingConfirmedEmail } from "@/lib/email";
import { loadBookingConfig, newManageToken } from "@/lib/bookingConfig";
import {
  generateSlots, groupByDay, slotLabel, looksLikeEmail,
  followUpsFor, zoneOffsetMinutes, sanitizeSelections, describeSelections,
  type BookingKind, type Interval,
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

const KINDS: BookingKind[] = ["nurse", "clinic", "company"];
const isKind = (k: unknown): k is BookingKind => typeof k === "string" && (KINDS as string[]).includes(k);

/**
 * The founder's Google calendar, cached in-isolate for a minute.
 *
 * Measured on production: the slot list took 2.4–4.3s, and essentially all of it
 * was this one call — a Google `events.list` across the whole ~3-week horizon,
 * paginated, on every single page load. The page itself renders in 0.2s, so a
 * visitor sat looking at a spinner for four seconds before seeing a single time.
 * That is the worst possible place to be slow: it is the first thing a nurse or
 * a clinic ever asks of us.
 *
 * A booked slot disappears the instant it is taken, because `bookings` is always
 * read fresh — only the founder's OWN diary can be up to 60s stale, and the only
 * consequence is that a meeting they created seconds ago might still show its
 * time as free for a moment. The POST path deliberately bypasses this cache
 * entirely (`fresh: true`), so the actual claim is always checked against the
 * real calendar. Stale reads, never a stale write.
 *
 * The window is padded 10 minutes past the horizon so an entry cached a minute
 * ago still covers the slightly-later window the next request asks for.
 */
const BUSY_TTL_MS = 60_000;
const BUSY_PAD_MS = 10 * 60_000;
let busyCache: { fetchedAt: number; from: number; to: number; intervals: Interval[] } | null = null;

async function busyIntervals(from: number, to: number, opts?: { fresh?: boolean }): Promise<Interval[]> {
  if (!opts?.fresh) {
    const c = busyCache;
    if (c && Date.now() - c.fetchedAt < BUSY_TTL_MS && c.from <= from && c.to >= to) return c.intervals;
  }
  const windowTo = to + BUSY_PAD_MS;
  try {
    const res = await listEventsInWindow({ from: new Date(from).toISOString(), to: new Date(windowTo).toISOString() });
    if (!res.ok) return [];
    const intervals = res.events
      // All-day entries ("Ramadan", "Youness in Berlin") and "Show as: Free"
      // events are on the calendar but are not meetings — they must not close
      // the whole day. Only real timed, busy events block.
      .filter((e) => !e.allDay && !e.transparent && e.start && e.end)
      .map((e) => ({ start: Date.parse(e.start!), end: Date.parse(e.end!) }))
      .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start);
    busyCache = { fetchedAt: Date.now(), from, to: windowTo, intervals };
    return intervals;
  } catch {
    // Calendar unreachable → offer the plain schedule rather than nothing. A
    // rare double-book the founder can move beats a booking page that is dead.
    return [];
  }
}

/**
 * Existing bookings as BUSY INTERVALS — not just their start instants.
 *
 * A manual booking can be any length (the admin picks 15/30/45/60/90), and an
 * admin-made one may have no calendar event at all, so it won't appear in the
 * Google busy list either. Keying only on the exact `starts_at` left a 60-min
 * call blocking its first half-hour and quietly re-offering the second — a
 * guaranteed double-book that the unique index does NOT catch, because the two
 * bookings have different start instants.
 *
 * Widened by one slot length at the front so a booking that STARTS before the
 * window but overlaps into it is still counted.
 */
async function bookedIntervals(from: number, to: number, slotMs: number): Promise<Interval[]> {
  try {
    const { data } = await getServiceSupabase()
      .from("bookings")
      .select("starts_at,ends_at,status")
      .gte("starts_at", new Date(from - Math.max(slotMs, 4 * 3_600_000)).toISOString())
      .lte("starts_at", new Date(to).toISOString());
    return (data ?? [])
      .filter((b) => (b as { status?: string }).status !== "cancelled")
      .map((b) => {
        const row = b as { starts_at: string; ends_at: string | null };
        const start = Date.parse(row.starts_at);
        const end = row.ends_at ? Date.parse(row.ends_at) : NaN;
        return { start, end: Number.isFinite(end) && end > start ? end : start + slotMs };
      })
      .filter((i) => Number.isFinite(i.start));
  } catch { return []; }
}

/**
 * The slot list is IDENTICAL for every visitor, so it belongs in the edge cache.
 *
 * Everything else here only helps a WARM isolate: on a page this quiet, a good
 * share of requests land on a cold one where both in-memory caches start empty
 * and the full Google round-trip runs again. Measured on production after the
 * other fixes: warm ~1.1s, cold ~4-5s. Cloudflare's cache lives in the colo and
 * outlives isolates, so it is the only thing that helps the visitor who arrives
 * first — which is every visitor, on a page nobody reloads.
 *
 * The response carries no per-visitor content: `at` is an absolute instant and
 * the client re-labels every slot in its own timezone. Nothing personal is
 * cached, and there is no auth on this route to leak.
 *
 * 45 seconds of staleness costs at most a slot shown as free moments after
 * someone took it. The POST re-checks against the live calendar and the unique
 * index before claiming anything, so the worst case is the "that time was just
 * taken, pick another" message every booking page in the world shows.
 */
const EDGE_TTL_SECONDS = 45;

/** The cache key: fixed, because the response does not vary by visitor or query. */
function slotsCacheKey(req: NextRequest): Request {
  return new Request(new URL("/api/book/__slots-v1", req.nextUrl.origin).toString(), { method: "GET" });
}

/** Cloudflare's per-colo cache. Absent off-Workers (dev, tests) — then we simply
 *  compute every time, exactly as before. */
function edgeCache(): Cache | null {
  try {
    const c = (globalThis as { caches?: { default?: Cache } }).caches?.default;
    return c ?? null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const t0 = Date.now();

  const cache = edgeCache();
  if (cache) {
    try {
      const hit = await cache.match(slotsCacheKey(req));
      if (hit) {
        const res = new NextResponse(hit.body, hit);
        res.headers.set("Server-Timing", `edge;desc=hit, total;dur=${Date.now() - t0}`);
        return res;
      }
    } catch { /* a cache miss must never be an outage — fall through and compute */ }
  }

  // The rate-limit write and the availability read are two independent round
  // trips to the same database, and running them back to back put a whole extra
  // one on the critical path of every page load. Start both at once; the
  // limiter still gates the response exactly as before.
  const configP = loadBookingConfig();
  configP.catch(() => {}); // it can't reject, but an unhandled one is fatal on Workers

  const rl = await enforceRateLimitDistributed(req, "book-slots", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const { availability: av, accepting } = await configP;
  // The founder can close the page entirely (holiday, full diary) without
  // deleting anything — the picker then shows its "write to us" empty state.
  if (!accepting) {
    return NextResponse.json({ tzOffsetMinutes: av.tzOffsetMinutes, slotMinutes: av.slotMinutes, days: [], accepting: false });
  }
  const now = Date.now();
  const horizonEnd = now + (av.horizonDays + 1) * 86_400_000;
  const slotMs = av.slotMinutes * 60_000;
  const tCal = Date.now();
  const [cal, booked] = await Promise.all([
    busyIntervals(now, horizonEnd),
    bookedIntervals(now, horizonEnd, slotMs),
  ]);
  const calMs = Date.now() - tCal;
  const slots = generateSlots({ now, availability: av, busy: [...cal, ...booked] });

  // `at` is the contract — the client re-labels every slot in the VISITOR's own
  // timezone. These Casablanca labels are for anyone reading the API directly,
  // so each is resolved against its OWN instant rather than one shared offset,
  // which would drift by an hour across a clock change.
  const fresh = NextResponse.json({
    tzOffsetMinutes: av.tzOffsetMinutes,
    slotMinutes: av.slotMinutes,
    accepting: true,
    // The offset is resolved ONCE PER DAY, not once per slot. Every slot in a
    // day shares it — a clock change happens at 02:00/03:00 local, nowhere near
    // bookable hours — and it is the same midday-resolved offset generateSlots
    // used to place them, so the labels cannot disagree with the times. Doing
    // it per slot meant ~160 timezone resolutions on every page load.
    days: groupByDay(slots, av.tzOffsetMinutes).map((d) => {
      const dayOffset = d.slots.length ? zoneOffsetMinutes(BORIVON_TZ, d.slots[0]) : av.tzOffsetMinutes;
      return {
        day: d.day,
        slots: d.slots.map((s) => ({ at: s, label: slotLabel(s, dayOffset) })),
      };
    }),
  }, {
    headers: {
      // Public because it genuinely is: no auth, no per-visitor content. This is
      // also what lets the edge (and the browser) hold it at all.
      "Cache-Control": `public, max-age=${EDGE_TTL_SECONDS}, s-maxage=${EDGE_TTL_SECONDS}`,
      // So this page's latency stays measurable from outside without a deploy
      // to add logging. `cal` is the calendar+bookings fan-out, which is where
      // the time went before it was cached.
      "Server-Timing": `edge;desc=miss, cal;dur=${calMs}, total;dur=${Date.now() - t0}`,
    },
  });

  if (cache) {
    // keepAlive, or the put is cancelled with the request context and the cache
    // stays permanently empty — the exact Workers trap this codebase has been
    // fixing all session. The response must be cloned: a body can only be read
    // once, and the visitor is about to read this one.
    const toStore = fresh.clone();
    keepAlive(() => cache.put(slotsCacheKey(req), toStore));
  }
  return fresh;
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
  // Page language, whitelisted. Anything else falls back to English.
  const lang: "fr" | "en" | "de" = body?.lang === "de" ? "de" : body?.lang === "fr" ? "fr" : "en";

  if (!isKind(kind)) return NextResponse.json({ error: "bad_kind" }, { status: 400 });
  // Tap-only answers. Whitelisted against the catalog, so the one public write
  // in the system can't smuggle arbitrary JSON into a column the admin renders.
  const selections = sanitizeSelections(kind, body?.selections);
  if (name.length < 2) return NextResponse.json({ error: "bad_name" }, { status: 400 });
  if (!looksLikeEmail(email)) return NextResponse.json({ error: "bad_email" }, { status: 400 });
  if (!Number.isFinite(at)) return NextResponse.json({ error: "bad_slot" }, { status: 400 });

  // The slot must be one we CURRENTLY offer. Without this a crafted POST could
  // put any timestamp — 3am, a Sunday, next year — into the founder's calendar.
  const { availability: av, accepting } = await loadBookingConfig();
  if (!accepting) {
    return NextResponse.json({ error: "not_accepting", message: "Bookings are closed right now." }, { status: 409 });
  }
  const now = Date.now();
  const horizonEnd = now + (av.horizonDays + 1) * 86_400_000;
  const slotMs = av.slotMinutes * 60_000;
  const [cal, booked] = await Promise.all([
    // `fresh` — deliberately NOT the cached calendar the GET serves. Showing a
    // slot that a just-created meeting has taken is a cosmetic lag; CLAIMING it
    // is a double-booked founder. The write path always checks reality.
    busyIntervals(now, horizonEnd, { fresh: true }),
    bookedIntervals(now, horizonEnd, slotMs),
  ]);
  const offered = generateSlots({ now, availability: av, busy: [...cal, ...booked] });
  if (!offered.includes(at)) {
    return NextResponse.json({ error: "slot_unavailable", message: "That time was just taken. Please pick another." }, { status: 409 });
  }

  const endsAt = at + av.slotMinutes * 60_000;
  const db = getServiceSupabase();

  // The credential on their "reschedule or cancel" link. Generated before the
  // insert so it lands in the same row — no second write to lose.
  let manageToken: string | null = newManageToken();

  // Claim the slot FIRST. The partial unique index on starts_at is what makes
  // two simultaneous bookings safe — the loser gets 23505 here, before we've
  // created a calendar event or emailed anybody.
  const row = {
    kind, name, email, phone, company, selections,
    starts_at: new Date(at).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    source: "public",
  };
  let ins = await db.from("bookings").insert({ ...row, manage_token: manageToken, lang }).select("id").single();

  /*
   * SCHEMA-TOLERANT, IN TIERS — and the tiers matter.
   *
   * A missing column must cost only ITS OWN feature. A single all-or-nothing
   * fallback to the bare row was wrong: with booking_maxx.sql already run but
   * booking_lang.sql not yet, the absent `lang` failed the first insert and the
   * retry dropped `manage_token` as well — so every booking silently lost its
   * reschedule link, which is the whole no-show defence, over a missing
   * translation hint. (Measured: token came back null.)
   *
   * So: drop `lang` first, and only then, if the token column is genuinely
   * absent too, drop that. A lost BOOKING is the one outcome never acceptable.
   */
  const missingCol = (msg: string | undefined, col: string) =>
    new RegExp(`${col}|column .* does not exist|schema cache`, "i").test(msg ?? "");

  if (ins.error && missingCol(ins.error.message, "lang")) {
    console.warn("[book] `lang` column missing — run supabase/booking_lang.sql");
    ins = await db.from("bookings").insert({ ...row, manage_token: manageToken }).select("id").single();
  }
  if (ins.error && missingCol(ins.error.message, "manage_token")) {
    console.warn("[book] `manage_token` column missing — run supabase/booking_maxx.sql");
    manageToken = null;
    ins = await db.from("bookings").insert(row).select("id").single();
  }

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
  // German, because it's the founder's own calendar and these are German terms
  // of art — "Ambulanter Pflegedienst" says more than "outpatient care service".
  const answers = describeSelections(kind, selections, "de");

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
        description: [company ? `Organisation: ${company}` : null, phone ? `Telefon: ${phone}` : null, answers || null]
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

    // Our own confirmation — Google's invite is plain and easy to miss, and only
    // ours carries the reschedule/cancel link. Sent AFTER the calendar step so
    // the Meet link is already known and can go in the email.
    if (manageToken) {
      try {
        await sendBookingConfirmedEmail({
          to: email, name, startsAt: new Date(at).toISOString(), meetLink: meet, manageToken, lang,
        });
      } catch (e) {
        console.error("[book] confirmation email failed:", e instanceof Error ? e.message : e);
      }
    }

    // Telegram, because that's where the founder actually lives. A clinic
    // booking is a high-value B2B lead and shouldn't wait for him to open a
    // browser. Minimalist per the standing rule: the facts, nothing else.
    try {
      const chatId = (process.env.TELEGRAM_CHAT_ID || "").trim();
      if (chatId) {
        const when = new Intl.DateTimeFormat("en-GB", {
          weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          timeZone: BORIVON_TZ,
        }).format(new Date(at));
        await tgSend(chatId, [
          `New booking — ${kind}`,
          `${company || name}${company ? ` (${name})` : ""}`,
          when,
          email,
          phone || null,
          answers || null,
        ].filter(Boolean).join("\n"));
      }
    } catch (e) {
      console.error("[book] telegram ping failed:", e instanceof Error ? e.message : e);
    }

    // Into the existing funnel. `leads` declares name/phone/message/details as
    // NOT NULL DEFAULT '' — passing null would be rejected, so coalesce.
    try {
      const lead = await db.from("leads").insert({
        kind, email,
        name, phone: phone ?? "",
        message: [company ? `Org: ${company}` : null, answers || null].filter(Boolean).join(" — ") || `Booked a ${kind} call`,
        // The raw ids too, so these stay findable later ("every nurse who
        // ticked Intensivpflege"). Joined into strings because the admin Leads
        // page renders each `details` value directly — an array would come out
        // as "klinikaltenheim".
        details: {
          source: "booking", company: company ?? "", at: new Date(at).toISOString(),
          ...Object.fromEntries(Object.entries(selections).map(([k, v]) => [k, v.join(", ")])),
        },
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
          followUpsFor({ startsAt: at, name: company || name, kind, now: Date.now() }).map((f) => ({
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

  // Drop the cached slot list so the time just taken stops being offered right
  // away, rather than lingering for the rest of the 45s window. Best-effort: if
  // this fails the cache simply expires on its own, and the POST path re-checks
  // against the live calendar regardless, so nothing can actually be
  // double-booked either way.
  {
    const cache = edgeCache();
    if (cache) keepAlive(() => cache.delete(slotsCacheKey(req)));
  }

  return NextResponse.json({ ok: true, at, endsAt, kind });
}
