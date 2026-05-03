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
 *      delete this env var from Vercel so the route becomes inert.
 *   3. New password must be at least 8 characters.
 *
 * Body: { email: string, newPassword: string, secret: string }
 *
 * Once the admin is back in, deleting the env var is enough — every
 * subsequent request will 403.
 */
export async function POST(req: NextRequest) {
  const expectedSecret = (process.env.BOOTSTRAP_RESET_SECRET ?? "").trim();
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Bootstrap reset is disabled. Set BOOTSTRAP_RESET_SECRET in Vercel env vars to enable it temporarily." },
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

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
  }
  if (email !== adminEmail) {
    return NextResponse.json({ error: "Email must match ADMIN_EMAIL" }, { status: 403 });
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
      message: "Password reset. Sign in now and then DELETE the BOOTSTRAP_RESET_SECRET env var in Vercel.",
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
    message: "Account created. Sign in now and then DELETE the BOOTSTRAP_RESET_SECRET env var in Vercel.",
  });
}
