import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

const BUCKET = "profile-photos";

/**
 * Ensure the profile-photos bucket exists.
 * Called lazily on first upload; safe to call every time (idempotent).
 */
async function ensureBucket() {
  const db = getServiceSupabase();
  const { error } = await db.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024, // 2 MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  });
  // Ignore "already exists" error — that's the expected happy path.
  if (error && !error.message?.toLowerCase().includes("already exist") && !error.message?.toLowerCase().includes("duplicate")) {
    console.warn("[profile-photo] bucket create warning:", error.message);
  }
}

/**
 * GET — return the caller's profile photo URL (or null).
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
 * POST — save or clear the caller's profile photo.
 *
 * Body:
 *   { photo: string }  — base64 data URL  → uploads to Supabase Storage,
 *                         stores public URL in candidate_profiles.profile_photo,
 *                         returns { success: true, photo: <publicUrl> }
 *   { photo: null }    — clears the stored photo (also deletes from Storage).
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const photo = body?.photo;

  const db = getServiceSupabase();

  // ── Clear photo ──────────────────────────────────────────────────────────────
  if (photo === null || photo === undefined || photo === "") {
    // Best-effort delete from Storage (ignore error — file may not exist)
    await db.storage.from(BUCKET).remove([`${auth.userId}.jpg`, `${auth.userId}.png`, `${auth.userId}.webp`]);

    await db.from("candidate_profiles").upsert(
      { user_id: auth.userId, profile_photo: null },
      { onConflict: "user_id" },
    );
    return NextResponse.json({ success: true, photo: null });
  }

  // ── Upload new photo ─────────────────────────────────────────────────────────
  if (typeof photo !== "string") return NextResponse.json({ error: "Invalid photo" }, { status: 400 });
  if (!photo.startsWith("data:image/")) return NextResponse.json({ error: "Must be a data URL" }, { status: 400 });

  // Parse mime type and base64 payload
  const commaIdx = photo.indexOf(",");
  if (commaIdx === -1) return NextResponse.json({ error: "Malformed data URL" }, { status: 400 });

  const header  = photo.slice(0, commaIdx);                        // "data:image/jpeg;base64"
  const b64Data = photo.slice(commaIdx + 1);                       // raw base64 string

  const mimeMatch = header.match(/data:([^;]+);/);
  const mimeType  = mimeMatch?.[1] ?? "image/jpeg";
  const ext       = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";

  // Rough size guard — ~3 MB base64 → ~2.25 MB binary
  if (b64Data.length > 4_000_000) {
    return NextResponse.json({ error: "Photo too large (max ~3 MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(b64Data, "base64");

  // Create bucket if it doesn't exist yet (fast no-op after first call)
  await ensureBucket();

  const fileName = `${auth.userId}.${ext}`;
  const { error: uploadErr } = await db.storage
    .from(BUCKET)
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: true,            // overwrite any existing photo for this user
      cacheControl: "3600",
    });

  if (uploadErr) {
    console.error("[profile-photo POST] storage upload failed:", uploadErr.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  // Retrieve the permanent public URL
  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(fileName);

  // Bust CDN cache by appending a timestamp param (public URL is otherwise static)
  const photoUrl = `${publicUrl}?t=${Date.now()}`;

  // Persist the URL (not the raw base64) in the DB
  const { error: dbErr } = await db.from("candidate_profiles").upsert(
    { user_id: auth.userId, profile_photo: photoUrl },
    { onConflict: "user_id" },
  );
  if (dbErr) {
    console.error("[profile-photo POST] upsert failed:", dbErr.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ success: true, photo: photoUrl });
}
