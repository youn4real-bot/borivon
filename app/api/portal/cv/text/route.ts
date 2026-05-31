/**
 * CV → plain text, on demand. Returns the candidate's cv_draft serialized as
 * readable text (the same content the CV PDF renders from). Powers the visa
 * Motivationsschreiben "Copy prompt" button so the prompt + CV go in ONE copy,
 * no PDF download. Source is cv_draft → works in ANY document state
 * (draft / pending / approved).
 *
 *   GET                      → the caller's own CV text
 *   GET ?candidateId=<uuid>  → admin/sub-admin reads it for that candidate (LAW #25)
 *
 * Self-only unless an admin allowed to act on the candidate.
 */
import { NextRequest } from "next/server";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rateLimit";
import { cvDraftToText } from "@/lib/cvText";
import { sanitizeCvData } from "@/lib/cvSanitize";
import type { CVData } from "@/components/CVDocument";
import { UUID_RE } from "@/lib/uuid";


export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const rl = enforceRateLimit(req, "cv-text", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return Response.json({ error: "Too many requests" }, { status: 429 });

  // Resolve target: self, or a candidate an admin is allowed to act on.
  const qCand = req.nextUrl.searchParams.get("candidateId");
  let targetUserId = auth.userId;
  if (qCand && UUID_RE.test(qCand) && qCand !== auth.userId) {
    const adm = await requireAdminRole(req);
    if (!adm.ok || !(await canActOnCandidate(adm.role, adm.email, qCand))) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    targetUserId = qCand;
  }

  const db = getServiceSupabase();
  const { data: prof } = await db
    .from("candidate_profiles").select("cv_draft").eq("user_id", targetUserId).maybeSingle();
  const draft = (prof as { cv_draft?: unknown } | null)?.cv_draft;
  if (!draft) return Response.json({ text: "" });

  let cv: CVData;
  try {
    cv = (typeof draft === "string" ? JSON.parse(draft) : draft) as CVData;
  } catch {
    return Response.json({ text: "" });
  }
  // Cap array dimensions before serialization (same DoS guard as the renderers).
  return Response.json({ text: cvDraftToText(sanitizeCvData(cv)) });
}
