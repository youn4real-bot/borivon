import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { looksLikeAffiliateCode } from "@/lib/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REF_COOKIE = "bv_ref";
const NINETY_DAYS = 90 * 24 * 60 * 60;

/**
 * Referral entry point:  borivon.com/r/<code>
 * Drops a 90-day cookie tagging this visitor to the affiliate, counts the click,
 * then sends them to the homepage. ALWAYS redirects (never reveals whether a
 * code is real) — only a valid, active code sets the cookie.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const res = NextResponse.redirect(new URL("/", req.url));
  if (!looksLikeAffiliateCode(code)) return res;
  try {
    const db = getServiceSupabase();
    const { data } = await db.from("affiliates").select("id, active, clicks").eq("code", code).maybeSingle();
    const aff = data as { id: string; active: boolean; clicks: number } | null;
    if (aff && aff.active !== false) {
      res.cookies.set(REF_COOKIE, code, {
        path: "/", maxAge: NINETY_DAYS, sameSite: "lax", httpOnly: false, secure: true,
      });
      // Best-effort vanity click count — approximate is fine; never block the redirect.
      try { await db.from("affiliates").update({ clicks: (aff.clicks ?? 0) + 1 }).eq("id", aff.id); } catch { /* ignore */ }
    }
  } catch { /* ignore — still redirect home */ }
  return res;
}
