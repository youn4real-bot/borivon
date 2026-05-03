import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const BUCKET = "profile-photos";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin-side profile photo management.
 *
 * Same shape as `/api/portal/me/profile-photo` but acts on a SPECIFIC
 * candidate identified by `?candidateId=<uuid>` query param. Used when
 * the supreme admin (or sub-admin) opens the CV builder in admin mode
 * and uploads / deletes a profile picture for the candidate they're
 * editing — without this the upload would land on the admin's own
 * profile (the bug we just fixed).
 *
 * Auth:
 *   - Supreme admin: any candidate
 *   - Sub-admin:     only candidates they have direct or org-based access to
 */

async function ensureBucket() {
  const db = getServiceSupabase();
  const { error } = await db.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  });
  if (error && !error.message?.toLowerCase().includes("already exist") && !error.message?.toLowerCase().includes("duplicate")) {
    console.warn("[admin profile-photo] bucket create warning:", error.message);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const candidateId = (req.nextUrl.searchParams.get("candidateId") ?? "").trim();
  if (!UUID_RE.test(candidateId)) {
    return NextResponse.json({ error: "Invalid candidateId" }, { status: 400 });
  }

  // Sub-admins must have access to this candidate.
  if (!(await canActOnCandidate(auth.role, auth.email, candidateId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const photo = body?.photo;
  const db = getServiceSupabase();

  // ── Clear photo ──────────────────────────────────────────────────────────────
  if (photo === null || photo === undefined || photo === "") {
    await db.storage
      .from(BUCKET)
      .remove([`${candidateId}.jpg`, `${candidateId}.png`, `${candidateId}.webp`]);

    await db.from("candidate_profiles").upsert(
      { user_id: candidateId, profile_photo: null },
      { onConflict: "user_id" },
    );
    return NextResponse.json({ success: true, photo: null });
  }

  // ── Upload new photo ─────────────────────────────────────────────────────────
  if (typeof photo !== "string") return NextResponse.json({ error: "Invalid photo" }, { status: 400 });
  if (!photo.startsWith("data:image/")) return NextResponse.json({ error: "Must be a data URL" }, { status: 400 });

  const commaIdx = photo.indexOf(",");
  if (commaIdx === -1) return NextResponse.json({ error: "Malformed data URL" }, { status: 400 });

  const header  = photo.slice(0, commaIdx);
  const b64Data = photo.slice(commaIdx + 1);

  const mimeMatch = header.match(/data:([^;]+);/);
  const mimeType  = mimeMatch?.[1] ?? "image/jpeg";
  const ext       = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";

  if (b64Data.length > 4_000_000) {
    return NextResponse.json({ error: "Photo too large (max ~3 MB)" }, { status: 413 });
  }

  const buffer = Buffer.from(b64Data, "base64");
  await ensureBucket();

  const fileName = `${candidateId}.${ext}`;
  const { error: uploadErr } = await db.storage
    .from(BUCKET)
    .upload(fileName, buffer, {
      contentType: mimeType,
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadErr) {
    console.error("[admin profile-photo POST] storage upload failed:", uploadErr.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(fileName);
  // Bust CDN cache by appending a timestamp param.
  const photoUrl = `${publicUrl}?t=${Date.now()}`;

  const { error: dbErr } = await db.from("candidate_profiles").upsert(
    { user_id: candidateId, profile_photo: photoUrl },
    { onConflict: "user_id" },
  );
  if (dbErr) {
    console.error("[admin profile-photo POST] upsert failed:", dbErr.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ success: true, photo: photoUrl });
}
