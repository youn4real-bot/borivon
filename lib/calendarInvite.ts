/**
 * Build a real CALENDAR INVITATION (.ics) — an RFC-5545 VEVENT with METHOD:REQUEST,
 * an ORGANIZER and ATTENDEEs with RSVP, so recipients get Yes/Maybe/No and it lands
 * in their calendar. Generated with `ical-generator` (battle-tested OSS) so escaping,
 * line-folding, organizer/attendee and timezones are correct. Sent as an email via
 * nodemailer's icalEvent (see lib/outboundEmail.ts) over the founder's Gmail App
 * Password — NO Google OAuth needed.
 */
import ical, { ICalCalendarMethod } from "ical-generator";

export type InviteAttendee = { email: string; name?: string };
export type InviteOpts = {
  organizerName: string;
  organizerEmail: string;
  attendees: InviteAttendee[];
  title: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  uid?: string;                       // stable id — pass the same one to UPDATE or CANCEL later
  sequence?: number;                  // bump on each update/cancel
  method?: "REQUEST" | "CANCEL";      // REQUEST = invite/update, CANCEL = call it off
};

/** Returns the .ics string + the method (for the email's icalEvent). */
export function buildInviteIcs(o: InviteOpts): { ics: string; method: "REQUEST" | "CANCEL" } {
  const method = o.method === "CANCEL" ? ICalCalendarMethod.CANCEL : ICalCalendarMethod.REQUEST;
  const cal = ical({ method, prodId: { company: "Borivon", product: "assistant", language: "EN" } });
  cal.createEvent({
    ...(o.uid ? { id: o.uid } : {}),
    sequence: o.sequence ?? 0,
    start: o.start,
    end: o.end,
    summary: o.title,
    description: o.description || undefined,
    location: o.location || undefined,
    organizer: { name: o.organizerName, email: o.organizerEmail },
    attendees: o.attendees.map((a) => ({ email: a.email, name: a.name, rsvp: true })),
  });
  return { ics: cal.toString(), method: o.method === "CANCEL" ? "CANCEL" : "REQUEST" };
}
