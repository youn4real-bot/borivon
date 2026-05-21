import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { backfillPassportFromCvDraft } from "@/lib/cvDraftBackfill";
import { enforceRateLimit } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_profiles")
    .select("cv_draft, profile_photo")
    .eq("user_id", auth.userId)
    .maybeSingle();

  return NextResponse.json({
    draft: (data as { cv_draft?: unknown } | null)?.cv_draft ?? null,
    photo: (data as { profile_photo?: string | null } | null)?.profile_photo ?? null,
  });
}

// 500 KB is generous for a text-only CV draft (photo is stripped client-side
// before saving). Hard cap prevents a crafted request from bloating the DB.
const MAX_DRAFT_BYTES = 500_000;

export async function PUT(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // CV draft autosaves on every change. 60/min covers active editing
  // (the client already debounces) without leaving an abuse surface.
  // The backfill side-effect makes each save more than just a JSON write,
  // so capping the rate keeps the candidate_profiles update path cheap.
  const rl = enforceRateLimit(req, "cv-draft", { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many saves — slow down" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
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

  // STEP 1 — primary save. Single-column upsert; this MUST succeed.
  const { error } = await db
    .from("candidate_profiles")
    .upsert({ user_id: auth.userId, cv_draft: body }, { onConflict: "user_id" });

  if (error) {
    console.error("[cv-draft PUT] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // STEP 2 — best-effort reverse-propagation cv_draft.* → passport
  // columns when those columns are currently null/empty. Shared with
  // /api/portal/admin/cv-draft (see lib/cvDraftBackfill.ts).
  try {
    const err = await backfillPassportFromCvDraft(db, auth.userId, body);
    if (err) console.error("[cv-draft PUT] reverse-propagate (non-fatal):", err);
  } catch (e) {
    console.error("[cv-draft PUT] reverse-propagate (non-fatal):", e);
  }

  return NextResponse.json({ success: true });
}
