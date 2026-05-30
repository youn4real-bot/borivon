import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, getVisibleCandidateIds } from "@/lib/admin-auth";

/**
 * Admin tracking view: every task an admin has ASSIGNED to candidates (custom
 * candidate-owned journey items) grouped by candidate, with each item's checked
 * status — so the admin sees who ticked what and who hasn't.
 *
 * Scope (LAW #25): supreme + global sub-admin → all candidates; org-admin →
 * only their org's candidates (getVisibleCandidateIds).
 *
 * Preset milestones are excluded (preset_key IS NULL) — this is only the
 * manually-assigned tasks.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const visible = await getVisibleCandidateIds(auth.email); // null = all, [] = none
  if (Array.isArray(visible) && visible.length === 0) return NextResponse.json({ groups: [] });

  const db = getServiceSupabase();
  let q = db
    .from("candidate_journey_items")
    .select("id, candidate_user_id, text, done, done_at, position, created_at")
    .eq("owner", "candidate")
    .is("preset_key", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (Array.isArray(visible)) q = q.in("candidate_user_id", visible);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; candidate_user_id: string; text: string; done: boolean; done_at: string | null };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return NextResponse.json({ groups: [] });

  // Resolve candidate display names.
  const ids = [...new Set(rows.map(r => r.candidate_user_id))];
  const { data: profs } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name")
    .in("user_id", ids);
  const nameMap = new Map<string, string>(
    ((profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[])
      .map(p => [p.user_id, [p.first_name, p.last_name].filter(Boolean).join(" ").trim()]),
  );

  const byCand = new Map<string, { candidateId: string; name: string; total: number; done: number; items: { id: string; text: string; done: boolean; done_at: string | null }[] }>();
  for (const r of rows) {
    let g = byCand.get(r.candidate_user_id);
    if (!g) {
      g = { candidateId: r.candidate_user_id, name: nameMap.get(r.candidate_user_id) || "—", total: 0, done: 0, items: [] };
      byCand.set(r.candidate_user_id, g);
    }
    g.total += 1;
    if (r.done) g.done += 1;
    g.items.push({ id: r.id, text: r.text, done: r.done, done_at: r.done_at });
  }

  const groups = [...byCand.values()].sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ groups });
}
