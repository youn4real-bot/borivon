/**
 * DIY facilities (founder 2026-11-10): the platform is OUR REAL PORTAL, run by the facility itself.
 *
 *   • The gift link on the Fahrplan's last page creates an organization (like Calmaroi) + its first
 *     admin (an org-scoped sub-admin, LAW #25) — see app/api/einrichtung/start.
 *   • The facility invites its own nurses with its own link (organizations.invite_code); a nurse who
 *     signs up through it lands in that facility directly (LAW #25, amended 2026-11-10).
 *   • Borivon stays out: until the facility switches on "Mit Borivon arbeiten", its own nurses are not
 *     in the Borivon team's lists, the team cannot act on them, and no automatic Borivon reminder,
 *     chaser or bot nudge touches them. The supreme admin always sees everything (LAW #25).
 *   • Free scope (Nutzungsbedingungen § 3): FREE_NURSES nurses, FREE_USERS users per facility.
 *
 * The DIY settings live in their own raw-D1 table (fx_orgs), so the organizations table and the
 * Supabase-shaped adapter stay untouched.
 */
import { fxDb, nowIso } from "./db";
import { getServiceSupabase } from "@/lib/supabase";

export type DiyOrg = {
  org_id: string; lead_id: string; owner_email: string; borivon_access: boolean;
  nurse_limit: number; user_limit: number; terms_version: string; terms_at: string; created_at: string;
};

const rowOrg = (r: Record<string, unknown>): DiyOrg => ({
  org_id: String(r.org_id ?? ""), lead_id: String(r.lead_id ?? ""), owner_email: String(r.owner_email ?? ""),
  borivon_access: Number(r.borivon_access) === 1, nurse_limit: Number(r.nurse_limit ?? 0), user_limit: Number(r.user_limit ?? 0),
  terms_version: String(r.terms_version ?? ""), terms_at: String(r.terms_at ?? ""), created_at: String(r.created_at ?? ""),
});

/** The DIY settings of one organization, or null when it is not a DIY facility (e.g. Calmaroi). */
export async function diyOrg(orgId: string): Promise<DiyOrg | null> {
  if (!orgId) return null;
  const db = await fxDb();
  if (!db) return null;
  const r = (await db.run(`SELECT * FROM fx_orgs WHERE org_id = ?`, [orgId])).results[0];
  return r ? rowOrg(r) : null;
}

export async function setBorivonAccess(orgId: string, on: boolean): Promise<void> {
  const db = await fxDb();
  if (!db) throw new Error("no_db");
  await db.run(`UPDATE fx_orgs SET borivon_access = ?, access_changed_at = ? WHERE org_id = ?`, [on ? 1 : 0, nowIso(), orgId]);
}

/**
 * Candidate ids Borivon's team and automation must leave alone: approved members of a DIY facility
 * that has not switched on "Mit Borivon arbeiten". `ok:false` = the list could not be read: automation
 * then skips its run (never risk mailing a DIY nurse), lists show what they showed before.
 */
export async function hiddenFromBorivon(): Promise<{ ok: boolean; ids: Set<string> }> {
  try {
    const db = await fxDb();
    if (!db) return { ok: true, ids: new Set() };
    const { results } = await db.run(`SELECT org_id FROM fx_orgs WHERE borivon_access = 0`);
    const orgIds = results.map((r) => String(r.org_id)).filter(Boolean);
    if (!orgIds.length) return { ok: true, ids: new Set() };
    const { data, error } = await getServiceSupabase()
      .from("candidate_organizations")
      .select("candidate_user_id")
      .in("org_id", orgIds)
      .eq("status", "approved");
    if (error) return { ok: false, ids: new Set() };
    return { ok: true, ids: new Set(((data ?? []) as { candidate_user_id: string }[]).map((r) => r.candidate_user_id)) };
  } catch {
    return { ok: false, ids: new Set() };
  }
}

/** How many approved nurses / team members a facility has now (for the free scope). */
export async function diyUsage(orgId: string): Promise<{ nurses: number; users: number }> {
  const db = getServiceSupabase();
  const [n, u] = await Promise.all([
    db.from("candidate_organizations").select("candidate_user_id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "approved"),
    db.from("organization_members").select("org_id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  return { nurses: n.count ?? 0, users: u.count ?? 0 };
}

/** Unguessable invite codes (crypto, not Math.random): the candidate code is typed by nurses, so readable. */
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function candidateCode(len = 10): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join("");
}
export const memberCode = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
