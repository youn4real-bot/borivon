import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { verifyFeedToken } from "@/lib/calendarFeed";

/**
 * Per-user calendar subscription feed (the "Sync" button).
 *
 * Public URL, authenticated by the signed token in the path (calendar apps GET
 * the URL with no auth header). Returns the events the user is allowed to see —
 * public events + events they're tagged in — as a standards .ics that Google /
 * Apple / Outlook poll on their own schedule. Edits & cancellations propagate
 * because each VEVENT keeps a stable UID.
 */

export const dynamic = "force-dynamic";

type Row = {
  id: string; title: string; description: string;
  starts_at: string; ends_at: string | null;
  link_url: string; location: string;
  attendee_ids: string[] | null; vip_only: boolean;
};

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function esc(s: string): string {
  return (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
/** RFC 5545: fold long content lines (continuation lines start with a space). */
function fold(line: string): string {
  const out: string[] = [];
  let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); }
  out.push(s);
  return out.join("\r\n");
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const userId = verifyFeedToken(token);
  if (!userId) return new NextResponse("Invalid or expired calendar link.", { status: 401 });

  const db = getServiceSupabase();

  // The supreme admin sees EVERY event in their feed (mirrors the page's
  // canManage). We only have the userId here, so resolve their email to check.
  let canManage = false;
  try {
    const { data: u } = await db.auth.admin.getUserById(userId);
    const email = (u?.user?.email ?? "").trim().toLowerCase();
    canManage = !!email && email === (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  } catch { /* lookup failed → treat as a normal subscriber */ }

  // Premium gate mirrors the page: a non-premium subscriber still SEES a legacy
  // VIP event's title/time but not its join link / description. Admin = premium.
  const { data: prof } = await db
    .from("candidate_profiles")
    .select("payment_tier, manually_verified")
    .eq("user_id", userId)
    .maybeSingle();
  const p = prof as { payment_tier?: string | null; manually_verified?: boolean } | null;
  const premium = canManage || (!!p && (p.payment_tier === "premium" || !!p.manually_verified));

  const { data } = await db
    .from("calendar_events")
    .select("id, title, description, starts_at, ends_at, link_url, location, attendee_ids, vip_only")
    .order("starts_at", { ascending: true })
    .limit(1000);

  const rows = ((data ?? []) as Row[]).filter((e) => {
    if (canManage) return true;                 // supreme admin sees everything
    const att = e.attendee_ids ?? [];
    return att.length === 0 || att.includes(userId);
  });

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Borivon//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Borivon",
    "X-WR-TIMEZONE:Africa/Casablanca",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const e of rows) {
    const start = new Date(e.starts_at);
    const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(start.getTime())) continue;
    const locked = e.vip_only && !premium;
    const bodyParts: string[] = [];
    if (!locked && e.description) bodyParts.push(e.description);
    if (!locked && e.link_url) bodyParts.push(`Link: ${e.link_url}`);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@borivon.com`,
      `DTSTAMP:${icsStamp(start)}`,
      `DTSTART:${icsStamp(start)}`,
      `DTEND:${icsStamp(end)}`,
      fold(`SUMMARY:${esc(e.title)}`),
      fold(`DESCRIPTION:${esc(bodyParts.join("\n\n"))}`),
      fold(`LOCATION:${esc(locked ? "" : (e.location || e.link_url || ""))}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="borivon.ics"',
      "Cache-Control": "public, max-age=300",
    },
  });
}
