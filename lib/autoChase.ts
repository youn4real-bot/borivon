/**
 * Auto-chase — find candidates who may need a gentle nudge, so the founder
 * never has to remember who's gone quiet. DRAFT → APPROVE (founder's choice):
 * this only SURFACES the list (daily cron push + the listStuckCandidates tool);
 * nothing is messaged to a candidate until the founder approves a nudge via the
 * existing confirm-first tools (nudgeStuckCandidates / sendCandidateMessage).
 *
 * Two reliable, computable signals (staff excluded, like lib/briefing):
 *   • their LATEST uploaded document is REJECTED and ≥3 days old (they saw the
 *     rejection and haven't re-submitted)
 *   • pipeline hasn't moved in ≥21 days and they haven't arrived yet (stalled)
 */
import { getServiceSupabase } from "@/lib/supabase";
import { getStaffUserIdsAmong, resolveAuthNames } from "@/lib/admin-auth";
import { isAutomationEnabled } from "@/lib/automationSettings";

const DAY = 86_400_000;
const REJECT_GRACE_DAYS = 3;
const STALL_DAYS = 21;

export type StuckCandidate = { userId: string; name: string; reasons: string[] };

export async function computeStuckCandidates(
  opts?: { includeRejectedDocs?: boolean },
): Promise<{ candidates: StuckCandidate[]; text: string; count: number }> {
  const db = getServiceSupabase();
  const now = Date.now();
  // The "rejected document not re-submitted" reason is a document nag. On PROACTIVE
  // pushes (briefing fold-in, auto-chase cron) honor the founder's doc-reminder mute
  // (default OFF, fail-safe closed). Explicit "who's stuck?" queries pass true to
  // keep the full picture.
  const includeRejectedDocs =
    opts?.includeRejectedDocs ?? (await isAutomationEnabled("doc_reminders").catch(() => false));

  const { data: profs } = await db.from("candidate_profiles").select("user_id, first_name, last_name");
  const profRows = (profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[];
  const allIds = profRows.map((p) => p.user_id);
  if (allIds.length === 0) return { candidates: [], text: "✅ No candidates to chase.", count: 0 };

  const staff = await getStaffUserIdsAmong(allIds);
  const candIds = allIds.filter((id) => !staff.has(id));
  const nameById = new Map(profRows.map((p) => [p.user_id, [p.first_name, p.last_name].filter(Boolean).join(" ").trim()]));

  const reasons = new Map<string, string[]>();
  const push = (uid: string, reason: string) => {
    const a = reasons.get(uid) ?? [];
    if (!a.includes(reason)) a.push(reason);
    reasons.set(uid, a);
  };

  // 1) Latest document is rejected, ≥ grace days old (saw it, didn't re-submit).
  if (candIds.length && includeRejectedDocs) {
    const { data: docs } = await db
      .from("documents")
      .select("user_id, status, uploaded_at")
      .in("user_id", candIds)
      .order("uploaded_at", { ascending: false });
    const latest = new Map<string, { status: string | null; uploaded_at: string | null }>();
    for (const d of (docs ?? []) as { user_id: string; status: string | null; uploaded_at: string | null }[]) {
      if (!latest.has(d.user_id)) latest.set(d.user_id, d); // first = newest (ordered desc)
    }
    for (const [uid, d] of latest) {
      if (d.status === "rejected") {
        const t = Date.parse(d.uploaded_at ?? "");
        if (Number.isFinite(t) && t <= now - REJECT_GRACE_DAYS * DAY) push(uid, "rejected document not re-submitted");
      }
    }
  }

  // 2) Pipeline stalled ≥ STALL_DAYS and not arrived yet.
  if (candIds.length) {
    const { data: pipe } = await db
      .from("candidate_pipeline")
      .select("user_id, updated_at, arrived_done")
      .in("user_id", candIds);
    for (const p of (pipe ?? []) as { user_id: string; updated_at: string | null; arrived_done: boolean | null }[]) {
      if (p.arrived_done) continue;
      const t = Date.parse(p.updated_at ?? "");
      if (Number.isFinite(t) && t <= now - STALL_DAYS * DAY) push(p.user_id, "no movement in 3+ weeks");
    }
  }

  const stuckIds = [...reasons.keys()];
  // Resolve names that are blank on the profile from auth (full_name).
  const needNames = stuckIds.filter((id) => !(nameById.get(id)));
  const authNames = needNames.length ? await resolveAuthNames(needNames) : {};
  const candidates: StuckCandidate[] = stuckIds
    .map((uid) => ({ userId: uid, name: nameById.get(uid) || authNames[uid]?.name || uid, reasons: reasons.get(uid) ?? [] }))
    .sort((a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name));

  const lines: string[] = ["🔔 Borivon — candidates who may need a nudge", ""];
  if (candidates.length === 0) {
    lines.push("✅ Nobody's stuck — everyone's moving.");
  } else {
    for (const c of candidates.slice(0, 25)) lines.push(`   • ${c.name} — ${c.reasons.join("; ")}`);
    lines.push("", `That's ${candidates.length} candidate${candidates.length > 1 ? "s" : ""}. Reply "nudge them" to send each a gentle Borivon reminder (you'll confirm first), or "who's stuck" for the details.`);
  }
  return { candidates, text: lines.join("\n").trim(), count: candidates.length };
}
