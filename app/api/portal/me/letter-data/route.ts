import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

/**
 * GET — return the resolved sender block for the cover letter.
 *
 * Service-role read so it bypasses any candidate_profiles RLS column
 * filter that may strip address fields from the candidate's own anon
 * client. Merging order (per user 2026-05):
 *   1) passport-approved columns on candidate_profiles
 *      (address_street / _number / _postal / city_of_residence /
 *       country_of_residence / first_name / last_name / phone)
 *   2) live cv_draft (admin or candidate typed into the CV builder)
 *   3) auth.user_metadata first_name + last_name (signup time;
 *      universal fallback so the letter is never blank for a registered
 *      candidate)
 *
 * Phone is special: cv_draft.phone wins over candidate_profiles.phone
 * so a number typed into the CV builder lands on the cover letter
 * instantly, no admin approval gate.
 *
 * Returns: { sender: { firstName, lastName, street, number, postal,
 *                       city, country, phone, email },
 *           passportStatus }
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  let { data: row } = await db
    .from("candidate_profiles")
    .select("first_name,last_name,address_street,address_number,address_postal,city_of_residence,country_of_residence,phone,passport_status,cv_draft")
    .eq("user_id", auth.userId)
    .maybeSingle();

  // ── ROOT-FIX: auto-create an empty row on first letter view ──
  // Some candidates have NO row at all (their passport-data form was
  // never submitted, the CV builder was never opened by them, and no
  // admin has touched their record yet). Without a row the cover letter
  // can't even display their name. Insert a stub keyed by user_id so
  // every subsequent write is a cheap UPDATE — and the candidate's name
  // is already in the column for downstream consumers.
  let autoCreateError: string | null = null;
  let autoCreateAttempted = false;
  let autoCreateSeed: Record<string, unknown> | null = null;
  if (!row) {
    autoCreateAttempted = true;
    try {
      const headerJwt0 = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: u0 } = await getAnonVerifyClient().auth.getUser(headerJwt0);
      const m0 = u0?.user?.user_metadata as { first_name?: string; last_name?: string } | undefined;
      const seed: Record<string, unknown> = { user_id: auth.userId };
      if (m0?.first_name) seed.first_name = String(m0.first_name).trim();
      if (m0?.last_name)  seed.last_name  = String(m0.last_name).trim();
      autoCreateSeed = seed;
      const { error: insErr } = await db.from("candidate_profiles").upsert(seed, { onConflict: "user_id" });
      if (insErr) {
        autoCreateError = `${insErr.code ?? ""}: ${insErr.message ?? String(insErr)}`;
      } else {
        const { data: row2, error: selErr } = await db
          .from("candidate_profiles")
          .select("first_name,last_name,address_street,address_number,address_postal,city_of_residence,country_of_residence,phone,passport_status,cv_draft")
          .eq("user_id", auth.userId)
          .maybeSingle();
        if (selErr) autoCreateError = `reselect: ${selErr.message ?? String(selErr)}`;
        row = row2;
      }
    } catch (e) {
      autoCreateError = e instanceof Error ? e.message : String(e);
    }
  }

  type Row = {
    first_name?:           string | null;
    last_name?:            string | null;
    address_street?:       string | null;
    address_number?:       string | null;
    address_postal?:       string | null;
    city_of_residence?:    string | null;
    country_of_residence?: string | null;
    phone?:                string | null;
    passport_status?:      string | null;
    cv_draft?:             Record<string, unknown> | null;
  };
  const p = (row ?? null) as Row | null;

  // Signup metadata is the universal name fallback — every account writes
  // first_name + last_name into auth.users.user_metadata at sign-up time.
  const headerJwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let metaFirst: string = "";
  let metaLast:  string = "";
  let email:     string = "";
  try {
    const { data: u } = await getAnonVerifyClient().auth.getUser(headerJwt);
    email = u?.user?.email ?? "";
    const meta = u?.user?.user_metadata as { first_name?: string; last_name?: string } | undefined;
    metaFirst = meta?.first_name ?? "";
    metaLast  = meta?.last_name  ?? "";
  } catch { /* fall through with empty meta */ }

  const draft = (p?.cv_draft ?? {}) as Record<string, unknown>;
  const draftStr = (k: string): string => {
    const v = draft[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const pick = (a: string | null | undefined, draftK: string, fallback?: string): string =>
    (a && String(a).trim()) || draftStr(draftK) || (fallback?.trim() ?? "");

  const sender = {
    firstName: pick(p?.first_name,           "firstName", metaFirst),
    lastName:  pick(p?.last_name,            "lastName",  metaLast),
    street:    pick(p?.address_street,       "address"),
    number:    pick(p?.address_number,       "addressNumber"),
    postal:    pick(p?.address_postal,       "postalCode"),
    city:      pick(p?.city_of_residence,    "city"),
    country:   pick(p?.country_of_residence, "countryOfResidence"),
    // Phone — cv_draft FIRST (instant, no admin approval), then DB column.
    phone:     draftStr("phone") || (p?.phone ?? "").trim(),
    email,
  };

  // Diagnostic surface — only returned when ?debug=1 is in the URL, so
  // it never leaks to a normal candidate session. Use to inspect what
  // the server actually reads for a candidate without touching the UI.
  const wantDebug = req.nextUrl.searchParams.get("debug") === "1";

  return NextResponse.json({
    sender,
    passportStatus: p?.passport_status ?? null,
    ...(wantDebug ? {
      _debug: {
        row_exists: !!p,
        passport: {
          first_name:           p?.first_name           ?? null,
          last_name:            p?.last_name            ?? null,
          address_street:       p?.address_street       ?? null,
          address_number:       p?.address_number       ?? null,
          address_postal:       p?.address_postal       ?? null,
          city_of_residence:    p?.city_of_residence    ?? null,
          country_of_residence: p?.country_of_residence ?? null,
          phone:                p?.phone                ?? null,
          passport_status:      p?.passport_status      ?? null,
        },
        cv_draft_keys: p?.cv_draft ? Object.keys(p.cv_draft as Record<string, unknown>) : null,
        cv_draft_personal: p?.cv_draft ? {
          firstName:          (p.cv_draft as Record<string, unknown>).firstName          ?? null,
          lastName:           (p.cv_draft as Record<string, unknown>).lastName           ?? null,
          address:            (p.cv_draft as Record<string, unknown>).address            ?? null,
          addressNumber:      (p.cv_draft as Record<string, unknown>).addressNumber      ?? null,
          postalCode:         (p.cv_draft as Record<string, unknown>).postalCode         ?? null,
          city:               (p.cv_draft as Record<string, unknown>).city               ?? null,
          countryOfResidence: (p.cv_draft as Record<string, unknown>).countryOfResidence ?? null,
          phone:              (p.cv_draft as Record<string, unknown>).phone              ?? null,
        } : null,
        signup_metadata: { first_name: metaFirst, last_name: metaLast },
        auto_create_attempted: autoCreateAttempted,
        auto_create_seed: autoCreateSeed,
        auto_create_error: autoCreateError,
        auth_user_id: auth.userId,
      },
    } : {}),
  });
}
