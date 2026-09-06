import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import {
  generateAffiliateCode, generateDashToken, hashDashToken, reconcileAffiliateEarnings,
} from "@/lib/affiliates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = (process.env.PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/$/, "");
const AFF_HOST = process.env.AFFILIATE_BASE_URL || "https://affiliates.borivon.com";
const clip = (s: unknown, n: number) => (typeof s === "string" ? s : "").trim().slice(0, n);

// Affiliates + payouts touch real money → SUPREME ADMIN ONLY (like LAW #31).
async function gate(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { err: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (auth.role !== "admin") return { err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { auth };
}

/** GET — list all affiliates with live aggregates (reconciles earnings first). */
export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (g.err) return g.err;
  const db = getServiceSupabase();
  await reconcileAffiliateEarnings(db);

  // select("*") is schema-tolerant — picks up terms_accepted_at once its
  // migration is applied, without breaking beforehand.
  const { data: affs, error } = await db
    .from("affiliates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ affiliates: [] });

  // Bulk aggregates (few affiliates, modest candidate count → cheap in code).
  const referredBy = new Map<string, number>();
  try {
    const { data: refd } = await db.from("candidate_profiles")
      .select("referred_by_affiliate").not("referred_by_affiliate", "is", null);
    for (const r of (refd ?? []) as { referred_by_affiliate: string }[])
      referredBy.set(r.referred_by_affiliate, (referredBy.get(r.referred_by_affiliate) ?? 0) + 1);
  } catch { /* pre-migration */ }

  const owed = new Map<string, number>(), paid = new Map<string, number>(), placed = new Map<string, number>();
  try {
    const { data: es } = await db.from("affiliate_earnings").select("affiliate_id, amount_eur, status");
    for (const e of (es ?? []) as { affiliate_id: string; amount_eur: number; status: string }[]) {
      const amt = Number(e.amount_eur) || 0;
      placed.set(e.affiliate_id, (placed.get(e.affiliate_id) ?? 0) + 1);
      if (e.status === "paid") paid.set(e.affiliate_id, (paid.get(e.affiliate_id) ?? 0) + amt);
      else if (e.status === "owed") owed.set(e.affiliate_id, (owed.get(e.affiliate_id) ?? 0) + amt);
    }
  } catch { /* pre-migration */ }

  const affiliates = ((affs ?? []) as Record<string, unknown>[]).map((a) => ({
    ...a,
    shareUrl: `${BASE}/r/${a.code}`,
    referred: referredBy.get(a.id as string) ?? 0,
    placed: placed.get(a.id as string) ?? 0,
    owedEur: owed.get(a.id as string) ?? 0,
    paidEur: paid.get(a.id as string) ?? 0,
    // null when the terms column isn't migrated yet; else accepted true/false.
    termsAccepted: "terms_accepted_at" in a ? !!a.terms_accepted_at : null,
  }));
  return NextResponse.json({ affiliates });
}

/** POST — create an affiliate. Returns the RAW dashboard token ONCE. */
export async function POST(req: NextRequest) {
  const g = await gate(req);
  if (g.err) return g.err;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const name = clip(body.name, 120);
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const commission_eur = Math.max(0, Number(body.commission_eur) || 0);
  const rawToken = generateDashToken();
  const dash_token_hash = await hashDashToken(rawToken);

  const db = getServiceSupabase();
  // Insert with a fresh code; retry on the (astronomically rare) code collision.
  let created: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const code = generateAffiliateCode();
    const { data, error } = await db.from("affiliates").insert({
      code, dash_token_hash, name,
      email: clip(body.email, 254) || null,
      phone: clip(body.phone, 40) || null,
      commission_eur,
      currency: clip(body.currency, 8) || "EUR",
      notes: clip(body.notes, 1000) || null,
      created_by: g.auth.email,
    }).select("id, code").maybeSingle();
    if (!error && data) { created = data as { id: string; code: string }; break; }
    if (error && !/duplicate|unique|23505/i.test(error.message ?? "")) {
      console.error("[affiliates POST]", error.message);
      return NextResponse.json({ error: "Could not create affiliate" }, { status: 500 });
    }
  }
  if (!created) return NextResponse.json({ error: "Could not allocate a code" }, { status: 500 });

  return NextResponse.json({
    ok: true,
    id: created.id,
    code: created.code,
    shareUrl: `${BASE}/r/${created.code}`,
    dashUrl: `${AFF_HOST.replace(/\/$/, "")}/${rawToken}`,
    dashUrlFallback: `${BASE}/affiliate/${rawToken}`,
    dashToken: rawToken, // shown ONCE — never stored in clear
  });
}

/** PATCH — edit an affiliate, or regenerate its dashboard token. */
export async function PATCH(req: NextRequest) {
  const g = await gate(req);
  if (g.err) return g.err;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const id = clip(body.id, 64);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const db = getServiceSupabase();

  // Regenerate the private dashboard link (old link dies).
  if (body.regenerateToken === true) {
    const rawToken = generateDashToken();
    const dash_token_hash = await hashDashToken(rawToken);
    const { error } = await db.from("affiliates").update({ dash_token_hash }).eq("id", id);
    if (error) return NextResponse.json({ error: "Could not regenerate" }, { status: 500 });
    return NextResponse.json({
      ok: true,
      dashUrl: `${AFF_HOST.replace(/\/$/, "")}/${rawToken}`,
      dashUrlFallback: `${BASE}/affiliate/${rawToken}`,
      dashToken: rawToken,
    });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = clip(body.name, 120);
  if (body.email !== undefined) updates.email = clip(body.email, 254) || null;
  if (body.phone !== undefined) updates.phone = clip(body.phone, 40) || null;
  if (body.notes !== undefined) updates.notes = clip(body.notes, 1000) || null;
  if (body.currency !== undefined) updates.currency = clip(body.currency, 8) || "EUR";
  if (body.commission_eur !== undefined) updates.commission_eur = Math.max(0, Number(body.commission_eur) || 0);
  if (body.active !== undefined) updates.active = body.active !== false;
  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true });

  const { error } = await db.from("affiliates").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: "Could not update" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
