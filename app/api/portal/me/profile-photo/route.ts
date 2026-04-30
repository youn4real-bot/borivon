import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

// Max base64 length — ~250 KB raw image (which is plenty for a 400px avatar)
const MAX_PHOTO_CHARS = 350_000;

/**
 * GET — return the caller's profile photo (base64 data URL) if any.
 *   { photo: string | null }
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_profiles")
    .select("profile_photo")
    .eq("user_id", auth.userId)
    .maybeSingle();
  const photo = (data as { profile_photo?: string | null } | null)?.profile_photo ?? null;
  return NextResponse.json({ photo });
}

/**
 * POST — save the caller's profile photo.
 * Body: { photo: string | null }   // base64 data URL or null to clear
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const photo = body?.photo;
  if (photo === null || photo === undefined || photo === "") {
    // Clear
    const db = getServiceSupabase();
    await db.from("candidate_profiles").upsert(
      { user_id: auth.userId, profile_photo: null },
      { onConflict: "user_id" },
    );
    return NextResponse.json({ success: true, photo: null });
  }

  if (typeof photo !== "string") return NextResponse.json({ error: "Invalid photo" }, { status: 400 });
  if (!photo.startsWith("data:image/")) return NextResponse.json({ error: "Must be a data URL" }, { status: 400 });
  if (photo.length > MAX_PHOTO_CHARS) {
    return NextResponse.json({ error: "Photo too large (max ~250 KB)" }, { status: 413 });
  }

  const db = getServiceSupabase();
  const { error } = await db.from("candidate_profiles").upsert(
    { user_id: auth.userId, profile_photo: photo },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("[profile-photo POST] upsert failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
