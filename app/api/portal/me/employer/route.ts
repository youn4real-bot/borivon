import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

// Legacy fallback only — pre-backfill rows still on the old enum.
const LEGACY_CAMPUS_TO_SLUG: Record<string, string> = {
  kiel: "uksh_kiel",
  luebeck: "uksh_luebeck",
};

/**
 * The logged-in candidate's assigned employer for the Motivationsschreiben
 * recipient block. Canonical source: candidate_profiles.employer_id →
 * employers. Falls back to the deprecated uksh_campus enum for any row not
 * yet backfilled.
 *
 * GET /api/portal/me/employer
 *   200 { assigned: true, name, lines: string[] }
 *   200 { assigned: false }
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();

  const { data: profile } = await db
    .from("candidate_profiles")
    .select("employer_id, uksh_campus")
    .eq("user_id", auth.userId)
    .maybeSingle();

  const employerId = (profile as { employer_id?: string } | null)?.employer_id ?? null;
  const legacyCampus = (profile as { uksh_campus?: string } | null)?.uksh_campus ?? null;

  type Emp = { name: string; address_lines: string[] };
  let employer: Emp | null = null;

  if (employerId) {
    const { data, error } = await db
      .from("employers")
      .select("name, address_lines")
      .eq("id", employerId)
      .maybeSingle<Emp>();
    if (error) {
      console.error("[me/employer] lookup failed:", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    employer = data ?? null;
  } else if (legacyCampus && LEGACY_CAMPUS_TO_SLUG[legacyCampus]) {
    const { data } = await db
      .from("employers")
      .select("name, address_lines")
      .eq("slug", LEGACY_CAMPUS_TO_SLUG[legacyCampus])
      .maybeSingle<Emp>();
    employer = data ?? null;
  }

  if (!employer) return NextResponse.json({ assigned: false });

  return NextResponse.json({
    assigned: true,
    name: employer.name,
    lines: employer.address_lines ?? [],
  });
}
