import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import { resolveBatchSyncTargets, ensureBatchFolder, mirrorCandidateApprovedDocs, getDriveOrNull } from "@/lib/driveMirror";

/**
 * Manual "Sync this batch → Drive" (supreme admin only). Copies every approved
 * doc of every candidate IN the given batch into the founder's Google Drive:
 *   "<Agency> X Borivon" / "<Batch>" / "<Candidate>" / <doc>
 *
 * Works for ANY agency/employer — the founder picks which batch to sync on the
 * tracker. Idempotent + cheap: a doc whose sha already matches its mirrored copy
 * is skipped with no Drive call, so re-runs (and this route being time-budgeted)
 * converge cleanly. Writes into the founder's own Drive → supreme admin only.
 */
export const maxDuration = 60;
const TIME_BUDGET_MS = 45_000;

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const batchId = typeof body?.batchId === "string" ? body.batchId.trim() : "";
  if (!UUID_RE.test(batchId)) return NextResponse.json({ error: "Bad batch id" }, { status: 400 });

  const db = getServiceSupabase();
  const targets = await resolveBatchSyncTargets(db, batchId);
  if (!targets) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  if (targets.userIds.length === 0) {
    return NextResponse.json({ ok: true, done: true, candidates: 0, processed: 0, remaining: 0, uploaded: 0, unchanged: 0, errors: [] });
  }

  const drive = getDriveOrNull();
  if (!drive) {
    return NextResponse.json({
      ok: true, done: true, candidates: targets.userIds.length, processed: 0, remaining: targets.userIds.length,
      uploaded: 0, unchanged: 0, errors: [],
      hint: "Google Workspace/Drive isn't connected — check the Drive scope (the same one Gmail uses).",
    });
  }

  // Shared "<Agency> X Borivon / <Batch>" folder — created ONCE per call.
  const batchFolderId = await ensureBatchFolder(drive, targets.agencyRootName, targets.batchName);

  let uploaded = 0;
  let unchanged = 0;
  let archived = 0; // copies RETRACTED into Archiv (no longer current in the portal)
  let processed = 0;
  const errors: { userId: string; error: string }[] = [];
  const startedAt = Date.now();
  // Sequential (Drive is rate-limited); stop at the budget and report remaining
  // so the client loops. Already-mirrored candidates cost ~nothing next pass.
  for (const uid of targets.userIds) {
    if (processed > 0 && Date.now() - startedAt > TIME_BUDGET_MS) break;
    const r = await mirrorCandidateApprovedDocs(db, drive, uid, batchFolderId);
    if (r.ok) { uploaded += r.uploaded; unchanged += r.unchanged; archived += r.archived; }
    else errors.push({ userId: uid, error: `${r.error}${r.hint ? `: ${r.hint}` : ""}` });
    processed++;
  }

  const done = processed >= targets.userIds.length;
  return NextResponse.json({
    ok: true, done,
    candidates: targets.userIds.length,
    processed,
    remaining: targets.userIds.length - processed,
    uploaded, unchanged, archived, errors,
    // Show the FULL path (it now lives inside the founder's WORK drive) and a
    // direct link to the exact folder that was written, so "did it land in the
    // right place?" is one click to confirm instead of a hunt through Drive.
    folder: `WORK / ${targets.agencyRootName} / ${targets.batchName}`,
    folderUrl: `https://drive.google.com/drive/folders/${batchFolderId}`,
  });
}
