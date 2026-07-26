import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { bookWorkspaceEvent, cancelWorkspaceEvent } from "@/lib/workspaceCalendar";
import { keepAlive } from "@/lib/keepAlive";
import { getAdminUserId } from "@/lib/telegram";
import { DEFAULT_AVAILABILITY, looksLikeEmail, followUpsFor, type BookingKind } from "@/lib/booking";

/**
 * ADMIN side of the booking system.
 *
 *   GET    → every booking, newest first
 *   POST   → schedule someone BY HAND. Most people never touch the booking
 *            page — they agree a time on WhatsApp or during a call. Those
 *            still have to land here, because the follow-up chain is the
 *            entire point and it can't start from a conversation nobody
 *            wrote down. Manual bookings get the SAME follow-ups.
 *   PATCH  → record what happened (held / no-show / cancelled + outcome).
 *
 * Access: supreme admin + sub-admins. These are Borivon's OWN inbound calls,
 * not candidate records, so there is no per-candidate scope to apply — but
 * org-admins are excluded, since another agency's staff has no business
 * reading Borivon's sales pipeline.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: BookingKind[] = ["nurse", "clinic", "company"];
const STATUSES = ["booked", "held", "no_show", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

/** Supreme admin or a plain sub-admin — never an org-scoped agency admin. */
async function gate(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (auth.role === "sub_admin" && auth.isAgencyAdmin) {
    return { ok: false as const, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, auth };
}

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.res;

  const { data, error } = await getServiceSupabase()
    .from("bookings")
    .select("id,kind,name,email,phone,company,note,selections,starts_at,ends_at,meet_link,status,outcome,source,created_at")
    .order("starts_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[admin/bookings] list failed:", error.message);
    return NextResponse.json({ error: "load_failed", bookings: [] }, { status: 500 });
  }
  return NextResponse.json({ bookings: data ?? [] });
}

export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind;
  const at = Number(body?.at);
  const name = String(body?.name ?? "").trim().slice(0, 120);
  const email = String(body?.email ?? "").trim().slice(0, 254).toLowerCase();
  const phone = String(body?.phone ?? "").trim().slice(0, 40) || null;
  const company = String(body?.company ?? "").trim().slice(0, 160) || null;
  const note = String(body?.note ?? "").trim().slice(0, 1000) || null;
  const minutes = Math.min(240, Math.max(10, Number(body?.minutes) || DEFAULT_AVAILABILITY.slotMinutes));
  const invite = body?.invite !== false; // default: send them a real invite

  if (!(KINDS as string[]).includes(kind)) return NextResponse.json({ error: "bad_kind" }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "bad_name" }, { status: 400 });
  if (!Number.isFinite(at)) return NextResponse.json({ error: "bad_slot" }, { status: 400 });
  // Email is optional here on purpose: plenty of WhatsApp leads only ever give
  // a phone number, and refusing to record them would defeat the point. But if
  // one IS given it must be valid, because we may email an invite to it.
  if (email && !looksLikeEmail(email)) return NextResponse.json({ error: "bad_email" }, { status: 400 });

  const endsAt = at + minutes * 60_000;
  const db = getServiceSupabase();

  // Deliberately NOT restricted to the public availability windows — the whole
  // point of manual scheduling is that the founder can put a call anywhere,
  // including a Saturday evening. The unique index still prevents a clash.
  const ins = await db.from("bookings").insert({
    kind, name, email: email || null, phone, company, note,
    starts_at: new Date(at).toISOString(),
    ends_at: new Date(endsAt).toISOString(),
    source: "admin",
    created_by: g.auth.userId ?? null,
  }).select("id").single();

  if (ins.error) {
    if ((ins.error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "slot_taken", message: "There's already a booking at that time." }, { status: 409 });
    }
    console.error("[admin/bookings] insert failed:", ins.error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  const bookingId = ins.data?.id as number;

  keepAlive(async () => {
    try {
      const ev = await bookWorkspaceEvent({
        title: `Borivon — ${company || name} (${kind})`,
        startsAt: new Date(at).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        description: [phone ? `Phone: ${phone}` : null, note].filter(Boolean).join("\n") || undefined,
        addMeet: true,
        attendees: invite && email ? [email] : [],
        sendUpdates: invite && email ? "all" : "none",
      });
      if (ev.ok) {
        await db.from("bookings")
          .update({ calendar_event_id: ev.id ?? null, meet_link: ev.meetLink ?? null })
          .eq("id", bookingId);
      }
    } catch (e) {
      console.error("[admin/bookings] calendar failed:", e instanceof Error ? e.message : e);
    }

    // The same chase a self-booked call gets — that is the reason this exists.
    try {
      const owner = await getAdminUserId();
      if (owner) {
        await db.from("assistant_reminders").insert(
          followUpsFor({ startsAt: at, name: company || name, kind: kind as BookingKind }).map((f) => ({
            owner_user_id: owner,
            text: f.text,
            due_at: new Date(f.dueAt).toISOString(),
            due_date: new Date(f.dueAt).toISOString().slice(0, 10),
          })),
        );
      }
    } catch (e) {
      console.error("[admin/bookings] follow-ups failed:", e instanceof Error ? e.message : e);
    }
  });

  return NextResponse.json({ ok: true, id: bookingId });
}

export async function PATCH(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body?.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(String(body.status))) {
      return NextResponse.json({ error: "bad_status" }, { status: 400 });
    }
    patch.status = String(body.status) as Status;
  }
  if (body?.outcome !== undefined) patch.outcome = String(body.outcome ?? "").trim().slice(0, 2000) || null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });

  const db = getServiceSupabase();
  const { data, error } = await db.from("bookings")
    .update(patch).eq("id", id)
    .select("calendar_event_id,status").single();

  if (error) {
    console.error("[admin/bookings] update failed:", error.message);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  // Cancelling here must also clear the founder's actual calendar, or the slot
  // stays visibly blocked to him while the booking page happily re-offers it.
  if (patch.status === "cancelled" && data?.calendar_event_id) {
    const eventId = data.calendar_event_id as string;
    keepAlive(async () => {
      try { await cancelWorkspaceEvent(eventId); }
      catch (e) { console.error("[admin/bookings] cancel event failed:", e instanceof Error ? e.message : e); }
    });
  }

  return NextResponse.json({ ok: true });
}
