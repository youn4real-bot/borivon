import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";


/**
 * Admin-only candidate STATUS reminders (B2, …).
 * Supreme admin + sub-admins (scoped per LAW #25). The candidate side has
 * NO endpoint and the table is RLS-locked → candidate gets nothing.
 */

// DD.MM.YYYY or YYYY-MM-DD → YYYY-MM-DD (Postgres date) | null
function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const de = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (de) return `${de[3]}-${de[2]}-${de[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime())
    ? null
    : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Sanitize the client-supplied vaccines blob into the known shape: only the
// `masern` / `varizell` keys, max 2 doses each, dates coerced to ISO|null,
// got coerced to bool|null. Anything else is dropped.
function sanitizeVaccines(v: unknown): Record<string, { doses: { got: boolean | null; done_date: string | null; expected_date: string | null }[]; cert_expected: string | null }> {
  const out: Record<string, { doses: { got: boolean | null; done_date: string | null; expected_date: string | null }[]; cert_expected: string | null }> = {};
  if (!v || typeof v !== "object") return out;
  const src = v as Record<string, unknown>;
  for (const key of ["masern", "varizell"] as const) {
    const raw = src[key];
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const dosesIn = Array.isArray(r.doses) ? r.doses.slice(0, 2) : [];
    const doses = dosesIn.map((d) => {
      const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
      return {
        got: o.got === true ? true : o.got === false ? false : null,
        done_date: toIsoDate(o.done_date),
        expected_date: toIsoDate(o.expected_date),
      };
    });
    out[key] = { doses, cert_expected: toIsoDate(r.cert_expected) };
  }
  return out;
}

async function authFor(req: NextRequest, userId: string | null) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { error: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (!userId || !UUID_RE.test(userId)) {
    return { error: NextResponse.json({ error: "userId required" }, { status: 400 }) };
  }
  if (!(await canActOnCandidate(auth.role, auth.email, userId))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { auth };
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  const g = await authFor(req, userId);
  if (g.error) return g.error;

  const db = getServiceSupabase();
  // assign_type/agency/site/employer columns RETIRED 2026-05. Canonical
  // assignment now lives in candidate_profiles.employer_id +
  // candidate_organizations only.
  const { data, error } = await db
    .from("candidate_status")
    .select("b2_complete, b2_cert_date, b2_exam_written, b2_exam_written_date, b2_results_expected_date, b2_planned_exam_date, b2_registration_status, b2_notes, vaccines, b2_next_exam_date, b2_next_exam_confirmed, updated_at")
    .eq("user_id", userId!)
    .maybeSingle();
  if (error) {
    console.error("[candidate-status GET] failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: data ?? null });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId : null;
  const g = await authFor(req, userId);
  if (g.error) return g.error;

  const asBool = (v: unknown): boolean | null =>
    v === true ? true : v === false ? false : null;

  const regStatus = body.b2_registration_status;
  // assign_* fields retired 2026-05 — any legacy keys in the body are
  // ignored and never written. Canonical assignment is now
  // candidate_profiles.employer_id + candidate_organizations only.
  const row = {
    user_id:                  userId!,
    b2_complete:              asBool(body.b2_complete),
    b2_cert_date:             toIsoDate(body.b2_cert_date),
    b2_exam_written:          asBool(body.b2_exam_written),
    b2_exam_written_date:     toIsoDate(body.b2_exam_written_date),
    b2_results_expected_date: toIsoDate(body.b2_results_expected_date),
    b2_planned_exam_date:     toIsoDate(body.b2_planned_exam_date),
    b2_registration_status:   regStatus === "paid" || regStatus === "waiting" ? regStatus : null,
    b2_notes:                 typeof body.b2_notes === "string" ? body.b2_notes.slice(0, 4000) || null : null,
    vaccines:                 sanitizeVaccines(body.vaccines),
    updated_at:               new Date().toISOString(),
  };

  const db = getServiceSupabase();
  const { error } = await db
    .from("candidate_status")
    .upsert(row, { onConflict: "user_id" });
  if (error) {
    console.error("[candidate-status PUT] failed:", error.message);
    return NextResponse.json({ error: `Save failed: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
