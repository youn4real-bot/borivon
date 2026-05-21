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

  // STEP 1 — primary save. Single-column upsert; this MUST succeed.
  const { error } = await db
    .from("candidate_profiles")
    .upsert({ user_id: auth.userId, cv_draft: body }, { onConflict: "user_id" });

  if (error) {
    console.error("[cv-draft PUT] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  // STEP 2 — best-effort reverse-propagation cv_draft.* → passport
  // columns when those columns are currently null/empty. Wrapped in
  // try/catch + separate UPDATE so it can never cause the primary save
  // to fail.
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
        .eq("user_id", auth.userId)
        .maybeSingle();
      const cur = (existing ?? {}) as Record<string, string | null | undefined>;
      const updates: Record<string, string> = {};
      for (const [col, val] of Object.entries(candidateFields)) {
        if (cur[col] == null || cur[col] === "") updates[col] = val;
      }
      if (Object.keys(updates).length > 0) {
        await db.from("candidate_profiles").update(updates).eq("user_id", auth.userId);
      }
    }
  } catch (e) {
    console.error("[cv-draft PUT] reverse-propagate (non-fatal):", e);
  }

  return NextResponse.json({ success: true });
}
