/**
 * Employer shortlist — admin detail / edit / delete for one shortlist.
 *
 *   GET    → { shortlist, candidates:[{ position, adminNote, ...summary }] }
 *   PATCH  → edit { title?, note?, status?('draft'|'shared'), regenToken? }
 *   DELETE → remove the shortlist (cascades its candidate rows)
 *
 * Every verb re-loads the shortlist's org_id and gates on canActOnOrg (LAW #25):
 * an org-scoped admin can only touch their own org's shortlists.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, canActOnOrg, type AdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { getCandidateSummaries, genShareToken } from "@/lib/shortlist";
import { UUID_RE } from "@/lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ShortlistRow = { id: string; org_id: string | null; employer_id: string | null; title: string; note: string | null; status: string; share_token: string | null; created_at: string };

/** Load the shortlist and gate on org scope. Returns the row or an error response. */
async function loadAndGate(id: string, role: AdminRole, email: string): Promise<{ ok: true; row: ShortlistRow } | { ok: false; status: number; error: string }> {
  if (!UUID_RE.test(id)) return { ok: false, status: 400, error: "Bad id" };
  const db = getServiceSupabase();
  const { data } = await db
    .from("employer_shortlists")
    .select("id, org_id, employer_id, title, note, status, share_token, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { ok: false, status: 404, error: "Not found" };
  const row = data as ShortlistRow;
  if (!(await canActOnOrg(role, email, row.org_id))) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, row };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  const gate = await loadAndGate(id, auth.role, auth.email);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const db = getServiceSupabase();
  const { data: mem } = await db
    .from("shortlist_candidates")
    .select("candidate_user_id, position, admin_note")
    .eq("shortlist_id", id)
    .order("position", { ascending: true });
  const rows = (mem ?? []) as { candidate_user_id: string; position: number; admin_note: string | null }[];
  const summaries = await getCandidateSummaries(rows.map((r) => r.candidate_user_id));

  const candidates = rows.map((r) => ({
    position: r.position,
    adminNote: r.admin_note ?? "",
    ...(summaries[r.candidate_user_id] ?? {
      userId: r.candidate_user_id, name: "—", email: "", photo: null, verified: false,
      nationality: null, city: null, profession: null, b2Stage: null, yearsExperience: null,
      docCount: 0, docsOk: 0, docsPending: 0, hasCvDraft: false,
    }),
  }));

  const r = gate.row;
  return NextResponse.json({
    shortlist: { id: r.id, title: r.title, note: r.note ?? "", status: r.status, shareToken: r.share_token, orgId: r.org_id, employerId: r.employer_id, createdAt: r.created_at },
    candidates,
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  const gate = await loadAndGate(id, auth.role, auth.email);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") { const t = body.title.trim().slice(0, 200); if (!t) return NextResponse.json({ error: "Title required" }, { status: 400 }); patch.title = t; }
  if (typeof body.note === "string") patch.note = body.note.trim().slice(0, 2000) || null;
  if (typeof body.status === "string") {
    if (body.status !== "draft" && body.status !== "shared") return NextResponse.json({ error: "Bad status" }, { status: 400 });
    patch.status = body.status;
  }
  if (typeof body.employerId === "string" || body.employerId === null) {
    patch.employer_id = typeof body.employerId === "string" && UUID_RE.test(body.employerId) ? body.employerId : null;
  }
  // Regenerate the share token (invalidates the old link).
  if (body.regenToken === true) patch.share_token = genShareToken();

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  const { error } = await getServiceSupabase().from("employer_shortlists").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await ctx.params;
  const gate = await loadAndGate(id, auth.role, auth.email);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  // shortlist_candidates cascades via the FK on delete.
  const { error } = await getServiceSupabase().from("employer_shortlists").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
