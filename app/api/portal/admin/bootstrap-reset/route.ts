import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * One-time bootstrap to reset (or create) the supreme admin's password.
 *
 * Use case: the supreme admin is locked out and Supabase's email-based reset
 * isn't reaching them (no SMTP configured / inbox issues). This endpoint lets
 * them set a known password using the Supabase service-role key on the
 * server.
 *
 * Security gates (all required, all checked server-side):
 *
 *   1. process.env.ADMIN_EMAIL must be set, and the body's `email` must
 *      match it. Only the supreme admin's account can be reset here.
 *   2. process.env.BOOTSTRAP_RESET_SECRET must be set. The body's
 *      `secret` must equal it. After successful use, the admin should
 *      then run `npx wrangler secret delete BOOTSTRAP_RESET_SECRET` so it goes inert.
 *      It is armed ONLY by a live Worker secret — never by .env.local, which
 *      OpenNext bakes into the bundle (that made it permanently armed once).
 *   3. New password must be at least 8 characters.
 *
 * Body: { email: string, newPassword: string, secret: string }
 *
 * Once the admin is back in, deleting the env var is enough — every
 * subsequent request will 403.
 */
/**
 * Constant-time string compare. A `!==` on a secret leaks its prefix through
 * timing; this endpoint is unauthenticated, so that matters here.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  /*
   * THE SECRET MUST COME FROM A LIVE WORKER SECRET, NEVER FROM process.env.
   *
   * This endpoint is designed to be disarmed by deleting its env var. On Vercel
   * that worked, because the value only ever lived in the Vercel dashboard.
   *
   * On Cloudflare it did NOT. `opennextjs-cloudflare build` runs on a dev machine,
   * Next loads .env.local, and OpenNext writes those values verbatim into
   * .open-next/cloudflare/next-env.mjs, which is bundled into the uploaded Worker.
   * Its init then does `process.env[key] ??= bakedValue`, so the baked value fills
   * in whenever the key is not a live secret. Result: process.env.BOOTSTRAP_RESET_SECRET
   * was ALWAYS set in production, the "disabled" guard below could never fire, and
   * `wrangler secret delete` was a no-op — the next isolate simply re-armed it.
   *
   * Verified against production before this change: POST with a wrong secret
   * answered "Invalid secret", not "disabled". It was live.
   *
   * getCloudflareContext().env is the REAL binding table. A baked next-env value
   * never appears there, so reading it here means this route can only ever be armed
   * by someone deliberately running `wrangler secret put` — which is what the
   * comment above always claimed.
   */
  let expectedSecret = "";
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    expectedSecret = String(env?.BOOTSTRAP_RESET_SECRET ?? "").trim();
  } catch {
    // No Workers context (next dev, the build's prerender pass) → stay disabled.
    expectedSecret = "";
  }
  // Length floor: the old value was the brand name plus the year. A recovery
  // key that guards the supreme-admin account must not be guessable, and this
  // endpoint has no login and no rate limit in front of it.
  if (expectedSecret.length < 32) {
    return NextResponse.json(
      { error: "Bootstrap reset is disabled." },
      { status: 403 },
    );
  }

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) {
    return NextResponse.json({ error: "ADMIN_EMAIL not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const email       = typeof body?.email       === "string" ? body.email.trim().toLowerCase() : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword               : "";
  const secret      = typeof body?.secret      === "string" ? body.secret.trim()             : "";

  // ONE answer for both failures, and the secret compared in constant time.
  //
  // Previously the secret was checked first and answered "Invalid secret", while a
  // wrong email answered "Email must match ADMIN_EMAIL". That difference is a clean
  // oracle: an attacker could brute-force the SECRET ALONE, with any email, and know
  // the moment they had it — on an endpoint with no auth and no throttle. Now a
  // wrong secret and a wrong email are indistinguishable from outside.
  if (!timingSafeEqual(secret, expectedSecret) || email !== adminEmail) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // Look up the user by email — paginate auth.users until found.
  let userId: string | null = null;
  let page = 1;
  while (true) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 50 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const users = data?.users ?? [];
    const found = users.find(u => (u.email ?? "").toLowerCase() === adminEmail);
    if (found) { userId = found.id; break; }
    if (users.length < 50) break; // last page
    page++;
  }

  if (userId) {
    // Update password — also flag the email confirmed so login isn't blocked.
    const { error: upErr } = await db.auth.admin.updateUserById(userId, {
      password: newPassword,
      email_confirm: true,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      action: "updated",
      message: "Password reset. Sign in now, then run: npx wrangler secret delete BOOTSTRAP_RESET_SECRET",
    });
  }

  // No existing user — create a fresh one with the supreme-admin email.
  const { error: createErr } = await db.auth.admin.createUser({
    email: adminEmail,
    password: newPassword,
    email_confirm: true,
  });
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    action: "created",
    message: "Account created. Sign in now, then run: npx wrangler secret delete BOOTSTRAP_RESET_SECRET",
  });
}
