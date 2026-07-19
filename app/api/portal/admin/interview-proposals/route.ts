/**
 * Interview self-scheduler — admin side.
 *
 *   POST → propose { candidateUserId, round(1|2), slots: string[], note? }
 *          creates a proposal + a candidate bell notification (deep-links to the
 *          dashboard picker). Gated by requireAdminRole + canActOnCandidate.
 *   GET  → ?candidate=<uuid> list this candidate's proposals (admin view of state).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/; // local wall-clock, no timezone

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const candidate = req.nextUrl.searchParams.get("candidate") ?? "";
  if (!UUID_RE.test(candidate)) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });
  if (!(await canActOnCandidate(auth.role, auth.email, candidate))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data } = await getServiceSupabase()
    .from("interview_proposals")
    .select("id, round, proposed_slots, picked_slot, status, note, created_at")
    .eq("candidate_user_id", candidate)
    .order("created_at", { ascending: false });
  type Row = { id: string; round: number; proposed_slots: string[]; picked_slot: string | null; status: string; note: string | null; created_at: string };
  return NextResponse.json({
    proposals: ((data ?? []) as Row[]).map((r) => ({
      id: r.id, round: r.round, slots: r.proposed_slots ?? [], pickedSlot: r.picked_slot, status: r.status, note: r.note ?? "", createdAt: r.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));

  const candidateUserId = typeof body?.candidateUserId === "string" ? body.candidateUserId : "";
  if (!UUID_RE.test(candidateUserId)) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });
  if (!(await canActOnCandidate(auth.role, auth.email, candidateUserId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const round = body?.round === 2 ? 2 : 1;
  const rawSlots = Array.isArray(body?.slots) ? body.slots : [];
  const slots = [...new Set(rawSlots.filter((s: unknown): s is string => typeof s === "string" && SLOT_RE.test(s)))].slice(0, 6);
  if (slots.length === 0) return NextResponse.json({ error: "Give at least one valid time slot" }, { status: 400 });
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("interview_proposals")
    .insert({ candidate_user_id: candidateUserId, round, proposed_slots: slots, status: "proposed", note, created_by: auth.email })
    .select("id")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "create_failed" }, { status: 500 });
  const proposalId = (data as { id: string }).id;

  // Candidate bell → deep-links to the dashboard picker. Reuses action
  // 'sign_request' (already whitelisted) with a distinct doc_type so no
  // notifications_action migration is needed; the bell routes by doc_type.
  const label = round === 2 ? "Interview 2 — Termin wählen" : "Interview 1 — Termin wählen";
  await db.from("notifications").insert({
    user_id: candidateUserId,
    doc_id: proposalId,
    doc_name: label,
    doc_type: "interview_proposal",
    action: "sign_request",
    feedback: null,
    read: false,
  });

  return NextResponse.json({ id: proposalId });
}
