import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const MAX_DRAFT_BYTES = 500_000;

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });

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
  if (!candidateId) return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });

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
  const { error } = await db
    .from("candidate_profiles")
    .upsert({ user_id: candidateId, cv_draft: body }, { onConflict: "user_id" });

  if (error) {
    console.error("[admin cv-draft PUT] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
