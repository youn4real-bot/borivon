/**
 * Admin's agency profile — one row per admin user, holds employer / agency
 * contact block. Used by AutoFillReviewModal to fill section C of forms.
 *
 * GET   → { profile: AgencyProfile | null }
 * PATCH → upserts the row for the calling admin.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";

const FIELDS = [
  "firma", "strasse", "hausnummer", "plz", "ort",
  "kontaktperson", "telefon", "email", "telefax", "betriebsnummer",
] as const;

async function callerUserId(req: NextRequest): Promise<string | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const { data } = await getAnonVerifyClient().auth.getUser(m[1].trim());
  return data?.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const uid = await callerUserId(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getServiceSupabase();
  const { data } = await db
    .from("agency_profiles")
    .select(FIELDS.join(","))
    .eq("user_id", uid)
    .maybeSingle();
  return NextResponse.json({ profile: data ?? null });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const uid = await callerUserId(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const update: Record<string, string | null> = { user_id: uid as unknown as string };
  for (const k of FIELDS) {
    if (k in body) {
      const v = body[k];
      update[k] = typeof v === "string" ? v.trim() : v == null ? null : String(v);
    }
  }
  update.updated_at = new Date().toISOString();
  const db = getServiceSupabase();
  const { error } = await db.from("agency_profiles").upsert(update, { onConflict: "user_id" });
  if (error) {
    console.error("[agency-profile PATCH]", error);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
