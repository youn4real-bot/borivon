import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { validateImageDataUrl } from "@/lib/validateDataUrl";

const MAX_SIG_BYTES = 200_000; // ~150 KB is plenty for a signature PNG

/** GET  — returns the candidate's saved signature (base64 PNG data URI or null) */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data } = await db
    .from("candidate_profiles")
    .select("saved_signature")
    .eq("user_id", auth.userId)
    .maybeSingle();

  return NextResponse.json({
    signature: (data as { saved_signature?: string | null } | null)?.saved_signature ?? null,
  });
}

/** PUT  — saves the candidate's signature for future reuse */
export async function PUT(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = await req.text();
  if (raw.length > MAX_SIG_BYTES * 1.5) {
    return NextResponse.json({ error: "Signature too large" }, { status: 413 });
  }

  let body: { signature?: string | null };
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Audit fix: validate the signature is a real PNG/JPEG/WebP image
  // (magic-byte check, rejects SVG / MIME spoofing) before persisting —
  // same hardening as profile-photo/feed. Clearing (null/"") is allowed.
  const sig = body.signature;
  if (sig != null && sig !== "") {
    const v = validateImageDataUrl(sig);
    if (!v.ok) {
      return NextResponse.json({ error: "Must be a PNG/JPEG/WebP image" }, { status: 400 });
    }
  }

  const db = getServiceSupabase();
  const { error } = await db
    .from("candidate_profiles")
    .upsert(
      { user_id: auth.userId, saved_signature: sig || null },
      { onConflict: "user_id" },
    );

  if (error) return NextResponse.json({ error: "DB error" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
