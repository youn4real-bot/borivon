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
  // Reverse-propagate cv_draft → passport columns when they're empty, so
  // the cover letter (and every other downstream that reads passport
  // columns) is populated for ANY candidate who has touched the CV
  // builder. Coalesce: never overwrite an existing non-empty value.
  const incoming = body as Record<string, unknown>;
  const draftToPassport: Record<string, string | null> = {
    first_name:           typeof incoming.firstName          === "string" ? incoming.firstName.trim()          : "",
    last_name:            typeof incoming.lastName           === "string" ? incoming.lastName.trim()           : "",
    address_street:       typeof incoming.address            === "string" ? incoming.address.trim()            : "",
    address_number:       typeof incoming.addressNumber      === "string" ? incoming.addressNumber.trim()      : "",
    address_postal:       typeof incoming.postalCode         === "string" ? incoming.postalCode.trim()         : "",
    city_of_residence:    typeof incoming.city               === "string" ? incoming.city.trim()               : "",
    country_of_residence: typeof incoming.countryOfResidence === "string" ? incoming.countryOfResidence.trim() : "",
    phone:                typeof incoming.phone              === "string" ? incoming.phone.trim()              : "",
  };

  const { data: existing } = await db
    .from("candidate_profiles")
    .select("first_name,last_name,address_street,address_number,address_postal,city_of_residence,country_of_residence,phone")
    .eq("user_id", auth.userId)
    .maybeSingle();
  const cur = (existing ?? {}) as Record<string, string | null | undefined>;
  const toWrite: Record<string, unknown> = { user_id: auth.userId, cv_draft: body };
  for (const [k, v] of Object.entries(draftToPassport)) {
    if (v && (cur[k] == null || cur[k] === "")) toWrite[k] = v;
  }

  const { error } = await db
    .from("candidate_profiles")
    .upsert(toWrite, { onConflict: "user_id" });

  if (error) {
    console.error("[cv-draft PUT] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
