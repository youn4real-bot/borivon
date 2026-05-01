import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

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
    .upsert({ user_id: auth.userId, cv_draft: body }, { onConflict: "user_id" });

  if (error) {
    console.error("[cv-draft PUT] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
