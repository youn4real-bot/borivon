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
    const startMs = Date.parse(start.dateTime.replace(HAS_TZ, "") + (HAS_TZ.test(start.dateTime) ? "" : "Z"));
    const endIso = new Date(startMs + 60 * 60 * 1000).toISOString().slice(0, 19);
    end = start.timeZone ? { dateTime: endIso, timeZone: start.timeZone } : { dateTime: endIso + "Z" };
  }
  const requestBody: calendar_v3.Schema$Event = {
    summary: title,
    description: (opts.description ?? "").slice(0, 4000) || undefined,
    location: (opts.location ?? "").slice(0, 300) || undefined,
    start,
    end,
  };
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
