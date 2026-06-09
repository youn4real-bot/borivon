import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * GDPR consent ledger for the live classroom. A candidate must actively agree
 * before any engagement telemetry is captured or shown to employers — and can
 * withdraw at any time (DELETE), which immediately stops employer-side sharing.
 *
 * GET    → { consented, consentedAt, version }
 * POST   → record consent  → { consented: true }
 * DELETE → withdraw consent → { consented: false }
 */
export const dynamic = "force-dynamic";
const CONSENT_VERSION = "v1-2026-06";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getServiceSupabase();
  const { data } = await db.from("classroom_consent").select("consented_at, revoked_at, version").eq("user_id", auth.userId).maybeSingle();
  const row = data as { consented_at: string; revoked_at: string | null; version: string } | null;
  const consented = !!row && !row.revoked_at;
  return NextResponse.json({ consented, consentedAt: consented ? row!.consented_at : null, version: row?.version ?? CONSENT_VERSION });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getServiceSupabase();
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300);
  const { error } = await db.from("classroom_consent").upsert(
    { user_id: auth.userId, version: CONSENT_VERSION, consented_at: new Date().toISOString(), revoked_at: null, user_agent: ua },
    { onConflict: "user_id" },
  );
  if (error) { console.error("[classroom/consent] POST error:", error.message); return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
  return NextResponse.json({ consented: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getServiceSupabase();
  // Withdrawal: keep the row for audit, stamp revoked_at. No hard delete.
  const { error } = await db.from("classroom_consent").update({ revoked_at: new Date().toISOString() }).eq("user_id", auth.userId);
  if (error) { console.error("[classroom/consent] DELETE error:", error.message); return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
  return NextResponse.json({ consented: false });
}
