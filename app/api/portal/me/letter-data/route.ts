import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

/**
 * GET — return the resolved sender block for the cover letter.
 *
 * Service-role read so it bypasses any candidate_profiles RLS column
 * filter that may strip address fields from the candidate's own anon
 * client. Merging order:
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
 * Side effect: if no candidate_profiles row exists yet for this user,
 * inserts a stub keyed by user_id + auth.users.user_metadata names so
 * every downstream write is a cheap UPDATE on an existing row.
 *
 * Returns: { sender, passportStatus }
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

  // Auto-create empty row on first letter view. Some candidates have no
  // candidate_profiles row at all (passport-data form never submitted,
  // CV builder never opened, no admin touch). Without a row the cover
  // letter can't even display their name. Insert a stub keyed by
  // user_id seeded with names from auth.users.user_metadata so every
  // subsequent write is a cheap UPDATE — and the candidate's name is
  // already in the column for downstream consumers.
  if (!row) {
    try {
      const headerJwt0 = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: u0 } = await getAnonVerifyClient().auth.getUser(headerJwt0);
      const m0 = u0?.user?.user_metadata as { first_name?: string; last_name?: string } | undefined;
      const seed: Record<string, unknown> = { user_id: auth.userId };
      if (m0?.first_name) seed.first_name = String(m0.first_name).trim();
      if (m0?.last_name)  seed.last_name  = String(m0.last_name).trim();
      const { error: insErr } = await db.from("candidate_profiles").upsert(seed, { onConflict: "user_id" });
      if (insErr) {
        console.error("[letter-data] auto-create upsert failed:", insErr.code, insErr.message);
      } else {
        const { data: row2 } = await db
          .from("candidate_profiles")
          .select("first_name,last_name,address_street,address_number,address_postal,city_of_residence,country_of_residence,phone,passport_status,cv_draft")
          .eq("user_id", auth.userId)
          .maybeSingle();
        row = row2;
      }
    } catch (e) {
      console.error("[letter-data] auto-create exception:", e);
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

  return NextResponse.json({
    sender,
    passportStatus: p?.passport_status ?? null,
  });
}
