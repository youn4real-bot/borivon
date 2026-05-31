import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, requireAdminRole } from "@/lib/admin-auth";

/**
 * Shared per-phase document display order (see supabase/phase_doc_order.sql).
 *
 * GET   — any logged-in user. Returns { orders: { visum: string[], … } } so the
 *         admin panel AND the candidate dashboard sort their Visum docs the same
 *         way. Degrades to {} (default code order) if the table isn't there yet.
 * PATCH — supreme admin only (role==="admin"): { phase, order_keys } upsert.
 */
const PHASES = new Set(["visum", "bearbeitung"]);

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data, error } = await db.from("phase_doc_order").select("phase, order_keys");
  if (error) {
    // Migration not run yet, or transient — degrade to default order, never 500.
    return NextResponse.json({ orders: {} });
  }
  const orders: Record<string, string[]> = {};
  for (const r of (data ?? []) as { phase: string; order_keys: unknown }[]) {
    orders[r.phase] = Array.isArray(r.order_keys) ? (r.order_keys as string[]).filter((k) => typeof k === "string") : [];
  }
  return NextResponse.json({ orders });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { phase?: string; order_keys?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const phase = String(body.phase ?? "");
  if (!PHASES.has(phase)) return NextResponse.json({ error: "invalid_phase" }, { status: 400 });
  if (!Array.isArray(body.order_keys)) return NextResponse.json({ error: "invalid_order" }, { status: 400 });

  // Strings only, deduped, capped — a saved order is a few dozen identifiers.
  const seen = new Set<string>();
  const order_keys: string[] = [];
  for (const k of body.order_keys as unknown[]) {
    if (typeof k !== "string") continue;
    const v = k.slice(0, 100);
    if (!seen.has(v)) { seen.add(v); order_keys.push(v); }
    if (order_keys.length >= 200) break;
  }

  const db = getServiceSupabase();
  const { error } = await db.from("phase_doc_order").upsert(
    { phase, order_keys, updated_at: new Date().toISOString() },
    { onConflict: "phase" },
  );
  if (error) {
    console.error("[phase-doc-order] write error:", error.message);
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
