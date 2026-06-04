import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import { cleanPublicText } from "@/lib/sanitizeInput";
import { isNurseSpecialty } from "@/lib/nurseSpecialties";

/**
 * Set a candidate's nurse profile facts (specialty / experience / workplace /
 * availability) — the structured data hospitals care about and the pipeline
 * filters on. Managing parties only (LAW #25). Each field optional; only the
 * provided ones are written. Pass null/"" to clear a field.
 *
 * POST { candidateId, specialty?, yearsExperience?, workplace?, availableFrom? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  if (!UUID_RE.test(candidateId)) return NextResponse.json({ error: "candidateId required" }, { status: 400 });

  const allowed = await canActOnCandidate(auth.role, auth.email, candidateId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patch: Record<string, unknown> = {};

  if ("specialty" in body) {
    const s = body.specialty;
    if (s === null || s === "") patch.nursing_specialty = null;
    else if (isNurseSpecialty(s)) patch.nursing_specialty = s;
    else return NextResponse.json({ error: "invalid specialty" }, { status: 400 });
  }

  if ("yearsExperience" in body) {
    const y = body.yearsExperience;
    if (y === null || y === "") patch.years_experience = null;
    else {
      const n = Math.floor(Number(y));
      if (!Number.isFinite(n) || n < 0 || n > 60) return NextResponse.json({ error: "invalid yearsExperience" }, { status: 400 });
      patch.years_experience = n;
    }
  }

  if ("workplace" in body) {
    const w = cleanPublicText(body.workplace, 120);
    patch.current_workplace = w || null;
  }

  if ("availableFrom" in body) {
    const d = body.availableFrom;
    if (d === null || d === "") patch.available_from = null;
    else if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) patch.available_from = d;
    else return NextResponse.json({ error: "invalid availableFrom" }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").update(patch).eq("user_id", candidateId);
  if (error) {
    console.error("[journey/profile] update error:", error.message);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
