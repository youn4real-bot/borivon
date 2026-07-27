import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { sendBookingReminderEmail } from "@/lib/email";

/**
 * Day-before reminder to the PERSON WHO BOOKED.
 *
 * The founder already gets his own chase (assistant_reminders); this is the
 * other half — the nudge that stops a no-show, carrying the reschedule link so
 * someone whose plans changed moves the call instead of ghosting it.
 *
 * Idempotent by construction: `reminded_at` is stamped before the send, and the
 * query only picks rows where it is NULL. Re-running the cron, or two isolates
 * racing, cannot double-email anybody.
 *
 * Rides the existing daily crons — no new schedule needed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Send to anyone whose call starts within this window. Wider than 24h so a
 *  once-daily cron can't skip a booking that falls between two runs. */
const WINDOW_MS = 36 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const db = getServiceSupabase();
  const now = Date.now();

  // Same tiering as the manage lookup: asking for `lang` before
  // booking_lang.sql is run must not silence the whole sweep — that would stop
  // every reminder going out over a missing translation hint.
  const BASE = "id,name,email,starts_at,meet_link,manage_token,status,reminded_at";
  const due = (cols: string) => db
    .from("bookings")
    .select(cols)
    .eq("status", "booked")
    .is("reminded_at", null)
    .gte("starts_at", new Date(now).toISOString())
    .lte("starts_at", new Date(now + WINDOW_MS).toISOString())
    .order("starts_at")
    .limit(50);

  let { data, error } = await due(`${BASE},lang`);
  if (error && /lang|column .* does not exist|schema cache/i.test(error.message ?? "")) {
    ({ data, error } = await due(BASE));
  }

  // The columns only exist after supabase/booking_maxx.sql — until then this is
  // a clean no-op rather than a red cron.
  if (error) {
    const notMigrated = /reminded_at|manage_token|lang|column .* does not exist|schema cache/i.test(error.message ?? "");
    if (notMigrated) return Response.json({ skipped: "not_migrated" });
    console.error("[cron/booking-reminders] query failed:", error.message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }

  type Row = {
    id: number; name: string; email: string | null; starts_at: string;
    meet_link: string | null; manage_token: string | null;
    lang: "fr" | "en" | "de" | null;
  };
  const rows = ((data ?? []) as unknown) as Row[];
  let sent = 0, skipped = 0;

  for (const b of rows) {
    // A booking with no email (a phone-only lead the admin recorded by hand)
    // has nobody to remind — mark it so it stops being re-queried every run.
    if (!b.email || !b.manage_token) {
      await db.from("bookings").update({ reminded_at: new Date().toISOString() }).eq("id", b.id);
      skipped++;
      continue;
    }
    // Stamp FIRST. If the send then fails we lose one reminder; if we stamped
    // after, a crash mid-loop would re-send to everyone already emailed.
    const claim = await db.from("bookings")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", b.id)
      .is("reminded_at", null)      // whoever wins the race is the only sender
      .select("id");
    if (claim.error || !claim.data?.length) { skipped++; continue; }

    try {
      await sendBookingReminderEmail({
        to: b.email, name: b.name, startsAt: b.starts_at,
        meetLink: b.meet_link, manageToken: b.manage_token,
        lang: b.lang ?? undefined,
      });
      sent++;
    } catch (e) {
      console.error("[cron/booking-reminders] send failed for", b.id, e instanceof Error ? e.message : e);
    }
  }

  return Response.json({ ok: true, considered: rows.length, sent, skipped });
}
