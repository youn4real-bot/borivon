import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * Public registration endpoint for the /online-courses page.
 * Stores a structured lead in `online_course_registrations` (run the migration
 * supabase/online_course_registrations.sql first). Surfaced to admins at
 * /portal/admin/online-courses.
 *
 * Spam mitigation: IP rate-limit (in-process) + body-size cap + 1h dedupe.
 */
const MAX = (s: unknown, n: number) => (typeof s === "string" ? s : "").trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const rl = enforceRateLimit(req, "oc-register", { limit: 5, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 8 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let body: {
    firstName?: string; lastName?: string; email?: string;
    phone?: string; address?: string; group?: string; level?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const email = MAX(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const row = {
    first_name: MAX(body.firstName, 80),
    last_name:  MAX(body.lastName, 80),
    email,
    phone:      MAX(body.phone, 40),
    address:    MAX(body.address, 300),
    group_slot: MAX(body.group, 60),
    level:      MAX(body.level, 16),
  };

  const db = getServiceSupabase();

  // De-dupe accidental double-submits: same email within the last hour.
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { data: dup } = await db
    .from("online_course_registrations")
    .select("id").eq("email", email).gte("created_at", oneHourAgo).maybeSingle();
  if (dup) return NextResponse.json({ ok: true, duplicate: true });

  const { error } = await db.from("online_course_registrations").insert(row);
  if (error) {
    console.error("[/api/online-courses/register] insert error:", error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
