import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { backfillPassportFromCvDraft } from "@/lib/cvDraftBackfill";
import { UUID_RE } from "@/lib/uuid";

const MAX_DRAFT_BYTES = 500_000;

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  // Audit fix: must be a valid UUID before we hit canActOnCandidate / DB.
  if (!candidateId || !UUID_RE.test(candidateId))
    return NextResponse.json({ error: "Invalid candidateId" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, candidateId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_profiles")
    .select("cv_draft, profile_photo")
    .eq("user_id", candidateId)
    .maybeSingle();

  return NextResponse.json({
    draft: (data as { cv_draft?: unknown } | null)?.cv_draft ?? null,
    photo: (data as { profile_photo?: string | null } | null)?.profile_photo ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  // Audit fix: must be a valid UUID before we hit canActOnCandidate / DB.
  if (!candidateId || !UUID_RE.test(candidateId))
    return NextResponse.json({ error: "Invalid candidateId" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, candidateId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = await req.text();
  if (raw.length > MAX_DRAFT_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // STEP 1 — primary save. This MUST succeed; the cv-builder UI surfaces
  // a "Speichern fehlgeschlagen" toast on failure. Keep it as the same
  // single-column upsert it always was, with no extra columns that could
  // break under any data-shape edge case.
  const { error } = await db
    .from("candidate_profiles")
    .upsert({ user_id: candidateId, cv_draft: body }, { onConflict: "user_id" });

  if (error) {
    console.error("[admin cv-draft PUT] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // STEP 2 — best-effort reverse-propagation cv_draft.* → passport
  // columns when those columns are currently null/empty. Shared with
  // /api/portal/me/cv-draft (see lib/cvDraftBackfill.ts).
  try {
    const err = await backfillPassportFromCvDraft(db, candidateId, body);
    if (err) console.error("[admin cv-draft PUT] reverse-propagate (non-fatal):", err);
  } catch (e) {
    console.error("[admin cv-draft PUT] reverse-propagate (non-fatal):", e);
  }

  return NextResponse.json({ success: true });
}
