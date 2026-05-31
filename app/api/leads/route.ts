import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * Public lead-capture endpoint for the homepage funnel (components/Funnel.tsx).
 *
 * The funnel submits several shapes — person / org / work / general /
 * fachkraefte — each with different fields. We store the common fields as
 * columns and every kind-specific extra in a `details` JSONB so NOTHING is
 * lost, then surface it all to admins at /portal/admin/leads.
 *
 * (Previously this wrote into admin_notifications, whose `type` CHECK only
 * allows signup/upload/doc-* → every lead 500'd and was lost. Fixed by the
 * dedicated `leads` table — run supabase/leads.sql first.)
 *
 * Spam mitigation: Cloudflare Turnstile in front of the form + server-side IP
 * rate-limit + body-size cap + 1h dedupe.
 */
const MAX = (s: unknown, n: number) => (typeof s === "string" ? s : "").trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Kind-specific extra fields the funnel may send — captured into `details`.
const DETAIL_FIELDS = ["level", "company", "service", "format", "field", "sector", "positions", "city"] as const;

export async function POST(req: NextRequest) {
  // Tight rate-limit on the public lead endpoint — bots love forms. A real
  // user fills the funnel once, maybe twice; 5/min is generous.
  const rl = enforceRateLimit(req, "leads", { limit: 5, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  // Hard cap the body so a bot can't POST megabytes in a loop. A real lead is
  // well under 1 KB; 8 KB leaves headroom for accents + custom messages.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 8 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const email = MAX(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const kind = MAX(body.kind, 24) || "person";

  // Collect kind-specific extras (only non-empty known fields) into details.
  const details: Record<string, string> = {};
  for (const f of DETAIL_FIELDS) {
    const v = MAX(body[f], 500);
    if (v) details[f] = v;
  }

  const row = {
    kind,
    email,
    name:    MAX(body.name, 120),
    phone:   MAX(body.phone, 40),
    message: MAX(body.message, 1000),
    details,
  };

  const db = getServiceSupabase();

  // De-dupe accidental double-submits: same email + kind within the last hour.
  // Legitimate re-engagement days later still gets through.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: dup } = await db
    .from("leads")
    .select("id").eq("email", email).eq("kind", kind).gte("created_at", oneHourAgo).maybeSingle();
  if (dup) return NextResponse.json({ ok: true, duplicate: true });

  const { error } = await db.from("leads").insert(row);
  if (error) {
    console.error("[/api/leads] insert error:", error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
