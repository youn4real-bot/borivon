import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { looksLikeAffiliateCode } from "@/lib/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REF_COOKIE = "bv_ref";

/**
 * Attribute the logged-in candidate to the affiliate whose referral cookie they
 * carry. First-touch wins (never overwrites an existing referrer). Fired by the
 * dashboard on load; the server clears the cookie once the attribution is
 * resolved so it can't re-fire. If the candidate has no profile row yet, we
 * leave the cookie in place and let a later load retry.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { code?: string } = {};
  try { body = await req.json(); } catch { /* body optional — cookie fallback */ }
  const bodyCode = typeof body.code === "string" ? body.code.trim() : "";
  const cookieCode = req.cookies.get(REF_COOKIE)?.value ?? "";
  const code = looksLikeAffiliateCode(bodyCode) ? bodyCode
             : looksLikeAffiliateCode(cookieCode) ? cookieCode : "";

  // Helper: respond and clear the cookie (attribution is settled — stop retrying).
  const settled = (attributed: boolean, extra: Record<string, unknown> = {}) => {
    const r = NextResponse.json({ ok: true, attributed, done: true, ...extra });
    r.cookies.set(REF_COOKIE, "", { path: "/", maxAge: 0 });
    return r;
  };
  // Helper: keep the cookie, ask the client to retry later.
  const pending = () => NextResponse.json({ ok: true, attributed: false, done: false });

  if (!code) return settled(false);

  try {
    const db = getServiceSupabase();
    const { data: affRow } = await db.from("affiliates").select("id, user_id, active").eq("code", code).maybeSingle();
    const aff = affRow as { id: string; user_id: string | null; active: boolean } | null;
    if (!aff || aff.active === false) return settled(false);                 // bad/inactive code — stop
    if (aff.user_id && aff.user_id === auth.userId) return settled(false);   // no self-referral

    const { data: prof } = await db.from("candidate_profiles")
      .select("referred_by_affiliate").eq("user_id", auth.userId).maybeSingle();
    if (!prof) return pending();                                             // profile not created yet — retry later
    if ((prof as { referred_by_affiliate: string | null }).referred_by_affiliate) return settled(false, { already: true });

    // First-touch attribution. `.is(..., null)` guards a race so a concurrent
    // claim can't overwrite an already-set referrer.
    const { error } = await db.from("candidate_profiles")
      .update({ referred_by_affiliate: aff.id })
      .eq("user_id", auth.userId)
      .is("referred_by_affiliate", null);
    if (error) return settled(false);
    return settled(true);
  } catch {
    return settled(false);
  }
}
