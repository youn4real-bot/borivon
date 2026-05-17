import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";

/**
 * Public lead-capture endpoint.
 *
 * The homepage Funnel (components/Funnel.tsx) calls this with the visitor's
 * answers when they submit. We persist the lead to the `admin_notifications`
 * table so it appears in the admin inbox alongside signups and uploads.
 *
 * Spam mitigation:
 *   - Cloudflare Turnstile in front of the form (browser-side challenge)
 *   - Server-side IP rate-limit (in-process, defense-in-depth)
 */
type LeadKind = "person" | "org";

type Body = {
  kind: LeadKind;
  email: string;
  // Person fields
  level?: string | null;
  phone?: string | null;
  message?: string | null;
  // Org fields
  company?: string | null;
  service?: string | null;
  format?: string | null;
};

const MAX = (s: unknown, n: number) =>
  (typeof s === "string" ? s : "").trim().slice(0, n);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  // Tight rate-limit on the public lead endpoint — bots love forms. A real
  // user fills the funnel once, maybe twice; 5/min is generous.
  const rl = enforceRateLimit(req, "leads", { limit: 5, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  // Hard cap the request body so a bot can't POST megabytes of JSON in a
  // loop. A real lead is well under 1 KB; 8 KB leaves comfortable
  // headroom for accents, custom messages, and content-type framing.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 8 * 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const kind  = body.kind === "org" ? "org" : "person";
  const email = MAX(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // Build a human-readable summary that fits in the existing user_name field
  // (admin notifications are simple key/value rows — we just stuff the lead
  // shape into the same columns that signups already use).
  const summary = kind === "person"
    ? [
        "Personne",
        MAX(body.level, 32),
        MAX(body.phone, 32),
        MAX(body.message, 500),
      ].filter(Boolean).join(" · ")
    : [
        "Organisation",
        MAX(body.company, 200),
        MAX(body.service, 32),
        MAX(body.format, 32),
      ].filter(Boolean).join(" · ");

  const db = getServiceSupabase();

  // Block obvious duplicates — same email + same kind + within last hour.
  // Avoids accidental double-submits without throwing away legitimate
  // re-engagement leads days later.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: existing } = await db
    .from("admin_notifications")
    .select("id")
    .eq("type", `lead-${kind}`)
    .eq("user_email", email)
    .gte("created_at", oneHourAgo)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const { error } = await db.from("admin_notifications").insert({
    type:       `lead-${kind}`,
    user_name:  summary || email,
    user_email: email,
  });
  if (error) {
    console.error("[/api/leads] insert error:", error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
