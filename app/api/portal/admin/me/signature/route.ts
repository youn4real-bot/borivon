import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const MAX_SIG_BYTES = 200_000;

/** GET — returns the admin's saved signature (base64 PNG data URI or null). */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const { data } = await db
    .from("admin_signatures")
    .select("signature")
    .eq("admin_email", auth.email)
    .maybeSingle();

  return NextResponse.json({
    signature: (data as { signature?: string | null } | null)?.signature ?? null,
  });
}

/** PUT — saves (upserts) the admin's signature for future reuse. */
export async function PUT(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = await req.text();
  if (raw.length > MAX_SIG_BYTES * 1.5) {
    return NextResponse.json({ error: "Signature too large" }, { status: 413 });
  }

  let body: { signature?: string | null };
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.signature || typeof body.signature !== "string") {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db
    .from("admin_signatures")
    .upsert(
      { admin_email: auth.email, signature: body.signature, updated_at: new Date().toISOString() },
      { onConflict: "admin_email" },
    );

  if (error) return NextResponse.json({ error: "DB error" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
