import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  // Public endpoint that proxies to Cloudflare on every call — throttle per IP.
  const rl = await enforceRateLimitDistributed(req, "turnstile", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ success: false, error: "No token" }, { status: 400 });

  const secret = process.env.TURNSTILE_SECRET_KEY ?? "";
  if (!secret) {
    // CAPTCHA is intentionally OFF when no secret is configured (founder choice:
    // keep signup friction-free and require no extra key to run on Cloudflare).
    // Skip verification and allow the request. Re-enable bot protection anytime
    // by setting TURNSTILE_SECRET_KEY — verification switches back on automatically.
    console.warn("[Turnstile] TURNSTILE_SECRET_KEY not set — CAPTCHA disabled, allowing request");
    return NextResponse.json({ success: true, skipped: true });
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
