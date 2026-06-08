import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { UUID_RE } from "@/lib/uuid";
import { randomBytes } from "crypto";

/**
 * SUPREME-ADMIN-ONLY: set a brand-new password for ANY user (candidate, sub-
 * admin, org admin) WITHOUT the email-reset flow, and sign them out of every
 * device. The generated password is returned ONCE so the admin can hand it over.
 *
 * Gates: requireAdminRole + role === "admin" (the supreme account only — this is
 * the single most powerful account action). UUID-validated. Rate-limited.
 */

// Strong, unambiguous password (no 0/O/1/l/I), guaranteed ≥1 of each class.
function generatePassword(len = 18): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digit = "23456789";
  const sym = "!@#$%*?";
  const all = upper + lower + digit + sym;
  const pick = (set: string) => set[randomBytes(1)[0] % set.length];
  const chars = [pick(upper), pick(lower), pick(digit), pick(sym)];
  while (chars.length < len) chars.push(pick(all));
  // Fisher–Yates shuffle with crypto randomness so the guaranteed-class chars
  // aren't always in the first four positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  const rl = enforceRateLimit(req, "admin-reset-password", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: "Invalid userId" }, { status: 400 });

  const db = getServiceSupabase();

  // Confirm the target exists (and grab the email for the confirmation UI).
  const { data: target, error: getErr } = await db.auth.admin.getUserById(userId);
  if (getErr || !target?.user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const password = generatePassword();
  // email_confirm:true so the account can sign in immediately even if its email
  // was never confirmed (mirrors the bootstrap-reset behaviour).
  const { error: upErr } = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (upErr) {
    console.error("[reset-password] updateUserById failed:", upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Kick them off every device. Best-effort — the password is already changed,
  // so even if this fails the old password no longer works.
  let sessionsRevoked = 0;
  try {
    const { data, error } = await db.rpc("admin_force_logout", { target_user: userId });
    if (error) console.error("[reset-password] force-logout RPC error (non-fatal):", error.message);
    else if (typeof data === "number") sessionsRevoked = data;
  } catch (e) {
    console.error("[reset-password] force-logout threw (non-fatal):", e);
  }

  return NextResponse.json({ ok: true, email: target.user.email ?? "", password, sessionsRevoked });
}
