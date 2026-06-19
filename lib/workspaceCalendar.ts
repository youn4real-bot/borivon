/**
 * NATIVE Google Calendar writes for the bot — straight into the FOUNDER'S OWN
 * Google Calendar (the one they actually look at), via the domain-wide-delegation
 * client in lib/googleWorkspace (impersonating the founder's Workspace mailbox).
 *
 * This is distinct from:
 *   • lib/googleCalendar.ts — the legacy per-USER OAuth push of PORTAL community
 *     events into each connected user's calendar (inert unless OAuth is set up).
 *   • the calendar_events table — the portal's candidate-facing "Calendar" tab.
 *
 * "Book me X / schedule a call / block 2pm" → the founder's private calendar →
 * here. Fail-safe: returns {ok:false} when Workspace isn't connected so the bot
 * can tell the admin instead of silently dropping it.
 */
import { calendarClient } from "@/lib/googleWorkspace";
import type { calendar_v3 } from "googleapis";
import { randomUUID } from "node:crypto";

/** The founder's timezone (Morocco). Override with CALENDAR_TZ if they relocate. */
export const BORIVON_TZ = (process.env.CALENDAR_TZ || "Africa/Casablanca").trim();

const HAS_TZ = /([zZ])$|[+-]\d{2}:?\d{2}$/;

/** Build a Google Calendar date object from an ISO string. If the string already
 *  carries a Z or a ±hh:mm offset, it's an absolute instant — pass as-is. If it's
 *  a bare local wall-clock ("2026-06-15T15:00:00"), tag it with the founder's TZ
 *  so "15:00" means 15:00 in Casablanca (Google applies the real offset, incl.
 *  Morocco's Ramadan shift) — never the server's UTC. */
function calTime(iso: string): { dateTime: string; timeZone?: string } {
  const t = iso.trim();
  return HAS_TZ.test(t) ? { dateTime: t } : { dateTime: t, timeZone: BORIVON_TZ };
}

/** ms offset of `tz` from UTC at a given instant (handles DST / Morocco's Ramadan shift). */
function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).reduce((a, p) => { if (p.type !== "literal") a[p.type] = p.value; return a; }, {} as Record<string, string>);
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUTC - date.getTime();
}

/** A bare local wall-clock ("2026-06-18T00:00:00"), interpreted in BORIVON_TZ, as a
 *  true UTC instant. If it already carries Z/offset, it's absolute → parse as-is.
 *  Used for calendar WINDOW bounds + duration math so they mean Casablanca time, not
 *  the server's UTC (B5/B15). */
function localToInstant(iso: string): Date {
  const t = (iso ?? "").trim();
  if (HAS_TZ.test(t)) return new Date(Date.parse(t));
  const provisional = new Date(t + "Z");            // treat the wall-clock as if UTC
  return new Date(provisional.getTime() - tzOffsetMs(provisional, BORIVON_TZ)); // shift to true UTC
}

/** Start of "today" in BORIVON_TZ, as a UTC instant (B16 default window floor). */
function startOfTodayTz(): Date {
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: BORIVON_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return localToInstant(`${todayIso}T00:00:00`);
}

export type BookEventResult =
  | { ok: true; id: string; htmlLink?: string; meetLink?: string }
  | { ok: false; error: string };

/** Create an event in the founder's own Google Calendar (calendarId "primary").
 *  startsAt required (ISO); endsAt optional (defaults to +60 min). When addMeet
 *  is set, Google provisions a Google Meet video link and we return it. */
export async function bookWorkspaceEvent(opts: {
  title: string;
  startsAt: string;
  endsAt?: string;
  description?: string;
  location?: string;
  addMeet?: boolean;
  recurrence?: "daily" | "weekly" | "monthly";
}): Promise<BookEventResult> {
  const cal = calendarClient();
  if (!cal) return { ok: false, error: "workspace_not_connected" };
  const title = (opts.title ?? "").trim().slice(0, 300);
  if (!title) return { ok: false, error: "title_required" };
  if (!opts.startsAt || Number.isNaN(Date.parse(opts.startsAt.replace(HAS_TZ, "")))) {
    if (Number.isNaN(Date.parse(opts.startsAt ?? ""))) return { ok: false, error: "bad_start" };
  }
  const start = calTime(opts.startsAt);
  // End: explicit, else +1h from start (computed on the absolute instant so a
  // bare local time still gets a sane end on the same local clock).
  let end: { dateTime: string; timeZone?: string };
  if (opts.endsAt && !Number.isNaN(Date.parse(opts.endsAt))) {
    end = calTime(opts.endsAt);
  } else {
    // +1h on a DEFINITIVELY-absolute instant (B15): the old code stripped the Z then
    // re-parsed as server-local, giving a wrong (or zero-length) end on a non-UTC host.
    const endInstant = new Date(localToInstant(opts.startsAt).getTime() + 60 * 60 * 1000);
    end = { dateTime: endInstant.toISOString() };
  }
  const requestBody: calendar_v3.Schema$Event = {
    summary: title,
    description: (opts.description ?? "").slice(0, 4000) || undefined,
    location: (opts.location ?? "").slice(0, 300) || undefined,
    start,
    end,
  };
  // Recurring series (e.g. weekly office-hours) — start/end define the first instance.
  if (opts.recurrence) {
    const freq = opts.recurrence === "daily" ? "DAILY" : opts.recurrence === "monthly" ? "MONTHLY" : "WEEKLY";
    requestBody.recurrence = [`RRULE:FREQ=${freq}`];
  }
  // Attach a Google Meet video link. requestId MUST be unique per attempt;
  // conferenceDataVersion:1 is required or Google ignores the request. Google
  // returns hangoutLink (sometimes provisioned async → may be empty on the
  // immediate response; the event still gets the link shortly after).
  if (opts.addMeet) {
    requestBody.conferenceData = {
      createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  try {
    const res = await cal.events.insert({
      calendarId: "primary",
      ...(opts.addMeet ? { conferenceDataVersion: 1 } : {}),
      requestBody,
    });
    const meetLink = res.data.hangoutLink
      || res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri
      || undefined;
    return { ok: true, id: res.data.id ?? "", htmlLink: res.data.htmlLink ?? undefined, meetLink };
  } catch (e) {
    console.error("[workspaceCalendar] book failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "book_failed" };
  }
}

export type CalEvent = {
  eventId: string;
  title: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location?: string;
  meetLink?: string;
  attendees: { email: string; responseStatus?: string }[];
};

/** READ the founder's own Google Calendar (primary). Defaults to now → +7 days.
 *  Pure read — used by listMyCalendar ("what's on my calendar") + the briefing.
 *  Returns {ok:false} when Workspace isn't connected so the bot can say so. */
export async function readWorkspaceCalendar(opts: { from?: string; to?: string; max?: number; query?: string } = {}): Promise<{ ok: true; events: CalEvent[] } | { ok: false; error: string }> {
  const cal = calendarClient();
  if (!cal) return { ok: false, error: "workspace_not_connected" };
  const nowMs = Date.now();
  // Interpret a bare-local from/to in BORIVON_TZ (B5 — was server-UTC). Default floor =
  // start of TODAY in Casablanca (B16 — was `now`, which hid earlier-today events).
  const timeMin = (opts.from && !Number.isNaN(Date.parse(opts.from))) ? localToInstant(opts.from).toISOString() : startOfTodayTz().toISOString();
  const timeMax = (opts.to && !Number.isNaN(Date.parse(opts.to))) ? localToInstant(opts.to).toISOString() : new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: Math.min(Math.max(opts.max ?? 25, 1), 50),
      q: (opts.query ?? "").trim() || undefined,
      timeZone: BORIVON_TZ,
    });
    const events: CalEvent[] = (res.data.items ?? []).map((e) => ({
      eventId: e.id ?? "",
      title: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      allDay: !e.start?.dateTime,
      location: e.location ?? undefined,
      meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? undefined,
      attendees: (e.attendees ?? []).map((a) => ({ email: a.email ?? "", responseStatus: a.responseStatus ?? undefined })).filter((a) => a.email),
    }));
    return { ok: true, events };
  } catch (e) {
    console.error("[workspaceCalendar] list failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "list_failed" };
  }
}

/** Patch an existing event on the founder's own Google Calendar (reschedule / rename
 *  / add a Meet link). Only the provided fields change. If start moves with no new
 *  end, the end shifts to keep a 1h duration. */
export async function updateWorkspaceEvent(opts: {
  eventId: string;
  startsAt?: string;
  endsAt?: string;
  title?: string;
  addMeet?: boolean;
}): Promise<BookEventResult> {
  const cal = calendarClient();
  if (!cal) return { ok: false, error: "workspace_not_connected" };
  const requestBody: calendar_v3.Schema$Event = {};
  if (opts.title && opts.title.trim()) requestBody.summary = opts.title.trim().slice(0, 300);
  if (opts.startsAt && !Number.isNaN(Date.parse(opts.startsAt.replace(HAS_TZ, "")))) requestBody.start = calTime(opts.startsAt);
  if (opts.endsAt && !Number.isNaN(Date.parse(opts.endsAt))) requestBody.end = calTime(opts.endsAt);
  // Preserve the event's ORIGINAL duration when only the start moves (B6) — don't
  // silently shrink a 2h meeting to 1h. GET the current event to read its span.
  if (requestBody.start && !requestBody.end && opts.startsAt) {
    let durMs = 60 * 60 * 1000; // fallback: 1h
    try {
      const cur = await cal.events.get({ calendarId: "primary", eventId: opts.eventId });
      const os = cur.data.start?.dateTime ?? cur.data.start?.date;
      const oe = cur.data.end?.dateTime ?? cur.data.end?.date;
      if (os && oe) { const d = Date.parse(oe) - Date.parse(os); if (Number.isFinite(d) && d > 0) durMs = d; }
    } catch { /* keep the 1h fallback */ }
    const endInstant = new Date(localToInstant(opts.startsAt).getTime() + durMs);
    requestBody.end = { dateTime: endInstant.toISOString() };
  }
  if (opts.addMeet) {
    requestBody.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
  }
  try {
    const res = await cal.events.patch({
      calendarId: "primary",
      eventId: opts.eventId,
      ...(opts.addMeet ? { conferenceDataVersion: 1 } : {}),
      requestBody,
    });
    const meetLink = res.data.hangoutLink || res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || undefined;
    return { ok: true, id: res.data.id ?? opts.eventId, htmlLink: res.data.htmlLink ?? undefined, meetLink };
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 404 || code === 410) return { ok: false, error: "event_not_found" };
    console.error("[workspaceCalendar] update failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "update_failed" };
  }
}

/** Delete an event from the founder's own Google Calendar by its Google event id. */
export async function cancelWorkspaceEvent(eventId: string): Promise<{ ok: boolean; error?: string }> {
  const cal = calendarClient();
  if (!cal) return { ok: false, error: "workspace_not_connected" };
  try {
    await cal.events.delete({ calendarId: "primary", eventId });
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 404 || code === 410) return { ok: true }; // already gone
    console.error("[workspaceCalendar] cancel failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "cancel_failed" };
  }
}
