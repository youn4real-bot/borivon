/**
 * Assemble the REAL, already-scoped candidate set that the search compiler runs
 * over. This is the grounding layer: every SearchableCandidate here is an actual
 * person the caller is allowed to see (LAW #25), so nothing the search returns can
 * be outside scope or invented.
 *
 * Reads span five tables with the service-role client (bypasses RLS — required for
 * the admin-only candidate_status, and for auth name resolution):
 *   • auth.users            — name (user_metadata.full_name), email, signup, last login
 *   • candidate_profiles    — B2 rail, specialty, experience, city, passport, flags
 *   • candidate_status      — admin B2 truth (b2_complete + b2_cert_date) — RLS-locked
 *   • candidate_pipeline    — funnel stage + interview / visa dates
 *   • candidate_organizations + organizations — org links (also part of scoping)
 *   • documents             — pending count + approved B2 certificate evidence
 *
 * Every read is wrapped so a not-yet-migrated column or table degrades to "no data"
 * rather than throwing — losing a facet is fine, 500-ing the search is not.
 */
import { getServiceSupabase } from "@/lib/supabase";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { normalizeB2Stage, isB2CertificateDoc, effectiveB2Stage } from "@/lib/b2Journey";
import { computeChecklist } from "@/lib/candidateChecklist";
import { extractGerman, type MonthYear } from "@/lib/b2Detail";
import type { AssistantScope } from "@/lib/assistantScope";
import type { SearchableCandidate } from "@/lib/candidateSearch";

const ms = (v: unknown): number | null => {
  if (!v || typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
// Best-effort epoch from a {month, year} pair (the cv_draft exam dates are
// month-resolution). Unparseable month → first of the year; no year → null.
const monthYearMs = (my: MonthYear | undefined | null): number | null => {
  if (!my) return null;
  const y = parseInt(String(my.year ?? ""), 10);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return null;
  let mo = parseInt(String(my.month ?? ""), 10);
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) mo = 1;
  return Date.UTC(y, mo - 1, 1);
};
const minMs = (a: number | null, b: number | null): number | null => {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
};

/**
 * Build the scoped candidate universe. Returns [] for a locked-out caller
 * (scope.visibleIds === []) so the search simply finds nothing — never widens.
 */
export async function assembleSearchableCandidates(scope: AssistantScope): Promise<SearchableCandidate[]> {
  const visible = scope.visibleIds;            // null = all, [] = none, array = these
  if (Array.isArray(visible) && visible.length === 0) return [];
  const allow = visible === null ? null : new Set(visible);
  const inScope = (uid: string) => allow === null || allow.has(uid);

  const db = getServiceSupabase();

  // Staff are never candidates — collect their emails to prune (mirrors the admin
  // GET route, so the same corruption fix applies here retroactively).
  const staffEmails = new Set<string>();
  try {
    const { data: staffRows } = await db.from("sub_admins").select("email");
    for (const r of (staffRows ?? []) as { email: string }[]) if (r.email) staffEmails.add(r.email.toLowerCase());
  } catch { /* sub_admins missing → no staff to prune */ }
  const supreme = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (supreme) staffEmails.add(supreme);

  // ── 1. Auth walk: name / email / signup / last-login for every real candidate ──
  // Wrapped so a THROW (supabase-js re-throws non-AuthError failures like a network
  // blip) degrades to whatever was collected, rather than 500-ing the search — the
  // header invariant. Every other read below is likewise guarded.
  type AuthInfo = { email: string; name: string; createdAtMs: number | null; lastSignInMs: number | null };
  const auth = new Map<string, AuthInfo>();
  try {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !data?.users?.length) break;
      for (const u of data.users) {
        if (!u.id || !u.email) continue;
        if (isSoftDeletedAuthUser(u)) continue;              // a deleted person is gone
        if (staffEmails.has(u.email.toLowerCase())) continue; // staff ≠ candidate
        if (!inScope(u.id)) continue;                         // LAW #25
        const name = ((u.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim() || u.email;
        auth.set(u.id, {
          email: u.email,
          name,
          createdAtMs: ms(u.created_at),
          lastSignInMs: ms(u.last_sign_in_at),
        });
      }
      if (data.users.length < 1000) break;
    }
  } catch (e) {
    console.error("[candidate-search] auth walk failed:", e instanceof Error ? e.message : e);
    // Keep whatever pages we already collected; if none, we return [] below.
  }
  if (auth.size === 0) return [];
  const ids = [...auth.keys()];

  // ── 2. candidate_profiles (schema-tolerant) ──
  const profiles = new Map<string, Record<string, unknown>>();
  try {
    const cols = "user_id, phone, nationality, sex, marital_status, city_of_birth, city_of_residence, passport_status, passport_expiry, b2_stage, b2_failed, b2_exam_date, nursing_specialty, years_experience, workplace_pref, placement_ready, manually_verified, available_from, employer_id, is_test_account, profile_photo, cv_langs:cv_draft->langs";
    let rows: Record<string, unknown>[] | null = null;
    const res = await db.from("candidate_profiles").select(cols).in("user_id", ids);
    if (res.error) {
      const fb = await db.from("candidate_profiles").select("*").in("user_id", ids);
      rows = (fb.data ?? []) as Record<string, unknown>[];
    } else {
      rows = (res.data ?? []) as Record<string, unknown>[];
    }
    for (const p of rows) profiles.set(p.user_id as string, p);
  } catch { /* candidate_profiles unreadable → all candidates keep auth-only defaults */ }

  // ── 3. candidate_status (admin B2 truth) ──
  const status = new Map<string, Record<string, unknown>>();
  try {
    const { data } = await db.from("candidate_status").select("user_id, b2_complete, b2_cert_date, b2_next_exam_date").in("user_id", ids);
    for (const s of (data ?? []) as Record<string, unknown>[]) status.set(s.user_id as string, s);
  } catch { /* candidate_status not migrated → no admin B2 truth */ }

  // ── 4. candidate_pipeline (funnel + interview/visa dates), schema-tolerant ──
  const pipeline = new Map<string, Record<string, unknown>>();
  try {
    const cols = "user_id, funnel_stage, batch_id, interview1_date, interview2_date, interview1_status, interview2_status, visa_appt_date, flight_date, last_touch_at";
    const res = await db.from("candidate_pipeline").select(cols).in("user_id", ids);
    const rows = res.error
      ? ((await db.from("candidate_pipeline").select("*").in("user_id", ids)).data ?? [])
      : (res.data ?? []);
    for (const p of rows as Record<string, unknown>[]) pipeline.set(p.user_id as string, p);
  } catch { /* candidate_pipeline not migrated → no funnel/interview data */ }

  // Batch names for whatever batch_ids the (scoped) candidates are assigned to.
  const batchNames = new Map<string, string>();
  try {
    const batchIds = [...new Set([...pipeline.values()].map((p) => (p as { batch_id?: string | null }).batch_id).filter((b): b is string => !!b))];
    if (batchIds.length) {
      const { data: batches } = await db.from("employer_batches").select("id, name").in("id", batchIds);
      for (const b of (batches ?? []) as { id: string; name: string }[]) batchNames.set(b.id, b.name);
    }
  } catch { /* employer_batches not migrated → no batch names */ }

  // ── 5. org links (approved only) → names per candidate ──
  // ONLY surfaced to callers who legitimately see ALL orgs (supreme admin / HQ
  // sub-admin ⇒ visible === null). For an org-SCOPED caller we deliberately leave
  // orgNames empty: a candidate can hold approved links to several orgs, and
  // showing a competitor agency's name to a scoped org-admin would leak cross-org
  // linkage the candidate record itself doesn't (LAW #25 org isolation).
  const orgNames = new Map<string, string[]>();
  if (visible === null) {
    try {
      const { data: links } = await db.from("candidate_organizations").select("candidate_user_id, org_id").eq("status", "approved").in("candidate_user_id", ids);
      const linkRows = (links ?? []) as { candidate_user_id: string; org_id: string }[];
      const orgIds = [...new Set(linkRows.map((l) => l.org_id))];
      const orgById = new Map<string, string>();
      if (orgIds.length) {
        const { data: orgs } = await db.from("organizations").select("id, name").in("id", orgIds);
        for (const o of (orgs ?? []) as { id: string; name: string }[]) orgById.set(o.id, o.name);
      }
      for (const l of linkRows) {
        const nm = orgById.get(l.org_id);
        if (!nm) continue;
        (orgNames.get(l.candidate_user_id) ?? orgNames.set(l.candidate_user_id, []).get(l.candidate_user_id)!).push(nm);
      }
    } catch { /* org tables missing → no org facet */ }
  }

  // ── 6. documents → pending/rejected/checklist + approved-B2-cert evidence ──
  const pendingCount = new Map<string, number>();
  const approvedB2CertMs = new Map<string, number | null>(); // uid → cert doc time (or null if approved but timeless)
  const docsByUid = new Map<string, { file_type: string | null; status: string | null }[]>();
  try {
    const { data: docs } = await db.from("documents").select("user_id, file_type, status, uploaded_at, superseded_at").in("user_id", ids);
    for (const d of (docs ?? []) as Record<string, unknown>[]) {
      if (d.superseded_at) continue; // archived (LAW #33)
      const uid = d.user_id as string;
      (docsByUid.get(uid) ?? docsByUid.set(uid, []).get(uid)!).push({
        file_type: (d.file_type as string | null) ?? null,
        status: (d.status as string | null) ?? null,
      });
      if (d.status === "pending") pendingCount.set(uid, (pendingCount.get(uid) ?? 0) + 1);
      if (d.status === "approved" && isB2CertificateDoc(d.file_type as string)) {
        if (!approvedB2CertMs.has(uid)) approvedB2CertMs.set(uid, ms(d.uploaded_at));
      }
    }
  } catch { /* documents unreadable → no pending/cert evidence */ }

  // ── Assemble ──
  const out: SearchableCandidate[] = [];
  for (const uid of ids) {
    const a = auth.get(uid)!;
    const p = profiles.get(uid) ?? {};
    if (p.is_test_account === true) continue; // hidden everywhere
    const s = status.get(uid) ?? {};
    const pipe = pipeline.get(uid) ?? {};

    const hasApprovedB2Cert = approvedB2CertMs.has(uid);
    // Cert date: admin-set b2_cert_date first; else the approved cert doc's time.
    const b2CertDateMs = ms(s.b2_cert_date) ?? (hasApprovedB2Cert ? approvedB2CertMs.get(uid) ?? null : null);
    // Document checklist roll-up (pure) — powers the doc facets + progress.
    const uidDocs = docsByUid.get(uid) ?? [];
    const chk = computeChecklist(uidDocs);

    // Rich B2 detail from the cv_draft German panel (the maintained B2 source).
    const langs = (p as { cv_langs?: unknown; cv_draft?: { langs?: unknown } }).cv_langs
      ?? (p as { cv_draft?: { langs?: unknown } }).cv_draft?.langs ?? null;
    const de = extractGerman({ langs });
    const plannedMy = de.detail?.written === "no" ? de.detail?.notYetDate
      : de.detail?.result === "failed" ? de.detail?.retakeDate : null;
    const b2Planned = !!(plannedMy && (plannedMy.month || plannedMy.year));

    out.push({
      uid,
      name: a.name,
      email: a.email,
      phone: (p.phone as string | null) ?? null,
      photo: (p.profile_photo as string | null) ?? null,
      createdAtMs: a.createdAtMs,
      lastSignInMs: a.lastSignInMs,

      // An APPROVED B2 certificate outranks the b2_stage column, which nobody
      // maintains: 81 of 85 rows still carry the 'not_started' default, including
      // 15 candidates whose certificate is already approved and on file. Reading
      // the column raw made the same nurse "passed" on the B2 board and "not
      // started" in search facets at the same time. The docs are already loaded
      // and superseded-filtered above, so this costs nothing.
      b2Stage: effectiveB2Stage(normalizeB2Stage(p.b2_stage), docsByUid.get(uid) ?? []),
      b2Failed: p.b2_failed === true,
      nationality: (p.nationality as string | null) ?? null,
      cityOfBirth: (p.city_of_birth as string | null) ?? null,
      cityOfResidence: (p.city_of_residence as string | null) ?? null,
      sex: (p.sex as string | null) ?? null,
      maritalStatus: (p.marital_status as string | null) ?? null,
      specialty: (p.nursing_specialty as string | null) ?? null,
      yearsExperience: typeof p.years_experience === "number" ? p.years_experience : null,
      workplacePref: (p.workplace_pref as string | null) ?? null,
      placementReady: p.placement_ready === true,
      verified: p.manually_verified === true,
      passportStatus: (p.passport_status as string | null) ?? null,
      passportExpiryMs: ms(p.passport_expiry),
      availableFromMs: ms(p.available_from),
      hasEmployer: !!p.employer_id,
      orgNames: orgNames.get(uid) ?? [],

      b2Complete: typeof s.b2_complete === "boolean" ? s.b2_complete : null,
      b2CertDateMs,
      b2ExamMs: minMs(ms(p.b2_exam_date), ms(s.b2_next_exam_date)),
      germanLevel: de.level,
      b2Result: de.detail?.result ?? null,
      b2ExamType: de.detail?.pruefung ?? null,
      b2CertStatus: de.detail?.certificateStatus ?? null,
      b2Planned,
      b2PlannedMs: monthYearMs(plannedMy),

      funnelStage: (pipe.funnel_stage as string | null) ?? null,
      batchId: (pipe.batch_id as string | null) ?? null,
      batchName: pipe.batch_id ? (batchNames.get(pipe.batch_id as string) ?? null) : null,
      interview1Ms: ms(pipe.interview1_date),
      interview2Ms: ms(pipe.interview2_date),
      interview1Status: (pipe.interview1_status as string | null) ?? null,
      interview2Status: (pipe.interview2_status as string | null) ?? null,
      visaApptMs: ms(pipe.visa_appt_date),
      flightMs: ms(pipe.flight_date),
      lastTouchMs: ms(pipe.last_touch_at),

      pendingDocCount: pendingCount.get(uid) ?? 0,
      hasApprovedB2Cert,
      docTotal: uidDocs.length,
      rejectedDocs: chk.counts.rejected,
      missingRequired: chk.counts.missing,
      checklistPct: chk.pct,
    });
  }
  return out;
}
