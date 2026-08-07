import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";

/**
 * Admin list of homepage-funnel leads (supreme admin + sub-admins).
 * Reached from the profile-avatar menu → "Leads". Read-only, newest first.
 * Source: leads (run supabase/leads.sql).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // BORIVON'S OWN FUNNEL — not a partner agency's to read.
  //
  // requireAdminRole passes any row in sub_admins, is_agency_admin included, so
  // an org admin at a partner agency could list every inbound enquiry: each
  // clinic's contact person and phone, each nurse's email, and the free-text
  // message they sent. Those agencies compete with Borivon for the same German
  // clinics and the same Moroccan nurses. The sibling bookings route already
  // scopes this way; this one was simply missed.
  if (auth.role !== "admin" && auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("leads")
    // `status` was in the table from the start and nothing had ever selected it,
    // so every lead read as brand new for ever — see PATCH below.
    .select("id, kind, email, name, phone, message, details, created_at, candidate_user_id, status")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("[admin/leads] list error:", error.message);
    return NextResponse.json({ error: "Internal error", leads: [] }, { status: 500 });
  }
  return NextResponse.json({ leads: data ?? [] });
}

/** The states a lead can be in. Anything else is rejected outright. */
const LEAD_STATUSES = new Set(["new", "contacted", "closed"]);

/**
 * PATCH /api/portal/admin/leads — mark a lead contacted / closed / new again.
 *
 * The column existed and nothing read or wrote it, so there was no way to record
 * that a lead had been dealt with: eleven enquiries sat at "new" for three
 * months and the list gave no way to tell the answered ones from the ignored
 * ones. With no ping on arrival either (fixed in /api/leads), the list was the
 * only signal there was, and it could not be worked.
 *
 * Same access rule as GET: Borivon's own funnel, so a partner agency's admin is
 * shut out even though requireAdminRole passes them.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin" && auth.isAgencyAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = String((body as { id?: unknown }).id ?? "").trim();
  const status = String((body as { status?: unknown }).status ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  if (!LEAD_STATUSES.has(status)) return NextResponse.json({ error: "bad_status" }, { status: 400 });

  const db = getServiceSupabase();
  const { error } = await db.from("leads").update({ status }).eq("id", id);
  if (error) {
    console.error("[admin/leads] status update failed:", error.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id, status });
}
