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
    .eq("user_id", candidateId)
    .maybeSingle();
  const cur = (existing ?? {}) as Record<string, string | null | undefined>;
  const toWrite: Record<string, unknown> = { user_id: candidateId, cv_draft: body };
  for (const [k, v] of Object.entries(draftToPassport)) {
    if (v && (cur[k] == null || cur[k] === "")) toWrite[k] = v;
  }

  const { error } = await db
    .from("candidate_profiles")
    .upsert(toWrite, { onConflict: "user_id" });

  if (error) {
    console.error("[admin cv-draft PUT] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
