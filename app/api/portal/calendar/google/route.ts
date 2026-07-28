import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { updateWorkspaceEvent, cancelWorkspaceEvent } from "@/lib/workspaceCalendar";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * Manage the founder's OWN Google Workspace events from the portal.
 *
 * The merged Kalender shows his real diary, but until now those rows were
 * read-only: he could see a clash and still had to open Google in another tab
 * to move it. One calendar means being able to act on everything in it.
 *
 *   PATCH  — move an event (new start, optional new end)
 *   DELETE — cancel it (Google emails any attendees)
 *
 * SUPREME ADMIN ONLY, deliberately. Bookings are Borivon's shared work and a
 * sub-admin can manage those; this is the founder's personal diary, including
 * entries other staff only ever see as "Busy" with no title. Letting someone
 * move an appointment they cannot even read would be indefensible.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Google event ids are opaque; keep it to a sane charset before calling out. */
const EVENT_ID_RE = /^[A-Za-z0-9_@-]{5,1024}$/;

/**
 * Is this Google event the twin of one of our bookings?
 *
 * Every booking creates a Google event, and the merged calendar hides that twin
 * so a call never appears twice. Moving the Google side directly would break
 * exactly that: the booking row keeps the OLD time, the Google row moves to the
 * new one, the de-dup stops matching, and the same call shows up twice at two
 * different times — with the booker's confirmation, reminder and follow-ups all
 * still pinned to the old slot. (Reproduced in testing before adding this.)
 *
 * So refuse, and point at the reschedule that does the whole job properly.
 * Fails OPEN on a lookup error: a DB blip must not stop the founder editing his
 * own diary, and the worst case is the edge case above rather than a lockout.
 */
async function bookingFor(eventId: string): Promise<number | null> {
  try {
    const { data } = await getServiceSupabase()
      .from("bookings").select("id").eq("calendar_event_id", eventId).maybeSingle();
    return (data as { id?: number } | null)?.id ?? null;
  } catch { return null; }
}

/**
 * The few outcomes the browser is allowed to be told apart.
 *
 * `updateWorkspaceEvent` returns the raw thrown message on an unrecognised
 * failure, and on the Workers path that message is the full shim error — the
 * internal Google URL plus a slice of Google's response body. That went
 * straight into the JSON the browser received. Nothing catastrophic, but it is
 * our infrastructure leaking into a client for no benefit: the UI can only act
 * on the category, and the detail is already in the server log above.
 */
const KNOWN_ERRORS = new Set(["event_not_found", "workspace_not_connected", "end_before_start"]);
const publicError = (e?: string) => (e && KNOWN_ERRORS.has(e) ? e : "google_error");
const statusFor = (e?: string) =>
  e === "event_not_found" ? 404 : e === "end_before_start" ? 400 : 502;

async function supremeOnly(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (auth.role !== "admin") {
    return { ok: false as const, res: NextResponse.json({ error: "Supreme admin only" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function PATCH(req: NextRequest) {
  const gate = await supremeOnly(req);
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => ({}));
  const eventId = String(body?.eventId ?? "").trim();
  const startsAt = Number(body?.startsAt);
  const endsAt = Number(body?.endsAt);

  if (!EVENT_ID_RE.test(eventId)) return NextResponse.json({ error: "bad_event" }, { status: 400 });
  if (!Number.isFinite(startsAt)) return NextResponse.json({ error: "bad_start" }, { status: 400 });
  if (Number.isFinite(endsAt) && endsAt <= startsAt) {
    return NextResponse.json({ error: "end_before_start" }, { status: 400 });
  }

  const owned = await bookingFor(eventId);
  if (owned) {
    return NextResponse.json({
      error: "belongs_to_booking", bookingId: owned,
      message: "This is a booked call. Reschedule it from Bookings so the person is told and their reminders move too.",
    }, { status: 409 });
  }

  const res = await updateWorkspaceEvent({
    eventId,
    startsAt: new Date(startsAt).toISOString(),
    // Omitting the end makes updateWorkspaceEvent PRESERVE the original
    // duration — moving a 2h meeting must not silently shrink it to 1h.
    ...(Number.isFinite(endsAt) ? { endsAt: new Date(endsAt).toISOString() } : {}),
  });

  if (!res.ok) {
    console.error("[calendar/google] move failed:", res.error);
    return NextResponse.json({ error: publicError(res.error) }, { status: statusFor(res.error) });
  }
  return NextResponse.json({ ok: true, id: res.id });
}

export async function DELETE(req: NextRequest) {
  const gate = await supremeOnly(req);
  if (!gate.ok) return gate.res;

  const eventId = (req.nextUrl.searchParams.get("eventId") ?? "").trim();
  if (!EVENT_ID_RE.test(eventId)) return NextResponse.json({ error: "bad_event" }, { status: 400 });

  const owned = await bookingFor(eventId);
  if (owned) {
    return NextResponse.json({
      error: "belongs_to_booking", bookingId: owned,
      message: "This is a booked call. Cancel it from Bookings so the person is told and their follow-ups are dropped.",
    }, { status: 409 });
  }

  // Deliberately NOT wholeSeries: cancelling one occurrence must never wipe a
  // recurring standup because someone clicked a single day in the grid.
  const res = await cancelWorkspaceEvent(eventId);
  if (!res.ok) {
    console.error("[calendar/google] cancel failed:", res.error);
    return NextResponse.json({ error: publicError(res.error) }, { status: statusFor(res.error) });
  }
  return NextResponse.json({ ok: true });
}
