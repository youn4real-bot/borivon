import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { syncCalmaroiCandidateToDrive } from "@/lib/driveMirror";

/**
 * One-click backfill: mirror EVERY current Calmaroi candidate's approved docs
 * into the founder's Drive tree ("Calmaroi X Borivon / <batch> / <candidate>").
 *
 * Supreme-admin only — it writes into the founder's own Google Drive and is a
 * bulk op. The per-candidate sync is idempotent + sha-skips unchanged docs, so
 * re-running is cheap and safe (only newly-approved docs actually upload).
 *
 * The automatic triggers (on approval + on assignment) keep it current after
 * this; the backfill is just for candidates approved/assigned before the feature
 * shipped.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // Founder's own Drive + bulk → supreme admin only.
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  const db = getServiceSupabase();

  // Calmaroi org (by name) → its employers → their assigned candidates.
  const { data: orgs } = await db.from("organizations").select("id").ilike("name", "calmaroi");
  const calmaroiId = (orgs ?? [])[0]?.id as string | undefined;
  if (!calmaroiId) return NextResponse.json({ error: "Calmaroi organization not found" }, { status: 404 });

  const { data: emps } = await db.from("employers").select("id").eq("agency_id", calmaroiId);
  const empIds = (emps ?? []).map((e) => (e as { id: string }).id);
  if (empIds.length === 0) return NextResponse.json({ ok: true, candidates: 0, uploaded: 0, unchanged: 0, errors: [] });

  const { data: cands } = await db
    .from("candidate_profiles")
    .select("user_id")
    .in("employer_id", empIds);
  const userIds = (cands ?? []).map((c) => (c as { user_id: string }).user_id);

  let uploaded = 0;
  let unchanged = 0;
  const errors: { userId: string; error: string }[] = [];
  // Sequential on purpose — Drive API is rate-limited; a bulk parallel burst
  // would trip 429s. There are ~21 Calmaroi candidates, so this is quick enough.
  for (const uid of userIds) {
    const r = await syncCalmaroiCandidateToDrive(db, uid);
    if (r.ok) {
      uploaded += r.uploaded ?? 0;
      unchanged += r.unchanged ?? 0;
    } else {
      errors.push({ userId: uid, error: `${r.error}${r.hint ? `: ${r.hint}` : ""}` });
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: userIds.length,
    uploaded,
    unchanged,
    errors,
    hint: errors.length && errors[0].error.startsWith("workspace_not_connected")
      ? "Google Workspace/Drive isn't connected — check the Drive scope."
      : undefined,
  });
}
