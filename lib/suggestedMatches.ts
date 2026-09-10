/**
 * lib/suggestedMatches.ts — keep the matches inbox to genuinely NEW suggestions.
 *
 * The generator writes a suggested_matches row and nothing ever cleans it up, so
 * a candidate who is subsequently linked to that agency — by the founder, by the
 * bot, or by being placed at one of the agency's sites — stays in the pending
 * queue forever. The inbox then asks the founder to approve people the agency
 * already has, which is not merely noise: BOTH accept paths look the existing
 * link up with no status filter and force it to `approved`, so one careless
 * click on a stale row can silently promote a link that was deliberately left
 * pending, or resurrect one that was withdrawn.
 *
 * Filtering at READ time rather than write time is deliberate: a write-time
 * check can only be true at the moment it runs, and the link usually arrives
 * afterwards. This is the only place that stays correct.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type LinkablePair = { candidate_user_id: string; org_id: string };

/** `${candidateId}|${orgId}` — the identity of one candidate-agency pairing. */
export const pairKey = (candidateUserId: string, orgId: string): string =>
  `${candidateUserId}|${orgId}`;

/**
 * PURE. Given the pairs that already exist, drop those rows from the suggestions.
 * Split out from the IO so the rule itself is testable.
 */
export function rejectExistingPairs<T extends LinkablePair>(rows: T[], existing: ReadonlySet<string>): T[] {
  return rows.filter(r => !existing.has(pairKey(r.candidate_user_id, r.org_id)));
}

/**
 * Every (candidate, agency) pairing that already exists for the given rows —
 * whether through an explicit candidate_organizations link (approved OR pending;
 * a pending link is still "already suggested", and re-suggesting it is what lets
 * an accept silently approve it), or implicitly by the candidate being placed at
 * a site belonging to that agency.
 *
 * Two batched queries, never per-row. Fails OPEN (returns what it managed to
 * find): a hiccup here should leave a few stale suggestions visible, never hide
 * real ones.
 */
export async function existingPairsFor(
  db: SupabaseClient,
  rows: readonly LinkablePair[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const candidateIds = [...new Set(rows.map(r => r.candidate_user_id))];
  if (candidateIds.length === 0) return out;

  // 1) Explicit agency links.
  try {
    const { data } = await db
      .from("candidate_organizations")
      .select("candidate_user_id, org_id, status")
      .in("candidate_user_id", candidateIds);
    for (const l of (data ?? []) as { candidate_user_id: string; org_id: string; status: string | null }[]) {
      if (l.status === "approved" || l.status === "pending") out.add(pairKey(l.candidate_user_id, l.org_id));
    }
  } catch { /* fail open */ }

  // 2) Implicit: placed at a SITE that belongs to the agency.
  try {
    const { data: profs } = await db
      .from("candidate_profiles")
      .select("user_id, employer_id")
      .in("user_id", candidateIds);
    const byEmployer = new Map<string, string[]>();
    for (const p of (profs ?? []) as { user_id: string; employer_id: string | null }[]) {
      if (!p.employer_id) continue;
      const list = byEmployer.get(p.employer_id) ?? [];
      list.push(p.user_id);
      byEmployer.set(p.employer_id, list);
    }
    if (byEmployer.size) {
      const { data: emps } = await db
        .from("employers")
        .select("id, agency_id")
        .in("id", [...byEmployer.keys()]);
      for (const e of (emps ?? []) as { id: string; agency_id: string | null }[]) {
        if (!e.agency_id) continue;
        for (const uid of byEmployer.get(e.id) ?? []) out.add(pairKey(uid, e.agency_id));
      }
    }
  } catch { /* fail open */ }

  return out;
}

/** Convenience: the suggestions that are genuinely new. */
export async function filterAlreadyLinked<T extends LinkablePair>(
  db: SupabaseClient,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  return rejectExistingPairs(rows, await existingPairsFor(db, rows));
}
