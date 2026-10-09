/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * The cases tests/routeParity.test.ts runs: every GET handler a person can reach,
 * as the people who reach it. Ids are row ids from live data (no names, emails or
 * other PII); anything secret-ish (invite codes, signed tokens, profile slugs) is
 * looked up or signed at RUN time by `prepare`, never written down here.
 */

// ─── who ──────────────────────────────────────────────────────────────────────
/** Candidates picked from live data at different points of the pipeline. */
export const CANDIDATES = {
  c_docs: "a906b965-98c6-4e6d-bda1-5eac5c6dfaa0",    // org-linked, in a batch, most documents
  c_msgs: "78635d80-24d0-4d7b-b6c0-51fe74c27ce1",    // org-linked, longest message thread (with attachments)
  c_journey: "870a1114-9868-4108-be87-6aeb43596455", // no org, no batch, 35 journey items
  c_funnel: "4aeb9e8d-2d79-499e-a06f-3459ffa3a885",  // funnel_stage waiting_2nd, org-linked
  c_status: "b29d5d97-b457-48af-817e-660ce46ea86c",  // no org; candidate_status written since the switch (journaled)
  c_lang: "6a9d18ac-7dc6-4adc-8fe4-a72cc19ea3ba",    // candidate_profiles.lang written since the switch (journaled)
  c_nopipe: "c58125e1-7b68-4bf4-926b-fe58d558a10a",  // profile + documents but no candidate_pipeline row
} as const;
export type CandidatePersona = keyof typeof CANDIDATES;
export type Persona = "admin" | "hqsub" | "orgadmin" | CandidatePersona;

const ORG = "ad3860e0-0245-4599-9ba4-5a2ba4707142";
const T_IN = CANDIDATES.c_docs;      // inside the org admin's scope
const T_OUT = CANDIDATES.c_journey;  // outside it
/** The one sign request's candidate — no auth user any more (orphaned row), so only an admin can look. */
const SIGN_CANDIDATE = "170f706b-0ac0-4f49-b79e-05ea5cec2b51";
const ADMINS: Persona[] = ["admin", "hqsub", "orgadmin"];
const CANDS = Object.keys(CANDIDATES) as CandidatePersona[];

/** Resolve personas to their real auth users — GETs only (admin list/get). */
export async function resolvePersonas(db: SupabaseClient<any, any, any>): Promise<Record<Persona, User>> {
  const users: User[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const byEmail = new Map(users.map((u) => [(u.email ?? "").toLowerCase(), u]));
  const byId = new Map(users.map((u) => [u.id, u]));
  const need = (u: User | undefined, what: string): User => { if (!u) throw new Error(`persona not found: ${what}`); return u; };

  const { data: subs, error: subErr } = await db.from("sub_admins").select("email, is_agency_admin").order("email");
  const { data: mems, error: memErr } = await db.from("organization_members").select("sub_admin_email, org_id");
  if (subErr || memErr) throw new Error("sub_admins / organization_members read failed");
  const inOrg = new Set((mems ?? []).map((m: any) => String(m.sub_admin_email).toLowerCase()));
  const hq = (subs ?? []).find((s: any) => !s.is_agency_admin && !inOrg.has(String(s.email).toLowerCase()) && byEmail.has(String(s.email).toLowerCase()));
  const org = (subs ?? []).find((s: any) => (mems ?? []).some((m: any) => m.org_id === ORG && String(m.sub_admin_email).toLowerCase() === String(s.email).toLowerCase()));

  const out = {
    admin: need(byEmail.get((process.env.ADMIN_EMAIL ?? "").trim().toLowerCase()), "supreme admin"),
    hqsub: need(hq && byEmail.get(String(hq.email).toLowerCase()), "HQ sub-admin"),
    orgadmin: need(org && byEmail.get(String(org.email).toLowerCase()), "org admin"),
  } as Record<Persona, User>;
  for (const [k, id] of Object.entries(CANDIDATES)) out[k as Persona] = need(byId.get(id), k);
  return out;
}

// ─── what ─────────────────────────────────────────────────────────────────────
export type Prepared = { url?: string; params?: Record<string, string> };
export type RouteCase = {
  id: string;
  /** Module specifier of the route file. */
  module: string;
  url: string;
  persona?: Persona;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  /** POST only for the read-only POST handlers (search, facets): they read, never write — the guards would record it. */
  method?: "GET" | "POST";
  body?: unknown;
  /** Run-time lookup (read-only client) for values that must not be committed. */
  prepare?: (db: SupabaseClient<any, any, any>) => Promise<Prepared>;
  /** Drop volatile parts of the body before comparing. */
  normalize?: (body: unknown) => unknown;
  /** A known, explained difference (journaled rows): reported, not failed. */
  expectedDiff?: string;
  expectStatus?: number;
};

const mod = (route: string) => `@/app/api/${route}/route`;
/**
 * Reported, not failed: the rows match, only the sequence of rows the code never
 * ordered (or ranked with ties) differs — Postgres returns heap order, D1 rowid
 * order (tests/d1OrderParity.test.ts). Each was checked: the screen re-sorts, or
 * the ties are equal-rank rows whose relative order nobody relies on.
 */
const ORDER_TIES = "order of unordered/equal-rank rows (heap vs rowid order); same rows";
const cases: RouteCase[] = [];
function add(route: string, url: string, personas: (Persona | undefined)[], extra: Partial<RouteCase> = {}) {
  for (const persona of personas) {
    cases.push({ id: `${url} as ${persona ?? "public"}`, module: mod(route), url, persona, ...extra });
  }
}

// ── admin panel load + sub-routes ──
add("portal/admin", "/api/portal/admin", ADMINS);
add("portal/admin", `/api/portal/admin?userId=${T_IN}`, ["admin", "orgadmin"]);
add("portal/admin", `/api/portal/admin?userId=${T_OUT}`, ["admin", "orgadmin"]);
add("portal/admin/users", "/api/portal/admin/users", ADMINS);
add("portal/admin/sub-admins", "/api/portal/admin/sub-admins", ADMINS);
add("portal/me/role", "/api/portal/me/role", [...ADMINS, "c_docs"]);
add("portal/admin/notifications", "/api/portal/admin/notifications", ADMINS);
add("portal/admin/notifications", "/api/portal/admin/notifications?unread=1", ADMINS);
add("portal/admin/notifications/[id]/doc", "/api/portal/admin/notifications/bb229230-e5dd-4df7-88c6-c10ab07f9425/doc", ADMINS, { params: { id: "bb229230-e5dd-4df7-88c6-c10ab07f9425" } });
add("portal/admin/messages", "/api/portal/admin/messages", ADMINS);
add("portal/admin/messages", `/api/portal/admin/messages?threadUserId=${CANDIDATES.c_msgs}`, ADMINS);
add("portal/admin/messages/[id]/attachment", "/api/portal/admin/messages/1633146d-9047-462a-8dbb-ea05cab33570/attachment", ["admin"], { params: { id: "1633146d-9047-462a-8dbb-ea05cab33570" } });
add("portal/admin/candidate-contact", `/api/portal/admin/candidate-contact?userId=${T_IN}`, ADMINS);
add("portal/admin/candidate-status", `/api/portal/admin/candidate-status?userId=${T_IN}`, ADMINS);
add("portal/admin/candidate-status", `/api/portal/admin/candidate-status?userId=${CANDIDATES.c_status}`, ["admin"], { expectedDiff: "candidate_status row upserted since the switch (journal)" });
add("portal/admin/cv-draft", `/api/portal/admin/cv-draft?candidateId=${T_IN}`, ADMINS);
add("portal/admin/cv-draft", `/api/portal/admin/cv-draft?candidateId=${T_OUT}`, ["orgadmin"]);
add("portal/admin/assign-employer", `/api/portal/admin/assign-employer?candidateUserId=${T_IN}`, ADMINS);
add("portal/admin/partner-share", `/api/portal/admin/partner-share?candidateUserId=${T_IN}`, ADMINS);
add("portal/admin/interview-proposals", `/api/portal/admin/interview-proposals?candidate=${T_IN}`, ADMINS);
add("portal/admin/classroom/tester", `/api/portal/admin/classroom/tester?userId=${T_IN}`, ["admin"]);
add("portal/admin/sign-request", `/api/portal/admin/sign-request?candidateId=${SIGN_CANDIDATE}`, ADMINS);
add("portal/admin/slot-template", "/api/portal/admin/slot-template?slotId=343df171-377d-4691-8c46-703377558231", ["admin"]);
add("portal/admin/me/signature", "/api/portal/admin/me/signature", ADMINS);
add("portal/admin/pdf-mappings", "/api/portal/admin/pdf-mappings?signature=route-parity", ["admin"]);
add("portal/admin/checklist", "/api/portal/admin/checklist", ADMINS);
add("portal/admin/assigned-tasks", "/api/portal/admin/assigned-tasks", ADMINS);
add("portal/passport-pdf", `/api/portal/passport-pdf?userId=${T_IN}`, ["admin"]);
add("portal/file", "/api/portal/file?docId=847e59b9-ae5c-4393-981f-75ef4012a9b6", ["admin", "orgadmin", "c_docs", "c_journey"]);
add("portal/classroom/engagement/[userId]", `/api/portal/classroom/engagement/${T_IN}`, ["admin"], { params: { userId: T_IN } });

// ── candidate search + facets, dashboards, boards ──
// search and facets are POSTs that only read (the query travels in the body).
add("portal/admin/facets", "/api/portal/admin/facets", ADMINS, { method: "POST", body: { lang: "en", selection: {} } });
add("portal/admin/facets", "/api/portal/admin/facets#b2+docs", ["admin", "orgadmin"], { method: "POST", body: { lang: "de", selection: { b2: ["full_cert", "awaiting"], docs: ["missing", "pending"] } } });
add("portal/admin/search", "/api/portal/admin/search", ADMINS, { method: "POST", body: { query: "", lang: "en" } });
add("portal/admin/search", "/api/portal/admin/search#keyword", ["admin", "orgadmin"], { method: "POST", body: { query: "b2 missing documents", lang: "en" } });
add("portal/pipeline", `/api/portal/pipeline?userId=${T_IN}`, ["admin", "orgadmin"]);
add("portal/journey/pipeline", "/api/portal/journey/pipeline", ADMINS, { expectedDiff: ORDER_TIES }); // sorted by health rank; ties keep read order
add("portal/batches", "/api/portal/batches", ADMINS);
add("portal/tracker", "/api/portal/tracker", ADMINS);
add("portal/admin/analytics", "/api/portal/admin/analytics", ADMINS);
add("portal/admin/b2-overview", "/api/portal/admin/b2-overview", ADMINS, { expectedDiff: ORDER_TIES }); // b2-status page re-sorts by stage + name
add("portal/admin/chase", "/api/portal/admin/chase", ADMINS);
add("portal/admin/expiry-radar", "/api/portal/admin/expiry-radar", ADMINS);
add("portal/admin/needs", "/api/portal/admin/needs?lang=de", ADMINS);
add("portal/admin/doc-reminders", "/api/portal/admin/doc-reminders?lang=de", ADMINS);
add("portal/admin/org-needs", "/api/portal/admin/org-needs", ADMINS);
add("portal/admin/suggested-matches", "/api/portal/admin/suggested-matches", ADMINS);
add("portal/admin/classroom/candidates", "/api/portal/admin/classroom/candidates?q=", ADMINS);
add("portal/admin/classroom/engagement", "/api/portal/admin/classroom/engagement?session=6395129f-383a-4336-b874-1a7c4f1bc045", ["admin"]);

// ── leads, affiliates, orgs, employers, partner, shortlists ──
add("portal/admin/leads", "/api/portal/admin/leads", ADMINS, { expectedDiff: "a lead inserted since the switch (journal)" });
add("portal/admin/online-courses", "/api/portal/admin/online-courses", ADMINS);
add("portal/admin/affiliates", "/api/portal/admin/affiliates", ADMINS);
add("portal/admin/affiliates/[id]/referrals", "/api/portal/admin/affiliates/00000000-0000-4000-8000-000000000000/referrals", ["admin"], { params: { id: "00000000-0000-4000-8000-000000000000" } });
add("portal/admin/organizations", "/api/portal/admin/organizations", ADMINS);
add("portal/admin/organizations/[id]/candidates", `/api/portal/admin/organizations/${ORG}/candidates`, ADMINS, { params: { id: ORG } });
add("portal/admin/organizations/[id]/members", `/api/portal/admin/organizations/${ORG}/members`, ADMINS, { params: { id: ORG } });
add("portal/admin/organizations/[id]/requirements", `/api/portal/admin/organizations/${ORG}/requirements`, ADMINS, { params: { id: ORG } });
add("portal/admin/organization-requests", "/api/portal/admin/organization-requests", ADMINS);
add("portal/admin/agencies", "/api/portal/admin/agencies", ADMINS);
add("portal/admin/agency-profile", "/api/portal/admin/agency-profile", ADMINS);
add("portal/admin/employers", "/api/portal/admin/employers", ADMINS);
add("portal/admin/employers", "/api/portal/admin/employers?all=1", ["admin"]);
add("portal/admin/partner-keys", "/api/portal/admin/partner-keys", ADMINS);
add("portal/admin/shortlists", "/api/portal/admin/shortlists", ADMINS);
add("portal/admin/shortlists/[id]", "/api/portal/admin/shortlists/00000000-0000-4000-8000-000000000000", ["admin"], { params: { id: "00000000-0000-4000-8000-000000000000" } });
add("partner/v1/candidates", "/api/partner/v1/candidates", [undefined], { headers: { authorization: "Bearer bvp_route_parity_not_a_key" } });
add("partner/v1/documents/[id]", "/api/partner/v1/documents/847e59b9-ae5c-4393-981f-75ef4012a9b6", [undefined], { headers: { authorization: "Bearer bvp_route_parity_not_a_key" }, params: { id: "847e59b9-ae5c-4393-981f-75ef4012a9b6" } });

// ── calendar / bookings ──
add("portal/calendar", "/api/portal/calendar", [...ADMINS, "c_docs", "c_journey"]);
add("portal/admin/bookings", "/api/portal/admin/bookings", ADMINS);
add("portal/admin/booking-types", "/api/portal/admin/booking-types", ADMINS);
add("portal/admin/booking-availability", "/api/portal/admin/booking-availability", ADMINS);
add("book", "/api/book?type=nurse", [undefined]);
add("book/manage", "/api/book/manage?t=route-parity-not-a-token", [undefined]);

// ── academy ──
add("portal/academy/admin", "/api/portal/academy/admin?view=cohorts", ADMINS);
add("portal/academy/admin", "/api/portal/academy/admin?view=cohort&id=536e2dbb-b07a-4c4a-8482-aa4d79b0bd9c", ["admin", "orgadmin"]);
add("portal/academy/admin", "/api/portal/academy/admin?view=candidates&cohortId=536e2dbb-b07a-4c4a-8482-aa4d79b0bd9c", ["admin", "orgadmin"], { expectedDiff: ORDER_TIES }); // name sort; nameless "—" rows tie
add("portal/academy/admin", "/api/portal/academy/admin?view=quizzes&cohortId=536e2dbb-b07a-4c4a-8482-aa4d79b0bd9c", ["admin"]);
add("portal/academy/visibility", "/api/portal/academy/visibility", ADMINS);
add("portal/academy/me", "/api/portal/academy/me", ["c_docs", "c_journey"]);

// ── phase slots / templates ──
for (const phase of ["bearbeitung", "visum"]) {
  add("portal/phase-slots", `/api/portal/phase-slots?phase=${phase}`, ["admin", "orgadmin", "c_docs", "c_journey"]);
  add("portal/phase-slots", `/api/portal/phase-slots?phase=${phase}&candidateId=${T_IN}`, ["admin", "orgadmin"]);
  add("portal/phase-slot-categories", `/api/portal/phase-slot-categories?phase=${phase}`, ["admin", "orgadmin", "c_docs", "c_journey"]);
  add("portal/phase-slot-categories", `/api/portal/phase-slot-categories?phase=${phase}&candidateId=${T_IN}`, ["admin"]);
}
add("portal/phase-doc-order", "/api/portal/phase-doc-order", ["admin", "c_docs"]);
add("portal/slot-template", "/api/portal/slot-template?slotId=343df171-377d-4691-8c46-703377558231", ["admin", "c_docs", "c_journey"]);

// ── candidate dashboard (/me/*, pipeline, documents, notifications, messages) ──
const ME_COLS = "first_name,last_name,dob,sex,nationality,city_of_birth,country_of_birth,passport_no,passport_expiry,issuing_authority,issue_date,address_street,address_number,address_postal,city_of_residence,country_of_residence,marital_status,children_ages,phone,passport_confirmed_fields,passport_status,manually_verified,profile_photo,cv_draft";
add("portal/me/profile", `/api/portal/me/profile?cols=${ME_COLS}`, CANDS);
add("portal/me/documents", "/api/portal/me/documents", CANDS);
add("portal/me/notifications", "/api/portal/me/notifications", CANDS);
add("portal/me/notifications", "/api/portal/me/notifications?kind=invites", ["c_docs", "c_journey"]);
add("portal/me/checklist", "/api/portal/me/checklist", CANDS);
add("portal/me/cv-draft", "/api/portal/me/cv-draft", CANDS);
add("portal/me/employer", "/api/portal/me/employer", CANDS);
add("portal/me/employer", `/api/portal/me/employer?userId=${T_IN}`, ["admin", "orgadmin"]);
add("portal/me/interview-proposals", "/api/portal/me/interview-proposals", CANDS);
add("portal/me/letter-data", "/api/portal/me/letter-data", CANDS);
add("portal/me/letter-data", `/api/portal/me/letter-data?userId=${T_IN}`, ["admin"]);
add("portal/me/organizations", "/api/portal/me/organizations", CANDS);
add("portal/me/profile-photo", "/api/portal/me/profile-photo", ["c_docs", "c_journey", "admin"]);
add("portal/me/sign-requests", "/api/portal/me/sign-requests", CANDS);
add("portal/me/signature", "/api/portal/me/signature", ["c_docs", "c_journey"]);
add("portal/me/verified", "/api/portal/me/verified", CANDS);
add("portal/pipeline/me", "/api/portal/pipeline/me", CANDS);
for (const c of CANDS) add("portal/journey", `/api/portal/journey?candidateId=${CANDIDATES[c]}`, [c]);
add("portal/journey", `/api/portal/journey?candidateId=${T_OUT}`, ["admin", "orgadmin"]);
add("portal/messages", "/api/portal/messages", ["c_msgs", "c_docs", "c_journey"]);
add("portal/messages/[id]/attachment", "/api/portal/messages/1633146d-9047-462a-8dbb-ea05cab33570/attachment", ["c_msgs", "c_docs"], { params: { id: "1633146d-9047-462a-8dbb-ea05cab33570" } });
add("portal/notifications/[id]/doc", "/api/portal/notifications/cb48a62d-9082-4828-81e3-6454319f98ea/doc", ["c_docs", "c_journey"], { params: { id: "cb48a62d-9082-4828-81e3-6454319f98ea" } });
add("portal/self-report", "/api/portal/self-report", ["c_docs", "c_journey"]);
add("portal/admin-photo", "/api/portal/admin-photo", ["c_docs"]);
add("portal/classroom/consent", "/api/portal/classroom/consent", ["c_docs", "c_journey"]);
add("portal/classroom/sessions", "/api/portal/classroom/sessions", ["c_docs", "admin"]);
add("portal/org/me", "/api/portal/org/me", ["orgadmin", "hqsub", "c_docs"], { expectedDiff: ORDER_TIES }); // link order; no UI reads this route
add("portal/org/candidates/[userId]", `/api/portal/org/candidates/${T_IN}`, ["orgadmin", "c_docs"], { params: { userId: T_IN } });
add("portal/org/candidates/[userId]", `/api/portal/org/candidates/${T_OUT}`, ["orgadmin"], { params: { userId: T_OUT } });
add("portal/dl-token", "/api/portal/dl-token", ["c_docs"]);

// ── cv / letter data loads ──
add("portal/cv/text", "/api/portal/cv/text", ["c_docs", "c_journey", "c_nopipe"]);
add("portal/cv/text", `/api/portal/cv/text?candidateId=${T_IN}`, ["admin", "orgadmin"]);
add("portal/letter-body", "/api/portal/letter-body", ["c_docs", "c_journey"]);
add("portal/letter-body", `/api/portal/letter-body?variant=visa&userId=${T_IN}`, ["admin"]);

// ── feed / community ──
add("portal/feed", "/api/portal/feed?page=0", ["c_docs", "c_journey", "admin", "orgadmin"]);
add("portal/feed", `/api/portal/feed?page=0&orgId=${ORG}`, ["c_docs", "admin"]);
add("portal/feed/communities", "/api/portal/feed/communities", ["c_docs", "c_journey", "admin"]);
add("portal/feed/unread", "/api/portal/feed/unread?since=2026-01-01T00:00:00.000Z", ["c_docs", "c_journey", "admin"]);
for (const post of ["513a28b1-686b-4a69-a75a-cf4f2a7eca24", "7b10a777-19cb-4e62-a623-bc5c7b7e3e5b"]) {
  add("portal/feed/[id]/comments", `/api/portal/feed/${post}/comments`, ["c_docs", "admin"], { params: { id: post } });
}

// ── public pages / token routes ──
add("health", "/api/health", [undefined]);
add("portal/shortlist/[token]", "/api/portal/shortlist/route-parity-not-a-token", [undefined], { params: { token: "route-parity-not-a-token" } });
add("affiliate/[token]", "/api/affiliate/route-parity-not-a-token", [undefined], { params: { token: "route-parity-not-a-token" } });
add("portal/u/[token]", "/api/portal/u/route-parity-not-a-token", [undefined], { params: { token: "route-parity-not-a-token" } });
cases.push({
  id: "/api/portal/calendar/feed/<signed> as public (c_docs feed)", module: mod("portal/calendar/feed/[token]"), url: "/api/portal/calendar/feed/x",
  prepare: async () => { const { signFeedToken } = await import("@/lib/calendarFeed"); const t = signFeedToken(CANDIDATES.c_docs); return { url: `/api/portal/calendar/feed/${t}`, params: { token: t } }; },
});
cases.push({
  id: "/api/portal/calendar/feed/<signed> as public (admin feed)", module: mod("portal/calendar/feed/[token]"), url: "/api/portal/calendar/feed/x",
  prepare: async (db) => {
    const { signFeedToken } = await import("@/lib/calendarFeed");
    const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const admin = data.users.find((u) => (u.email ?? "").toLowerCase() === (process.env.ADMIN_EMAIL ?? "").toLowerCase());
    const t = signFeedToken(admin?.id ?? "none");
    return { url: `/api/portal/calendar/feed/${t}`, params: { token: t } };
  },
});
for (const which of ["unused", "used"] as const) {
  cases.push({
    id: `/api/portal/invite/<${which} code> as public`, module: mod("portal/invite/[code]"), url: "/api/portal/invite/x",
    prepare: async (db) => {
      const q = db.from("invite_tokens").select("code").order("created_at", { ascending: false }).limit(1);
      const { data } = await (which === "used" ? q.not("used_by", "is", null) : q.is("used_by", null));
      const code = (data?.[0] as { code?: string } | undefined)?.code ?? "none";
      return { url: `/api/portal/invite/${code}`, params: { code } };
    },
  });
}
cases.push({
  id: "/api/p/<slug> as public (c_docs)", module: mod("p/[slug]"), url: "/api/p/x",
  prepare: async (db) => {
    const { buildProfileSlug } = await import("@/lib/profile-slug");
    const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", CANDIDATES.c_docs).maybeSingle();
    const slug = buildProfileSlug((data as any)?.first_name ?? "x", (data as any)?.last_name ?? "", CANDIDATES.c_docs);
    return { url: `/api/p/${slug}`, params: { slug } };
  },
});
add("p/[slug]", "/api/p/borivon", [undefined], { params: { slug: "borivon" } });

export const CASES: RouteCase[] = cases;

/**
 * GET handlers deliberately NOT run, and why. Kept here so the coverage claim
 * is checkable: every GET under app/api is either in CASES or in this list.
 */
export const SKIPPED: Record<string, string> = {
  "cron/*": "cron jobs send mail/Telegram and stamp reminded_at — their read halves are computed by tests/d1FeatureParity.test.ts",
  "calendar/google/callback": "OAuth code exchange (POST to Google) — no data read without a live consent",
  "calendar/google/connect": "builds a Google consent URL; no database read",
  "telegram/webhook-admin": "asks Telegram getWebhookInfo; no database read",
  "portal/admin/batch-drive-sync": "Drive connectivity probe; no database read",
  "portal/admin/rls-status": "probes Supabase RLS with the anon key — Supabase-only by design",
  "portal/admin/email-attachment": "streams a Gmail attachment (Gmail API); no database read",
  "storage/v1/object/public|sign": "serve R2 objects through the Worker binding — no R2 outside Workers (tests/r2StorageParity.test.ts covers them)",
  "portal/cv/visa": "renders through a .tsx React-PDF module the node test runtime cannot load (500 on both sides); its data is the /me/cv-draft + /cv/text read",
  "portal/cv/live-file | cv/preview-file | documents/merge-pdf | admin/passport-data-pdf | me/passport-data-pdf | qr | feed/gifs": "render or stream files from storage/R2 or call Giphy; their DB reads are the same rows /me/profile, /me/documents and /admin load",
  "r/[code]": "affiliate click redirect: increments affiliates.clicks (a write) — 0 affiliates in live data",
};
