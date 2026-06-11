/**
 * AI status-writes with a confirm-first state machine.
 *
 * The assistant NEVER mutates a candidate directly. A write tool STAGES the
 * change (assistant_pending_actions); only after the admin confirms in a
 * separate message does executeLatestPending() apply it. The actual write
 * MIRRORS app/api/portal/pipeline PATCH exactly (candidate_pipeline, status enum
 * pending|passed|failed, ""→null dates, update-then-insert, updated_at stamp) so
 * the AI path can never bypass the portal's validation. Supreme-admin only.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { canActOnCandidate } from "@/lib/admin-auth";
import type { AssistantScope } from "@/lib/assistantScope";

const VALID_INTERVIEW_STATUS = new Set(["pending", "passed", "failed"]);

/** Validated write to candidate_pipeline interview fields — mirrors the route. */
async function writeInterview(
  userId: string,
  which: 1 | 2,
  status: string | undefined,
  dateISO: string | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fields: Record<string, unknown> = {};
  if (status !== undefined) {
    if (!VALID_INTERVIEW_STATUS.has(status)) return { ok: false, error: "bad_status" };
    fields[`interview${which}_status`] = status;
  }
  if (dateISO !== undefined) {
    fields[`interview${which}_date`] = dateISO === "" ? null : dateISO;
  }
  if (Object.keys(fields).length === 0) return { ok: false, error: "nothing_to_write" };
  fields.updated_at = new Date().toISOString();

  const db = getServiceSupabase();
  const { data: updated, error: updErr } = await db
    .from("candidate_pipeline").update(fields).eq("user_id", userId).select("user_id");
  if (updErr) return { ok: false, error: "write_failed" };
  if (!updated || updated.length === 0) {
    const { error: insErr } = await db.from("candidate_pipeline").insert({ user_id: userId, ...fields });
    if (insErr) return { ok: false, error: "write_failed" };
  }
  return { ok: true };
}

type PendingRow = {
  id: string;
  tool_name: string;
  args: Record<string, unknown>;
  candidate_user_id: string | null;
  summary: string;
  expires_at: string;
};

async function getLatestPending(ownerId: string): Promise<PendingRow | null> {
  const db = getServiceSupabase();
  const { data } = await db
    .from("assistant_pending_actions")
    .select("id, tool_name, args, candidate_user_id, summary, expires_at")
    .eq("owner_user_id", ownerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as PendingRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null; // expired
  return row;
}

/** Stage a proposed write for confirmation. Returns the summary to show the admin. */
export async function stagePending(
  scope: AssistantScope,
  opts: { toolName: string; args: Record<string, unknown>; candidateUserId: string; summary: string },
): Promise<{ staged: true; summary: string } | { error: string }> {
  if (!scope.userId) return { error: "no_user" };
  const db = getServiceSupabase();
  // Drop any older still-pending proposal for this admin so 'yes' is unambiguous.
  await db.from("assistant_pending_actions").update({ status: "cancelled" })
    .eq("owner_user_id", scope.userId).eq("status", "pending");
  const { error } = await db.from("assistant_pending_actions").insert({
    owner_user_id: scope.userId,
    tool_name: opts.toolName,
    args: opts.args,
    candidate_user_id: opts.candidateUserId,
    summary: opts.summary,
    status: "pending",
  });
  if (error) return { error: "stage_failed" };
  return { staged: true, summary: opts.summary };
}

/** Apply the most recent staged write AFTER the admin confirms. */
export async function executeLatestPending(
  scope: AssistantScope,
): Promise<{ done: true; summary: string } | { error: string }> {
  const row = await getLatestPending(scope.userId);
  if (!row) return { error: "nothing_pending" };
  // Serve-time scope re-check (defense-in-depth).
  if (row.candidate_user_id && !(await canActOnCandidate(scope.role, scope.email, row.candidate_user_id))) {
    const db = getServiceSupabase();
    await db.from("assistant_pending_actions").update({ status: "cancelled" }).eq("id", row.id);
    return { error: "out_of_scope" };
  }
  const a = row.args;
  let result: { ok: true } | { ok: false; error: string } = { ok: false, error: "unknown_tool" };
  if (row.tool_name === "setInterviewResult") {
    result = await writeInterview(String(a.candidateUserId), Number(a.which) === 2 ? 2 : 1, String(a.result), undefined);
  } else if (row.tool_name === "setInterviewDate") {
    result = await writeInterview(String(a.candidateUserId), Number(a.which) === 2 ? 2 : 1, undefined, a.date == null ? "" : String(a.date));
  }
  if (!result.ok) return { error: result.error };
  const db = getServiceSupabase();
  await db.from("assistant_pending_actions").update({ status: "confirmed" }).eq("id", row.id);
  return { done: true, summary: row.summary };
}

/** Discard the most recent staged write. */
export async function cancelLatestPending(
  scope: AssistantScope,
): Promise<{ cancelled: true; summary: string } | { error: string }> {
  const row = await getLatestPending(scope.userId);
  if (!row) return { error: "nothing_pending" };
  const db = getServiceSupabase();
  await db.from("assistant_pending_actions").update({ status: "cancelled" }).eq("id", row.id);
  return { cancelled: true, summary: row.summary };
}
