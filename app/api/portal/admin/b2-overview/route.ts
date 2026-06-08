import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getVisibleCandidateIds, getStaffUserIdsAmong } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { normalizeB2Stage, effectiveB2Stage, isB2CertDoc, type B2Stage } from "@/lib/b2Journey";
import { germanSummary } from "@/lib/b2Detail";

/**
 * Rich B2 overview for the admin B2-status page — pulls the REAL German-exam
 * detail out of each candidate's CV builder (cv_draft), not just the coarse
 * pipeline stage. Admin-gated; non-supreme admins scoped to their candidates
 * (LAW #25). Returns small per-candidate summaries (the heavy cv_draft JSON is
 * parsed server-side; only the resulting string crosses the wire).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const visible = auth.role === "admin" ? null : await getVisibleCandidateIds(auth.email);

  let q = db.from("candidate_profiles").select("user_id, first_name, last_name, b2_stage, b2_failed, b2_exam_date, cv_draft");
  if (visible !== null) {
    if (visible.length === 0) return NextResponse.json({ candidates: [] });
    q = q.in("user_id", visible);
  }
  const { data: profs, error } = await q;
  if (error) { console.error("[b2-overview] profiles error:", error.message); return NextResponse.json({ error: "load_failed" }, { status: 500 }); }

  const all = (profs ?? []) as { user_id: string; first_name: string | null; last_name: string | null; b2_stage: string | null; b2_failed: boolean | null; b2_exam_date: string | null; cv_draft: unknown }[];
  // Strip staff (they can have a profile row but aren't candidates).
  const staff = await getStaffUserIdsAmong(all.map((p) => p.user_id));
  const rows = all.filter((p) => !staff.has(p.user_id));
  if (rows.length === 0) return NextResponse.json({ candidates: [] });

  const ids = rows.map((p) => p.user_id);
  const { data: docs } = await db.from("documents").select("user_id, file_type, status").in("user_id", ids);
  const docsByUser = new Map<string, { file_type: string | null; status: string | null }[]>();
  for (const d of (docs ?? []) as { user_id: string; file_type: string | null; status: string | null }[]) {
    const arr = docsByUser.get(d.user_id) ?? [];
    arr.push({ file_type: d.file_type, status: d.status });
    docsByUser.set(d.user_id, arr);
  }

  const candidates = rows.map((p) => {
    const d = docsByUser.get(p.user_id) ?? [];
    const stage: B2Stage = effectiveB2Stage(normalizeB2Stage(p.b2_stage), d);
    const certApproved = d.some((x) => x.status === "approved" && isB2CertDoc(x.file_type));
    const certPending = !certApproved && d.some((x) => isB2CertDoc(x.file_type));
    const g = germanSummary(p.cv_draft);
    return {
      userId: p.user_id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "—",
      stage,
      failed: p.b2_failed === true,
      examDate: p.b2_exam_date ?? null,
      cert: certApproved ? "approved" : certPending ? "pending" : "none",
      germanLevel: g.level,
      german: g.summary,
    };
  });

  return NextResponse.json({ candidates });
}
