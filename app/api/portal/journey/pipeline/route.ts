import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, getVisibleCandidateIds } from "@/lib/admin-auth";
import { computePipelineStatus, type JourneyRow } from "@/lib/journeyPipeline";
import { evaluateSellable } from "@/lib/sellable";

/**
 * Anerkennung / Visa Autopilot — pipeline overview (the admin "who's stuck where"
 * board). Returns EVERY candidate the caller may see, each with a computed
 * status (current step, progress, overdue/blocked counts, health).
 *
 * Scope: supreme admin + global sub-admins → all candidates; org-scoped
 * sub-admins → only their org's candidates (getVisibleCandidateIds, LAW #25).
 * Read-only; the actual edits happen through /api/portal/journey.
 */

export const dynamic = "force-dynamic";

// "today" in Casablanca (the business timezone) → deterministic deadline math.
function casablancaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // en-CA → "YYYY-MM-DD"
}

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  profile_photo: string | null;
};

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  // Visibility scope: null = sees all (supreme / global staff); [] or list = scoped.
  const visible = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);

  // Load candidate profiles in scope.
  let profQ = db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, profile_photo");
  if (visible !== null) {
    if (visible.length === 0) return NextResponse.json({ today: casablancaToday(), candidates: [] });
    profQ = profQ.in("user_id", visible);
  }
  const { data: profData, error: profErr } = await profQ;
  if (profErr) {
    console.error("[journey/pipeline] profiles error:", profErr.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  const profiles = (profData ?? []) as ProfileRow[];
  if (profiles.length === 0) return NextResponse.json({ today: casablancaToday(), candidates: [] });

  const ids = profiles.map((p) => p.user_id);

  // Pull every journey row for those candidates in ONE query (no N+1), then
  // group in memory and compute each candidate's status.
  const { data: itemData, error: itemErr } = await db
    .from("candidate_journey_items")
    .select("id, candidate_user_id, text, owner, done, preset_key, position, due_date, blocked, blocked_reason")
    .in("candidate_user_id", ids);
  if (itemErr) {
    console.error("[journey/pipeline] items error:", itemErr.message);
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const byCandidate = new Map<string, JourneyRow[]>();
  for (const r of (itemData ?? []) as (JourneyRow & { candidate_user_id: string })[]) {
    const arr = byCandidate.get(r.candidate_user_id) ?? [];
    arr.push(r);
    byCandidate.set(r.candidate_user_id, arr);
  }

  // Documents (only what the sellable gate needs) for the same candidates — one
  // batched query. Powers the "ready to sell" verdict per candidate.
  const { data: docData } = await db
    .from("documents")
    .select("user_id, file_type, status")
    .in("user_id", ids);
  const docsByCandidate = new Map<string, { file_type: string | null; status: string | null }[]>();
  for (const d of (docData ?? []) as { user_id: string; file_type: string | null; status: string | null }[]) {
    const arr = docsByCandidate.get(d.user_id) ?? [];
    arr.push({ file_type: d.file_type, status: d.status });
    docsByCandidate.set(d.user_id, arr);
  }

  const today = casablancaToday();
  const candidates = profiles.map((p) => {
    const journey = byCandidate.get(p.user_id) ?? [];
    const status = computePipelineStatus(journey, today);
    const sellable = evaluateSellable({ documents: docsByCandidate.get(p.user_id) ?? [], journey });
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    return {
      userId: p.user_id,
      name: name || "—",
      photo: p.profile_photo ?? null,
      status,
      sellable,
    };
  });

  // Hero summary for the admin dashboard.
  const summary = {
    total: candidates.length,
    sellable: candidates.filter((c) => c.sellable.sellable).length,
    // "Almost" = one of the two gates met (CV xor diploma) but not both.
    almost: candidates.filter((c) => !c.sellable.sellable && (c.sellable.cvDone || c.sellable.diplomaApproved)).length,
    needsAttention: candidates.filter((c) => c.status.health === "blocked" || c.status.health === "overdue").length,
    arrived: candidates.filter((c) => c.status.health === "done").length,
  };

  // Order: most urgent first (blocked → overdue → due_soon → on_track → done),
  // then by how overdue, so the admin's eye lands on fires immediately.
  const RANK: Record<string, number> = { blocked: 0, overdue: 1, due_soon: 2, on_track: 3, done: 4 };
  candidates.sort((a, b) => {
    const r = (RANK[a.status.health] ?? 9) - (RANK[b.status.health] ?? 9);
    if (r !== 0) return r;
    return (b.status.overdueCount + b.status.blockedCount) - (a.status.overdueCount + a.status.blockedCount);
  });

  return NextResponse.json({ today, candidates, summary });
}
