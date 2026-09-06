import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import {
  looksLikeDashToken, hashDashToken, reconcileAffiliateEarnings, AFFILIATE_TERMS_VERSION,
} from "@/lib/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = (process.env.PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/$/, "");
const NF = () => NextResponse.json({ error: "Not found" }, { status: 404 });

async function affByToken(token: string) {
  if (!looksLikeDashToken(token)) return { db: null, aff: null } as const;
  const hash = await hashDashToken(token);
  const db = getServiceSupabase();
  const { data, error } = await db.from("affiliates").select("*").eq("dash_token_hash", hash).maybeSingle();
  if (error || !data) return { db, aff: null } as const;
  return { db, aff: data as Record<string, unknown> } as const;
}

/**
 * The affiliate's own read-only stats, keyed by their PRIVATE dashboard token.
 * Fail-closed 404 on any bad/unknown token. Returns COUNTS + € only — never a
 * referred nurse's name or id. Also reports whether they've accepted the T&C.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const rl = await enforceRateLimitDistributed(req, "aff-view", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { token } = await ctx.params;
  const { db, aff } = await affByToken(token);
  if (!db || !aff) return NF();
  const id = String(aff.id);

  await reconcileAffiliateEarnings(db);

  let referred = 0;
  try {
    const { count } = await db.from("candidate_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("referred_by_affiliate", id);
    referred = count ?? 0;
  } catch { /* pre-migration */ }

  let owedEur = 0, paidEur = 0, placed = 0;
  const earnings: { placed_at: string; status: string; amount_eur: number }[] = [];
  try {
    const { data: es } = await db.from("affiliate_earnings")
      .select("amount_eur, status, placed_at")
      .eq("affiliate_id", id)
      .order("placed_at", { ascending: false });
    for (const e of (es ?? []) as { amount_eur: number; status: string; placed_at: string }[]) {
      if (e.status !== "paid" && e.status !== "owed") continue; // skip 'void' (reversed placements)
      const amt = Number(e.amount_eur) || 0;
      placed++;
      if (e.status === "paid") paidEur += amt;
      else owedEur += amt;
      earnings.push({ placed_at: e.placed_at, status: e.status, amount_eur: amt });
    }
  } catch { /* pre-migration */ }

  // T&C gate: block until the affiliate has accepted the CURRENT terms version.
  // Pre-migration (column absent) → no gate. Bumping AFFILIATE_TERMS_VERSION
  // forces everyone to re-accept.
  const termsAccepted = "terms_accepted_at" in aff
    ? (!!aff.terms_accepted_at && aff.terms_version === AFFILIATE_TERMS_VERSION)
    : true;

  return NextResponse.json({
    name: String(aff.name ?? ""),
    active: aff.active !== false,
    currency: String(aff.currency ?? "EUR"),
    commissionEur: Number(aff.commission_eur) || 0,
    shareUrl: `${BASE}/r/${aff.code}`,
    clicks: Number(aff.clicks) || 0,
    referred,
    placed,
    owedEur,
    paidEur,
    termsAccepted,
    termsVersion: AFFILIATE_TERMS_VERSION,
    earnings, // date + status + € only — no nurse PII
  });
}

/**
 * The affiliate accepts the Terms & Conditions from their own dashboard.
 * Token-gated; records when + which version. Schema-tolerant (no-op before the
 * terms columns are migrated, so the dashboard never breaks).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const rl = await enforceRateLimitDistributed(req, "aff-accept", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { token } = await ctx.params;
  const { db, aff } = await affByToken(token);
  if (!db || !aff) return NF();

  // Ignore the error path: a missing column just means the migration isn't in
  // yet, in which case there's no gate to satisfy anyway.
  await db.from("affiliates")
    .update({ terms_accepted_at: new Date().toISOString(), terms_version: AFFILIATE_TERMS_VERSION })
    .eq("id", String(aff.id));

  return NextResponse.json({ ok: true });
}
