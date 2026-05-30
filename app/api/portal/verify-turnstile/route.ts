import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  // Public endpoint that proxies to Cloudflare on every call — throttle per IP.
  const rl = enforceRateLimit(req, "turnstile", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ success: false, error: "No token" }, { status: 400 });

  const secret = process.env.TURNSTILE_SECRET_KEY ?? "";
  if (!secret) {
    // Always fail closed when the server isn't configured. Mis-configuring prod
    // (e.g. NODE_ENV != "production" on a serverless deploy) must NOT silently
    // disable CAPTCHA. Operators should set TURNSTILE_SECRET_KEY explicitly.
    console.error("[Turnstile] TURNSTILE_SECRET_KEY is not set — failing closed");
    return NextResponse.json({ success: false, error: "Server misconfigured" }, { status: 500 });
  }

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });

  const data = await res.json();
  if (!data.success) {
    console.warn("[Turnstile] verification failed:", data["error-codes"]);
    return NextResponse.json({ success: false, error: "Challenge failed" }, { status: 403 });
  }

  return NextResponse.json({ success: true });
}
