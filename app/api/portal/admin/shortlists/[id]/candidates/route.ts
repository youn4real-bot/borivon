/**
 * Employer shortlist — add / remove / reorder candidates.
 *
 *   POST   → add    { candidateUserId, adminNote? }
 *   DELETE → remove { candidateUserId }
 *   PATCH  → reorder{ order: string[] }   (candidate ids in the new order)
 *
 * Gated twice: the shortlist's org (canActOnOrg, LAW #25 agency dimension) AND —
 * for adds — the candidate itself (canActOnCandidate), so an admin can only put
 * candidates they may act on onto a shortlist they own.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, canActOnOrg, canActOnCandidate, type AdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Load the shortlist's org_id and gate on it. */
async function gateShortlist(id: string, role: AdminRole, email: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!UUID_RE.test(id)) return { ok: false, status: 400, error: "Bad id" };
  const { data } = await getServiceSupabase().from("employer_shortlists").select("org_id").eq("id", id).maybeSingle();
  if (!data) return { ok: false, status: 404, error: "Not found" };
  if (!(await canActOnOrg(role, email, (data as { org_id: string | null }).org_id))) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  const gate = await gateShortlist(id, auth.role, auth.email);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId : "";
  if (!UUID_RE.test(candidateUserId)) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });
  // The admin must be allowed to act on this candidate (org-scoped admins can't
  // shortlist candidates outside their org).
  if (!(await canActOnCandidate(auth.role, auth.email, candidateUserId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const adminNote = typeof body?.adminNote === "string" ? body.adminNote.trim().slice(0, 500) : null;

  const db = getServiceSupabase();
  // Next position = current max + 1.
  const { data: existing } = await db.from("shortlist_candidates").select("position").eq("shortlist_id", id).order("position", { ascending: false }).limit(1);
  const nextPos = ((existing ?? [])[0] as { position: number } | undefined)?.position ?? -1;
  const { error } = await db.from("shortlist_candidates").upsert(
    { shortlist_id: id, candidate_user_id: candidateUserId, position: nextPos + 1, admin_note: adminNote },
    { onConflict: "shortlist_id,candidate_user_id" },
  );
  if (error) return NextResponse.json({ error: "add_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  const gate = await gateShortlist(id, auth.role, auth.email);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId : "";
  if (!UUID_RE.test(candidateUserId)) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });

  const { error } = await getServiceSupabase().from("shortlist_candidates").delete().eq("shortlist_id", id).eq("candidate_user_id", candidateUserId);
  if (error) return NextResponse.json({ error: "remove_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  const gate = await gateShortlist(id, auth.role, auth.email);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const order = Array.isArray(body?.order) ? body.order.filter((x: unknown): x is string => typeof x === "string" && UUID_RE.test(x)) : [];
  if (order.length === 0) return NextResponse.json({ error: "Bad order" }, { status: 400 });

  const db = getServiceSupabase();
  // Renumber only the rows on THIS shortlist (scoped by shortlist_id + candidate).
  await Promise.all(order.map((uid: string, i: number) =>
    db.from("shortlist_candidates").update({ position: i }).eq("shortlist_id", id).eq("candidate_user_id", uid),
  ));
  return NextResponse.json({ ok: true });
}
