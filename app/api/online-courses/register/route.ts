import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { cleanPublicText as clean } from "@/lib/sanitizeInput";

/**
 * Public registration endpoint for the /online-courses page.
 * Stores a structured lead in `online_course_registrations` (run the migration
 * supabase/online_course_registrations.sql first). Surfaced to admins at
 * /portal/admin/online-courses.
 *
 * Spam + injection mitigation: IP rate-limit (in-process) + body-size cap +
 * 1h dedupe + per-field input sanitization (lib/sanitizeInput.cleanPublicText).
 */
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

  // Email: validate the RAW value (clean() would strip + / - that are legal in
  // local-parts). EMAIL_RE already forbids spaces, <, >, quotes, control chars.
  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  // Phone: keep only digits, +, spaces, () and - (no script payload can survive).
  const phone = (typeof body.phone === "string" ? body.phone : "").replace(/[^\d+()\s-]/g, "").trim().slice(0, 40);

  const row = {
    first_name: clean(body.firstName, 80),
    last_name:  clean(body.lastName, 80),
    email,
    phone,
    address:    clean(body.address, 300),
    group_slot: clean(body.group, 60),
    level:      clean(body.level, 16),
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
