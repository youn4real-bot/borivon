/**
 * The three document phases of ONE nurse (papers → Anerkennung → Visum), for her roadmap at the top of
 * the portal (founder 2026-11-11: "a roadmap of where she is, step by step; papers hidden but reachable").
 * Same rules as the admin list (app/api/portal/admin/route.ts journeyByUser) and the candidate's own
 * slot list (app/api/portal/phase-slots/route.ts): latest version per file key, archived rows out
 * (LAW #33), global + batch (her employer's agency, else her own org) + site slots, the batch org's
 * required-docs override. Any read failure → null (the roadmap then leaves those stations out rather
 * than drawing a wrong number).
 */
import { getServiceSupabase } from "@/lib/supabase";
import { computeJourneyProgress, type JourneySlot } from "@/lib/journeyProgress";
import { LABEL_TO_FILE_KEY } from "@/lib/fileKeys";
import { effectiveB2Stage, normalizeB2Stage, type B2Stage } from "@/lib/b2Journey";

export type DocPhases = { papers: [number, number]; bearbeitung: [number, number]; visum: [number, number]; pending: number; b2: { stage: B2Stage; failed: boolean }; photo: string | null };

type SlotRow = { id: string; type: string | null; phase: string; org_id: string | null; employer_id: string | null; is_required: boolean | null };

export async function docPhasesFor(userId: string): Promise<DocPhases | null> {
  try {
    const db = getServiceSupabase();
    const [docRes, profRes, memRes, slotRes] = await Promise.all([
      db.from("documents").select("*").eq("user_id", userId).order("uploaded_at", { ascending: false }),
      db.from("candidate_profiles").select("*").eq("user_id", userId).maybeSingle(),
      db.from("candidate_organizations").select("org_id, added_by").eq("candidate_user_id", userId).eq("status", "approved"),
      db.from("phase_slots").select("id, type, phase, org_id, employer_id, is_required"),
    ]);
    if (docRes.error || profRes.error || slotRes.error) return null;
    const seen = new Set<string>();
    const docs: { file_type: string | null; status: string | null }[] = [];
    for (const d of (docRes.data ?? []) as { file_type: string; status: string | null; superseded_at?: string | null }[]) {
      if (d.superseded_at) continue;
      const fk = LABEL_TO_FILE_KEY[d.file_type] ?? d.file_type;
      if (fk !== "other") { if (seen.has(fk)) continue; seen.add(fk); }
      docs.push({ file_type: d.file_type, status: d.status });
    }
    const empId = (profRes.data as { employer_id: string | null } | null)?.employer_id ?? null;
    const selfOrg = ((memRes.data ?? []) as { org_id: string; added_by: string | null }[]).find((m) => m.added_by !== "admin")?.org_id ?? null;
    let batchOrg: string | null = selfOrg;
    if (empId) {
      const { data: emp, error } = await db.from("employers").select("agency_id").eq("id", empId).maybeSingle();
      if (error) return null;
      const agency = (emp as { agency_id: string | null } | null)?.agency_id ?? null;
      if (agency) batchOrg = agency;
    }
    let requiredKeys: string[] | null = null;
    if (batchOrg) {
      const { data: org } = await db.from("organizations").select("required_doc_keys").eq("id", batchOrg).maybeSingle();
      requiredKeys = (org as { required_doc_keys: string[] | null } | null)?.required_doc_keys ?? null;
    }
    const all = (slotRes.data ?? []) as SlotRow[];
    const applicable = (phase: string): JourneySlot[] => [
      ...all.filter((s) => s.phase === phase && !s.org_id && !s.employer_id),
      ...(batchOrg ? all.filter((s) => s.phase === phase && s.org_id === batchOrg) : []),
      ...(empId ? all.filter((s) => s.phase === phase && s.employer_id === empId) : []),
    ].map((s) => ({ id: s.id, type: s.type, is_required: s.is_required }));
    const j = computeJourneyProgress({ docs, requiredKeys, bearbeitungSlots: applicable("bearbeitung"), visumSlots: applicable("visum") });
    const p = (k: string): [number, number] => { const x = j.phases.find((ph) => ph.key === k); return x ? [x.done, x.total] : [0, 0]; };
    const prof = (profRes.data ?? {}) as { b2_stage?: string | null; b2_failed?: boolean | null; profile_photo?: string | null };
    return {
      papers: p("papers"), bearbeitung: p("bearbeitung"), visum: p("visum"),
      pending: docs.filter((d) => d.status === "pending").length,
      b2: { stage: effectiveB2Stage(normalizeB2Stage(prof.b2_stage), docs), failed: !!prof.b2_failed },
      photo: typeof prof.profile_photo === "string" && prof.profile_photo ? prof.profile_photo : null,
    };
  } catch {
    return null;
  }
}
