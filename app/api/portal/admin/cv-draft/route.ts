import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const MAX_DRAFT_BYTES = 500_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // STEP 2 — best-effort reverse-propagation: cv_draft.* → passport
  // columns when those columns are currently null/empty. Fully wrapped
  // in try/catch and a separate update call so a propagation failure
  // can NEVER cause the primary save to fail. The CV builder shows
  // "Gespeichert" the moment STEP 1 succeeds; STEP 2 is a backfill
  // for downstream consumers (cover letter sender block, admin
  // passport-info card, …) and is allowed to silently no-op.
  try {
    const incoming = body as Record<string, unknown>;
    const candidateFields: Record<string, string> = {};
    const map: [string, string][] = [
      ["first_name",           "firstName"],
      ["last_name",            "lastName"],
      ["address_street",       "address"],
      ["address_number",       "addressNumber"],
      ["address_postal",       "postalCode"],
      ["city_of_residence",    "city"],
      ["country_of_residence", "countryOfResidence"],
      ["phone",                "phone"],
    ];
    for (const [col, draftKey] of map) {
      const v = incoming[draftKey];
      if (typeof v === "string" && v.trim() !== "") candidateFields[col] = v.trim();
    }
    if (Object.keys(candidateFields).length > 0) {
      const { data: existing } = await db
        .from("candidate_profiles")
        .select("first_name,last_name,address_street,address_number,address_postal,city_of_residence,country_of_residence,phone")
        .eq("user_id", candidateId)
        .maybeSingle();
      const cur = (existing ?? {}) as Record<string, string | null | undefined>;
      const updates: Record<string, string> = {};
      for (const [col, val] of Object.entries(candidateFields)) {
        if (cur[col] == null || cur[col] === "") updates[col] = val;
      }
      if (Object.keys(updates).length > 0) {
        await db.from("candidate_profiles").update(updates).eq("user_id", candidateId);
      }
    }
  } catch (e) {
    console.error("[admin cv-draft PUT] reverse-propagate (non-fatal):", e);
  }

  return NextResponse.json({ success: true });
}
