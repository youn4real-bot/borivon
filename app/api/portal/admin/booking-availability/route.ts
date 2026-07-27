import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { parseWeek } from "@/lib/bookingConfig";

/**
 * The founder's own booking availability — working hours, appointment length,
 * buffer, notice, horizon, days off, and an on/off switch for the whole page.
 *
 * SUPREME ADMIN ONLY. This is his diary; a sub-admin has no business setting
 * when he is available, and an org admin has no business seeing it at all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULTS = {
  week: {
    1: ["09:00-13:00", "14:00-18:00"], 2: ["09:00-13:00", "14:00-18:00"],
    3: ["09:00-13:00", "14:00-18:00"], 4: ["09:00-13:00", "14:00-18:00"],
    5: ["09:00-13:00", "14:00-18:00"],
  } as Record<number, string[]>,
  slot_minutes: 30, buffer_minutes: 0, min_notice_hours: 12,
  horizon_days: 14, blackout_dates: [] as string[], accepting: true,
};

const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  const { data, error } = await getServiceSupabase()
    .from("booking_availability")
    .select("week,slot_minutes,buffer_minutes,min_notice_hours,horizon_days,blackout_dates,accepting,updated_at")
    .eq("id", true)
    .maybeSingle();

  // Not migrated yet → hand back the defaults so the editor still renders and
  // the founder sees exactly what the page is currently doing.
  if (error || !data) return NextResponse.json({ availability: DEFAULTS, migrated: false });
  return NextResponse.json({ availability: data, migrated: true });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  // Validate BEFORE writing: a malformed week would empty the booking page, and
  // the visitor would just see "no times available" with no idea why.
  const week = parseWeek(body?.week);
  if (!week) return NextResponse.json({ error: "bad_week" }, { status: 400 });

  const blackout = (Array.isArray(body?.blackout_dates) ? body.blackout_dates : [])
    .filter((d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()))
    .map((d: string) => d.trim())
    .slice(0, 365);

  const patch = {
    week,
    slot_minutes: int(body?.slot_minutes, 5, 240, DEFAULTS.slot_minutes),
    buffer_minutes: int(body?.buffer_minutes, 0, 120, DEFAULTS.buffer_minutes),
    min_notice_hours: int(body?.min_notice_hours, 0, 720, DEFAULTS.min_notice_hours),
    horizon_days: int(body?.horizon_days, 1, 90, DEFAULTS.horizon_days),
    blackout_dates: blackout,
    accepting: body?.accepting !== false,
    updated_at: new Date().toISOString(),
    updated_by: auth.userId,
  };

  const { error } = await getServiceSupabase()
    .from("booking_availability")
    .upsert({ id: true, ...patch }, { onConflict: "id" });

  if (error) {
    const notMigrated = /booking_availability|does not exist|schema cache/i.test(error.message ?? "");
    if (notMigrated) {
      return NextResponse.json({ error: "not_migrated", message: "Run supabase/booking_maxx.sql first." }, { status: 409 });
    }
    console.error("[booking-availability] save failed:", error.message);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, availability: patch });
}
