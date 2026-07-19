/**
 * Employer shortlists — admin curation (list + create).
 *
 * ALL admins, scoped by LAW #25's AGENCY dimension: a supreme admin sees/creates
 * for any org, an org-scoped admin only for their own org(s). Read-only for the
 * employer happens on a separate tokenized public route.
 *
 *   GET  → { role, shortlists:[{ id, title, note, status, shareToken, orgId, agency,
 *            employer, count, createdAt }] }
 *   POST → create { title, orgId?, employerId?, note? } → { id }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getVisibleOrgIds, canActOnOrg } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { genShareToken } from "@/lib/shortlist";
import { UUID_RE } from "@/lib/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = getServiceSupabase();

  const scope = auth.role === "admin" ? null : await getVisibleOrgIds(auth.email);

  const { data: rows, error } = await db
    .from("employer_shortlists")
    .select("id, org_id, employer_id, title, note, status, share_token, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "unavailable" }, { status: 500 });

  type Row = { id: string; org_id: string | null; employer_id: string | null; title: string; note: string | null; status: string; share_token: string | null; created_at: string };
  const all = (rows ?? []) as Row[];
  // Scope: supreme + true HQ sub-admin (scope null) → all; org-scoped → own orgs only.
  const visible = scope === null ? all : all.filter((r) => r.org_id != null && scope.includes(r.org_id));

  // Candidate counts (one query for all visible shortlists).
  const ids = visible.map((r) => r.id);
  const countBySl = new Map<string, number>();
  if (ids.length) {
    const { data: mem } = await db.from("shortlist_candidates").select("shortlist_id").in("shortlist_id", ids);
    for (const m of (mem ?? []) as { shortlist_id: string }[]) countBySl.set(m.shortlist_id, (countBySl.get(m.shortlist_id) ?? 0) + 1);
  }

  // Org + employer name maps.
  const { data: orgsData } = await db.from("organizations").select("id, name").order("name");
  const orgRows = (orgsData ?? []) as { id: string; name: string }[];
  const orgName = new Map<string, string>(orgRows.map((o) => [o.id, o.name]));
  const { data: emps } = await db.from("employers").select("id, name").eq("active", true).order("name");
  const empRows = (emps ?? []) as { id: string; name: string }[];
  const empName = new Map<string, string>(empRows.map((e) => [e.id, e.name]));

  // Create-form options — the orgs this admin may build a shortlist for.
  const orgOptions = scope === null ? orgRows : orgRows.filter((o) => scope.includes(o.id));

  return NextResponse.json({
    role: auth.role,
    orgs: orgOptions,
    employers: empRows,
    shortlists: visible.map((r) => ({
      id: r.id,
      title: r.title,
      note: r.note ?? "",
      status: r.status,
      shareToken: r.share_token,
      orgId: r.org_id,
      agency: r.org_id ? orgName.get(r.org_id) ?? null : null,
      employer: r.employer_id ? empName.get(r.employer_id) ?? null : null,
      count: countBySl.get(r.id) ?? 0,
      createdAt: r.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));

  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

  const orgId = typeof body?.orgId === "string" && UUID_RE.test(body.orgId) ? body.orgId : null;
  const employerId = typeof body?.employerId === "string" && UUID_RE.test(body.employerId) ? body.employerId : null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : null;

  // LAW #25 — an org-scoped admin can only create a shortlist for their own org.
  if (!(await canActOnOrg(auth.role, auth.email, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("employer_shortlists")
    .insert({ title, org_id: orgId, employer_id: employerId, note, status: "draft", share_token: genShareToken(), created_by: auth.email })
    .select("id")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "create_failed" }, { status: 500 });

  return NextResponse.json({ id: (data as { id: string }).id });
}
