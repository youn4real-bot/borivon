import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { resolveAssistantScope } from "@/lib/assistantScope";
import { assembleSearchableCandidates } from "@/lib/candidateSearchData";

/**
 * BATCH TRACKER (doc-focused) — GET /api/portal/admin/batches-track
 *
 * The founder's active Germany-track candidates live in batches; tracking THEIR
 * documents is the point. Returns each batch (that has visible candidates) with its
 * members' document status. Scoped (LAW #25) via assembleSearchableCandidates.
 * Least-complete first, so the ones needing documents surface at the top.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const scope = await resolveAssistantScope(auth);
    const candidates = await assembleSearchableCandidates(scope);

    const inBatch = candidates.filter((c) => c.batchId && c.batchName);
    const batchMap = new Map<string, { id: string; name: string; count: number }>();
    const members = inBatch.map((c) => {
      const b = batchMap.get(c.batchId!);
      if (b) b.count++;
      else batchMap.set(c.batchId!, { id: c.batchId!, name: c.batchName!, count: 1 });
      return {
        uid: c.uid,
        name: c.name,
        batchId: c.batchId!,
        missing: c.missingRequired,
        pending: c.pendingDocCount,
        rejected: c.rejectedDocs,
        pct: c.checklistPct,
      };
    });
    // Least-complete first within each batch (needs documents → top).
    members.sort((a, b) => a.pct - b.pct || (b.missing + b.rejected) - (a.missing + a.rejected) || a.name.localeCompare(b.name));
    const batches = [...batchMap.values()].sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ ok: true, batches, members });
  } catch (e) {
    console.error("[batches-track] failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true, batches: [], members: [] });
  }
}
