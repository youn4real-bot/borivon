/**
 * Regenerate + publish a candidate's official CV on demand (admin only).
 *
 *   POST { candidateUserId, branding?: "agency" | "borivon" | "none" }
 *
 * Renders the candidate's stored cv_draft to a fresh PDF, stores it in R2, and
 * writes an approved `cv_de` documents row (LAW #15 — admin-generated is green
 * immediately). `branding:"agency"` forces the assigned agency's logo + address
 * regardless of the branding picker, so the Assign-tab button gives a
 * deterministic agency CV. publishCandidateCv also retires the candidate's prior
 * CVs so nothing stale is left behind (dashboard, agency-Drive mirror).
 *
 * Gated by requireAdminRole + canActOnCandidate (LAW #25). This is the same
 * publish the AI bot performs — just reachable from the admin UI now.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import { publishCandidateCv, type CvBrandingMode } from "@/lib/cvRender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODES: readonly CvBrandingMode[] = ["agency", "borivon", "none"];

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId.trim() : "";
  if (!UUID_RE.test(candidateUserId)) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });

  // Validate BEFORE the scope check so a bad body can't probe auth timing.
  const branding: CvBrandingMode | undefined =
    typeof body?.branding === "string" && (MODES as readonly string[]).includes(body.branding)
      ? (body.branding as CvBrandingMode)
      : undefined;

  if (!(await canActOnCandidate(auth.role, auth.email, candidateUserId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await publishCandidateCv(candidateUserId, { branding });
  if (!result.ok) {
    // no_cv_data → the candidate has no CV draft yet; surface it as a 422 so the
    // UI can say "build the CV first" instead of a generic failure.
    const status = result.error === "no_cv_data" ? 422 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
