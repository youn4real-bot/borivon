/**
 * Affiliate / referral helpers.
 *
 *  - PUBLIC code  → the share link  borivon.com/r/<code>  (not secret).
 *  - PRIVATE dash token → the no-login stats page affiliates.borivon.com/<token>;
 *    only its sha256 hash is stored (mirrors lib/uploadLink.ts / partnerKeys).
 *  - reconcileAffiliateEarnings() derives 'owed' rows from the source of truth
 *    (candidate referred + arrived in Germany), so no write-path hook can be
 *    missed and a placement is never double-credited.
 *
 * WebCrypto only → runs on both Node 18+ and Cloudflare Workers.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// Public ref code: unambiguous alphabet (no 0/O/1/I/L) so it survives being
// typed, spoken, or WhatsApp-forwarded.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateAffiliateCode(len = 7): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}
export function looksLikeAffiliateCode(c: unknown): c is string {
  return typeof c === "string" && /^[A-Z2-9]{5,16}$/.test(c);
}

const TOKEN_BYTES = 32; // 256-bit private dashboard token
export function generateDashToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function hashDashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function looksLikeDashToken(t: unknown): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{40,64}$/.test(t);
}

/** The milestone that earns the referrer — founder's choice: nurse arrives in DE. */
export const PLACEMENT_FIELD = "arrived_done";

/** Current affiliate T&C version — stamped on acceptance (bump to force re-accept). */
export const AFFILIATE_TERMS_VERSION = "2026-09-06";

/**
 * Idempotently create an 'owed' earning for every referred candidate who has
 * reached the placement milestone. Derived from live data (not a write hook),
 * so nothing is ever missed; unique(affiliate_id,candidate_user_id) +
 * ignoreDuplicates snapshot the amount once and prevent double-credit.
 * Fully schema-tolerant — a no-op before the migration is applied.
 */
export async function reconcileAffiliateEarnings(db: SupabaseClient): Promise<void> {
  try {
    const { data: refd, error: e1 } = await db
      .from("candidate_profiles")
      .select("user_id, referred_by_affiliate")
      .not("referred_by_affiliate", "is", null);
    if (e1) return;
    const affByUser = new Map<string, string>();
    for (const r of (refd ?? []) as { user_id: string; referred_by_affiliate: string }[]) {
      if (r.user_id && r.referred_by_affiliate) affByUser.set(r.user_id, r.referred_by_affiliate);
    }
    const userIds = [...affByUser.keys()];

    // Affiliate commission + active state.
    const { data: affs } = await db.from("affiliates").select("id, commission_eur, active");
    const comm = new Map<string, { amount: number; active: boolean }>();
    for (const a of (affs ?? []) as { id: string; commission_eur: number; active: boolean }[]) {
      comm.set(a.id, { amount: Number(a.commission_eur) || 0, active: a.active !== false });
    }

    // Which referred candidates are CURRENTLY placed (arrived in Germany).
    const arrivedSet = new Set<string>();
    if (userIds.length) {
      const { data: arr, error: e2 } = await db
        .from("candidate_pipeline")
        .select("user_id, arrived_done")
        .in("user_id", userIds)
        .eq("arrived_done", true);
      if (e2) return; // failed read → never void on a blind spot
      for (const a of (arr ?? []) as { user_id: string }[]) arrivedSet.add(a.user_id);
    }

    // Existing earnings, keyed by (affiliate, candidate).
    const { data: existing, error: e3 } = await db
      .from("affiliate_earnings")
      .select("id, affiliate_id, candidate_user_id, amount_eur, status");
    if (e3) return;
    const byPair = new Map<string, { id: string; amount_eur: number; status: string }>();
    for (const r of (existing ?? []) as { id: string; affiliate_id: string; candidate_user_id: string; amount_eur: number; status: string }[]) {
      byPair.set(r.affiliate_id + "::" + r.candidate_user_id, r);
    }

    const toInsert: { affiliate_id: string; candidate_user_id: string; amount_eur: number; status: string }[] = [];
    const toOwed: string[] = [];                            // revive void → owed (re-arrived)
    const toRefresh: { id: string; amount: number }[] = []; // fix a €0 snapshot on an unpaid row
    const qualified = new Set<string>();                    // arrived + referred → protected from void

    for (const userId of arrivedSet) {
      const affId = affByUser.get(userId);
      if (!affId) continue;
      const pairKey = affId + "::" + userId;
      qualified.add(pairKey);                               // protected regardless of active state
      const c = comm.get(affId);
      if (!c || !c.active) continue;                        // inactive affiliate: don't create/revive
      const row = byPair.get(pairKey);
      if (!row) { toInsert.push({ affiliate_id: affId, candidate_user_id: userId, amount_eur: c.amount, status: "owed" }); continue; }
      if (row.status === "void") {
        toOwed.push(row.id);
        if ((Number(row.amount_eur) || 0) === 0 && c.amount > 0) toRefresh.push({ id: row.id, amount: c.amount });
      } else if (row.status === "owed" && (Number(row.amount_eur) || 0) === 0 && c.amount > 0) {
        toRefresh.push({ id: row.id, amount: c.amount });
      }
      // 'paid' rows are never touched.
    }

    // Void 'owed' rows that no longer qualify (arrived_done reversed, or attribution
    // removed). 'paid' rows are never voided; an inactive affiliate's already-earned
    // rows stay (they were earned while active).
    const toVoid: string[] = [];
    for (const [pairKey, row] of byPair) {
      if (row.status === "owed" && !qualified.has(pairKey)) toVoid.push(row.id);
    }

    if (toInsert.length) await db.from("affiliate_earnings").upsert(toInsert, { onConflict: "affiliate_id,candidate_user_id", ignoreDuplicates: true });
    if (toOwed.length) await db.from("affiliate_earnings").update({ status: "owed" }).in("id", toOwed);
    for (const r of toRefresh) await db.from("affiliate_earnings").update({ amount_eur: r.amount }).eq("id", r.id);
    if (toVoid.length) await db.from("affiliate_earnings").update({ status: "void" }).in("id", toVoid);
  } catch {
    /* pre-migration column/table absent, or transient — degrade to no-op */
  }
}
