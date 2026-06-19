/**
 * Read-only tools the Gemini admin assistant can call. EVERY tool:
 *   • is strictly READ-ONLY (there is no write/mutate/email/delete tool, so even
 *     prompt-injected text in a candidate's data can't change anything);
 *   • re-uses the EXISTING auth/scope helpers (canActOnCandidate, getVisibleCandidateIds
 *     via AssistantScope) so LAW #25 holds through the AI layer;
 *   • takes a fixed Zod-validated input (the model never emits SQL or column names);
 *   • returns plain JSON metadata + ids + (for one tool) a short-lived signed link —
 *     never raw document bytes / passport contents.
 */
import { tool } from "ai";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { canActOnCandidate, getStaffEmailSet, resolveAuthNames } from "@/lib/admin-auth";
import { resolveFileKey, translateDocLabel, FILE_KEY_LABELS } from "@/lib/fileKeys";
import { readWorkspaceCalendar, updateWorkspaceEvent, cancelWorkspaceEvent } from "@/lib/workspaceCalendar";
import { computeWeeklyReport } from "@/lib/weeklyReport";
import { specialtyLabel } from "@/lib/nurseSpecialties";
import { signDlToken } from "@/lib/dlToken";
import { UUID_RE } from "@/lib/uuid";
import { germanSummary } from "@/lib/b2Detail";
import { stripEmailFormatting } from "@/lib/emailFormat";
import { computeBriefing } from "@/lib/briefing";
import { localIsoToInstant, fmtWhen } from "@/lib/reminderTime";
import { computeChecklist } from "@/lib/candidateChecklist";
import { FUNNEL_STAGES, funnelLabel, type FunnelStageKey } from "@/lib/batchBoard";
import { stagePending, executeLatestPending, cancelLatestPending, prepareEmailDraft, getPendingDraft, MILESTONE_BOOL } from "@/lib/assistantWrites";
import { AUTOMATIONS, getAutomationFlags, setAutomation as persistAutomation, type AutomationKey } from "@/lib/automationSettings";
import { workspaceConfigured, workspaceServiceAccount, testWorkspace, WORKSPACE_SCOPES } from "@/lib/googleWorkspace";
import { gmailSearch, gmailGet, gmailApiReady, listEmailAttachments, listDraftAttachments, gmailGetThread, gmailModify, gmailTrash } from "@/lib/gmailApi";
import { getUsageSummary } from "@/lib/usage";
import { stopFollowupsFor } from "@/lib/followups";
import type { AssistantScope } from "@/lib/assistantScope";

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  b2_exam_date: string | null;
  passport_expiry: string | null;
  passport_status: string | null;
};
type DocRow = {
  id: string;
  file_name: string | null;
  file_type: string | null;
  status: string | null;
  uploaded_at: string | null;
  drive_file_id: string | null;
  r2_key: string | null;
};

const CV_KINDS = new Set(["cv_de", "cv_visa"]);

// Map a founder's free-text doc keyword → the canonical fileKey(s). Document
// file_types/filenames use GERMAN tokens (a passport is kind 'id', label "Reisepass"),
// so a raw substring filter for "passport" silently missed it — the "pull worked but
// I can't find the passport" inconsistency. With this, "passport"/"diploma"/"cv"/
// "contract"/"vaccine"/"B2" resolve to the right doc regardless of stored language.
const DOC_KIND_SYNONYMS: Record<string, string[]> = {
  passport: ["id"], reisepass: ["id"], passeport: ["id"], "passport id": ["id"],
  diploma: ["diploma", "diploma_de"], diplom: ["diploma", "diploma_de"], pflegediplom: ["diploma", "diploma_de"],
  cv: ["cv_de", "cv_visa"], lebenslauf: ["cv_de", "cv_visa"], resume: ["cv_de", "cv_visa"],
  b2: ["langcert"], language: ["langcert"], sprachzertifikat: ["langcert"], langcert: ["langcert"], "language certificate": ["langcert"],
  contract: ["arbeitsvertrag"], arbeitsvertrag: ["arbeitsvertrag"], vertrag: ["arbeitsvertrag"], "employment contract": ["arbeitsvertrag"],
  vaccine: ["impfung", "impfung_de"], vaccination: ["impfung", "impfung_de"], impfung: ["impfung", "impfung_de"], impfnachweis: ["impfung", "impfung_de"],
  transcript: ["transcript", "transcript_de"], notenblatt: ["transcript", "transcript_de"],
  workcert: ["workcert", "workcert_de"], arbeitszeugnis: ["workcert", "workcert_de"], "work certificate": ["workcert", "workcert_de"],
  anerkennung: ["defizitbescheid", "ezb", "vorabzustimmung"], recognition: ["defizitbescheid", "ezb", "vorabzustimmung"], defizitbescheid: ["defizitbescheid"],
};

/** Does a document match the founder's free-text filter — a direct substring hit on
 *  its label/filename/kind, OR a keyword→fileKey synonym (so "passport" finds the
 *  German-labelled 'id' doc). Empty needle ⇒ matches everything. */
function docMatchesFilter(label: string, fileName: string | null | undefined, kind: string, needle: string): boolean {
  const n = (needle ?? "").trim().toLowerCase();
  if (!n) return true;
  if (`${label} ${fileName ?? ""} ${kind}`.toLowerCase().includes(n)) return true;
  for (const [syn, keys] of Object.entries(DOC_KIND_SYNONYMS)) {
    if (n.includes(syn) && keys.includes(kind)) return true;
  }
  return false;
}
const DAY = 86_400_000;

const nameOf = (r: { first_name: string | null; last_name: string | null }): string =>
  [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "—";

/** Parse "DD.MM.YYYY" (OCR/German) or ISO "YYYY-MM-DD" → epoch ms, or null. Mirrors expiry-radar. */
function parseDate(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  const de = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (de) return Date.UTC(+de[3], +de[2] - 1, +de[1]);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function buildAssistantTools(
  scope: AssistantScope,
  // Set ONLY on the Telegram path when the admin attached a photo/document — the
  // already-staged-to-R2 file's reference. Undefined everywhere else (the in-app
  // assistant), so storeCandidateDocument returns no_file there.
  pendingFile?: { r2Key: string; mime: string; fileName: string; sha256: string },
) {
  const db = getServiceSupabase();
  const lockedOut = scope.visibleIds !== null && scope.visibleIds.length === 0;

  // id → authoritative display name. A candidate's real name is set at
  // registration in auth.users.user_metadata.full_name; candidate_profiles
  // first/last is often EMPTY (only filled via the CV builder). Resolve names
  // from auth so the bot finds people by the name the admin actually sees.
  async function authNameMap(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const want = new Set(ids);
    for (let page = 1; page <= 20; page++) {
      const { data: u, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error || !u?.users?.length) break;
      for (const usr of u.users) {
        if (!want.has(usr.id)) continue;
        const fn = ((usr.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim();
        out.set(usr.id, fn || usr.email || "");
      }
      if (u.users.length < 1000) break;
    }
    return out;
  }

  // One candidate's display name for a confirm summary: profile name → auth
  // full_name → email. Same fallback the message/store tools use inline.
  async function displayName(candidateUserId: string): Promise<string> {
    const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", candidateUserId).maybeSingle();
    let name = data ? nameOf(data as { first_name: string | null; last_name: string | null }) : "—";
    if (name === "—") {
      try {
        const { data: u } = await db.auth.admin.getUserById(candidateUserId);
        const fn = ((u?.user?.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim();
        name = fn || u?.user?.email || "this candidate";
      } catch { name = "this candidate"; }
    }
    return name;
  }

  // The full candidate roster the caller may see: candidate_profiles in scope,
  // minus staff, with names resolved (profile name → auth full_name → email).
  // This is the SAME candidate set the pipeline board uses, but with working names.
  async function candidateRoster(): Promise<{ userId: string; name: string }[]> {
    if (lockedOut) return [];
    // Try selecting is_test_account so we can hide TEST accounts from EVERY roster-based
    // tool (search, list-all, counts, funnel, dossier, doc/profile finders). If the
    // column isn't migrated yet, fall back to the base select so the bot still works.
    type Prof = { user_id: string; first_name: string | null; last_name: string | null; is_test_account?: boolean | null };
    let rows: Prof[] = [];
    let q = db.from("candidate_profiles").select("user_id, first_name, last_name, is_test_account");
    if (scope.visibleIds !== null) q = q.in("user_id", scope.visibleIds);
    const r1 = await q;
    if (r1.error) {
      let q2 = db.from("candidate_profiles").select("user_id, first_name, last_name");
      if (scope.visibleIds !== null) q2 = q2.in("user_id", scope.visibleIds);
      const r2 = await q2;
      if (r2.error) return [];
      rows = (r2.data ?? []) as Prof[];
    } else {
      rows = (r1.data ?? []) as Prof[];
    }
    const profs = rows.filter((p) => p.is_test_account !== true); // drop test accounts
    if (profs.length === 0) return [];
    const profById = new Map(profs.map((p) => [p.user_id, p] as const));
    const want = new Set(profs.map((p) => p.user_id));
    const staffEmails = await getStaffEmailSet(); // exclude admin/sub-admins/org members
    const roster: { userId: string; name: string }[] = [];
    for (let page = 1; page <= 20; page++) {
      const { data: u, error: uerr } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (uerr || !u?.users?.length) break;
      for (const usr of u.users) {
        if (!want.has(usr.id) || !scope.inScope(usr.id)) continue;
        const email = (usr.email ?? "").trim().toLowerCase();
        if (email && staffEmails.has(email)) continue; // candidates only
        const p = profById.get(usr.id);
        const profName = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
        const authName = ((usr.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim();
        roster.push({ userId: usr.id, name: profName || authName || usr.email || "—" });
      }
      if (u.users.length < 1000) break;
    }
    return roster;
  }

  // Resolve ONE admin-supplied identifier (a candidateUserId or a name) against
  // the roster. Exact full-name match wins; else require EVERY token of the
  // query to appear in the name — so "Hajar El Kairaa" pins one person while a
  // bare "Hajar" (shared by several) returns ambiguous instead of a wrong guess.
  type PickResult =
    | { status: "ok"; candidate: { userId: string; name: string } }
    | { status: "ambiguous"; matches: { userId: string; name: string }[] }
    | { status: "not_found" };
  function pickCandidate(roster: { userId: string; name: string }[], raw: string): PickResult {
    const q = (raw ?? "").trim();
    if (!q) return { status: "not_found" };
    let matches: { userId: string; name: string }[];
    if (UUID_RE.test(q)) {
      matches = roster.filter((c) => c.userId === q);
    } else {
      const needle = q.toLowerCase();
      const exact = roster.filter((c) => c.name.toLowerCase() === needle);
      const toks = needle.split(/\s+/).filter(Boolean);
      matches = exact.length ? exact : roster.filter((c) => {
        const n = c.name.toLowerCase();
        return toks.every((tk) => n.includes(tk));
      });
    }
    if (matches.length === 0) return { status: "not_found" };
    if (matches.length > 1) return { status: "ambiguous", matches: matches.slice(0, 6) };
    return { status: "ok", candidate: matches[0] };
  }

  return {
    searchCandidates: tool({
      description:
        "Find candidates by name (first or last, partial is fine). Matches the name on their ACCOUNT, so it works even when their profile name field is empty. Returns the candidates you may see, each with a candidateUserId for other tools. Use this to find a person before looking up details or documents.",
      inputSchema: z.object({
        query: z.string().min(1).max(120).describe("name or partial name"),
        limit: z.number().int().min(1).max(50).default(15),
      }),
      execute: async ({ query, limit }) => {
        if (lockedOut) return { candidates: [] };
        const needle = query.trim().toLowerCase();
        const roster = await candidateRoster();
        const rows = roster
          .filter((c) => c.name.toLowerCase().includes(needle))
          .slice(0, limit ?? 15)
          .map((c) => ({ candidateUserId: c.userId, name: c.name }));
        return { candidates: rows };
      },
    }),

    listAllCandidates: tool({
      description:
        "List EVERY candidate you can see (name + candidateUserId), alphabetically. Use whenever the admin asks to 'list all candidates', 'all the names we have', 'who do we have', or wants the full roster. Returns the total count and the list (capped at 300).",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(300).default(300),
      }),
      execute: async ({ limit }) => {
        if (lockedOut) return { total: 0, candidates: [] };
        const roster = await candidateRoster();
        roster.sort((a, b) => a.name.localeCompare(b.name));
        return {
          total: roster.length,
          candidates: roster.slice(0, limit ?? 300).map((c) => ({ candidateUserId: c.userId, name: c.name })),
        };
      },
    }),

    listB2ExamsDue: tool({
      description:
        "List candidates whose B2 German exam date falls within the next N days (default 90 ≈ 3 months), soonest first. Use for questions like 'who has their B2 coming up in the next 3 months'. Negative daysUntil means the exam date is already past.",
      inputSchema: z.object({
        withinDays: z.number().int().min(1).max(366).default(90),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ withinDays, limit }) => {
        if (lockedOut) return { candidates: [] };
        let qb = db
          .from("candidate_profiles")
          .select("user_id, first_name, last_name, b2_exam_date")
          .not("b2_exam_date", "is", null);
        if (scope.visibleIds !== null) qb = qb.in("user_id", scope.visibleIds);
        const { data, error } = await qb;
        if (error) return { error: "load_failed" };
        const now = Date.now();
        const horizon = now + (withinDays ?? 90) * DAY;
        const picked = ((data ?? []) as ProfileRow[])
          .filter((r) => scope.inScope(r.user_id))
          .map((r) => ({ r, ms: parseDate(r.b2_exam_date) }))
          .filter((x): x is { r: ProfileRow; ms: number } => x.ms !== null && x.ms <= horizon)
          .sort((a, b) => a.ms - b.ms)
          .slice(0, limit ?? 20);
        // Fill in any missing names from the auth account (profile names are often empty).
        const fallback = await authNameMap(picked.filter((x) => nameOf(x.r) === "—").map((x) => x.r.user_id));
        const rows = picked.map((x) => ({
          candidateUserId: x.r.user_id,
          name: nameOf(x.r) === "—" ? (fallback.get(x.r.user_id) || "—") : nameOf(x.r),
          b2ExamDate: x.r.b2_exam_date,
          daysUntil: Math.round((x.ms - now) / DAY),
        }));
        return { candidates: rows };
      },
    }),

    getCandidateById: tool({
      description:
        "Get the FULL profile for ONE candidate by candidateUserId: name, EMAIL, phone-less core + B2 exam date + passport status, PLUS every identity/passport field — passport number, date of birth, sex, nationality, full address, city & country of birth, marital status, children, issuing authority, passport issue & expiry dates. USE THIS for 'what's X's passport number / date of birth / nationality / address / email / marital status' — the answer is here, never say you can't find it. Returns { error: 'out_of_scope' } if you are not allowed to see them.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db
          .from("candidate_profiles")
          .select("user_id, first_name, last_name, b2_exam_date, passport_expiry, passport_status, dob, sex, nationality, passport_no, issue_date, issuing_authority, city_of_birth, country_of_birth, address_street, address_number, address_postal, city_of_residence, country_of_residence, marital_status, children_ages")
          .eq("user_id", candidateUserId)
          .maybeSingle();
        if (error) return { error: "load_failed" };
        if (!data) return { error: "not_found" };
        const r = data as {
          user_id: string; first_name: string | null; last_name: string | null;
          b2_exam_date: string | null; passport_expiry: string | null; passport_status: string | null;
          dob: string | null; sex: string | null; nationality: string | null; passport_no: string | null;
          issue_date: string | null; issuing_authority: string | null;
          city_of_birth: string | null; country_of_birth: string | null;
          address_street: string | null; address_number: string | null; address_postal: string | null;
          city_of_residence: string | null; country_of_residence: string | null;
          marital_status: string | null; children_ages: string | null;
        };
        let name = nameOf(r);
        // Always resolve the account email; also use it (or the auth full_name) as the
        // name fallback when the profile name is empty.
        let email: string | null = null;
        try {
          const { data: u } = await db.auth.admin.getUserById(candidateUserId);
          email = u?.user?.email ?? null;
          if (name === "—") {
            const fn = ((u?.user?.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim();
            name = fn || email || "—";
          }
        } catch { /* email/name best-effort */ }
        return {
          candidate: {
            candidateUserId: r.user_id,
            name,
            email,
            b2ExamDate: r.b2_exam_date,
            passportStatus: r.passport_status,
            identity: {
              dob: r.dob,
              sex: r.sex,
              nationality: r.nationality,
              passportNo: r.passport_no,
              passportIssueDate: r.issue_date,
              passportExpiry: r.passport_expiry,
              issuingAuthority: r.issuing_authority,
              cityOfBirth: r.city_of_birth,
              countryOfBirth: r.country_of_birth,
              addressStreet: r.address_street,
              addressNumber: r.address_number,
              addressPostal: r.address_postal,
              cityOfResidence: r.city_of_residence,
              countryOfResidence: r.country_of_residence,
              maritalStatus: r.marital_status,
              childrenAges: r.children_ages,
            },
          },
        };
      },
    }),

    listCandidateCVs: tool({
      description:
        "List a candidate's CV documents (German CV and visa CV) with a docId for each that you can pass to getDocumentDownloadLink. Returns { error: 'out_of_scope' } if you are not allowed to see this candidate.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db
          .from("documents")
          .select("id, file_name, file_type, status, uploaded_at, drive_file_id, r2_key")
          .eq("user_id", candidateUserId);
        if (error) return { error: "load_failed" };
        const cvs = ((data ?? []) as DocRow[])
          .filter((d) => CV_KINDS.has(resolveFileKey(d.file_type)))
          .map((d) => ({
            docId: d.id,
            fileName: d.file_name ?? "CV",
            kind: resolveFileKey(d.file_type),
            status: d.status,
            uploadedAt: d.uploaded_at,
          }));
        return { cvs };
      },
    }),

    listCandidateDocuments: tool({
      description:
        "List ALL of a candidate's documents — passport, diploma, nursing certificate, recognition (Anerkennung) paperwork, employment contract, CVs, and any other uploaded PDF — each with a docId you pass to getDocumentDownloadLink, a human label, and its status. Use this whenever the admin asks to SEE, SEND, PULL, or DOWNLOAD any document (not just a CV). Optionally pass `filter` (e.g. 'passport', 'diploma') to narrow the list. Returns { error: 'out_of_scope' } if you are not allowed to see this candidate — don't guess in that case.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        filter: z.string().max(60).optional().describe("optional keyword to match against the document name/type, e.g. 'passport' or 'diploma'"),
      }),
      execute: async ({ candidateUserId, filter }) => {
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db
          .from("documents")
          .select("id, file_name, file_type, status, uploaded_at, drive_file_id, r2_key")
          .eq("user_id", candidateUserId)
          .order("uploaded_at", { ascending: false });
        if (error) return { error: "load_failed" };
        const needle = (filter ?? "").trim().toLowerCase();
        const documents = ((data ?? []) as DocRow[])
          .map((d) => {
            const label = translateDocLabel(d.file_type, "de") || d.file_type || d.file_name || "Dokument";
            return {
              docId: d.id,
              name: label,
              fileName: d.file_name ?? label,
              kind: resolveFileKey(d.file_type),
              status: d.status,
              uploadedAt: d.uploaded_at,
            };
          })
          .filter((d) => docMatchesFilter(d.name, d.fileName, d.kind, needle));
        return { documents };
      },
    }),

    getDocumentDownloadLink: tool({
      description:
        "Deliver one document (by its docId) to the chat as the ACTUAL file — the system sends it right below your message. Do NOT mention a 'link' or that anything 'expires' (there is no link to share — the file itself arrives). Returns { error: 'out_of_scope' } if you are not allowed to access that candidate's document.",
      inputSchema: z.object({ docId: z.string().uuid() }),
      execute: async ({ docId }) => {
        const { data: doc, error } = await db
          .from("documents")
          .select("id, user_id, file_name, file_type, drive_file_id")
          .eq("id", docId)
          .maybeSingle();
        if (error) return { error: "load_failed" };
        if (!doc) return { error: "not_found" };
        const d = doc as { id: string; user_id: string; file_name: string | null; file_type: string | null; drive_file_id: string | null };
        if (!(await canActOnCandidate(scope.role, scope.email, d.user_id))) return { error: "out_of_scope" };
        // Token carries the ADMIN's id (not the candidate's). /api/portal/file
        // re-runs roleByUserId + canActOnCandidate, so scope is re-enforced at
        // serve time and the link grants no API authority on its own (lib/dlToken).
        const token = signDlToken(scope.userId, 600); // 10 min — webhook delivers files AFTER the model run; 180s expired the tail of big batches (B7)
        // If this doc is a CV, serve the LIVE render from cv_draft (matches the
        // website now) instead of the stored snapshot — same freshness guarantee
        // as getCvLinks. Other docs (passport, diploma, certs) are uploaded files,
        // so the stored one IS the current version.
        const kind = resolveFileKey(d.file_type);
        if (CV_KINDS.has(kind)) {
          const { data: prof } = await db.from("candidate_profiles").select("cv_draft").eq("user_id", d.user_id).maybeSingle();
          let draft = (prof as { cv_draft?: unknown } | null)?.cv_draft as unknown;
          if (typeof draft === "string") { try { draft = JSON.parse(draft); } catch { draft = null; } }
          const cd = (draft && typeof draft === "object" ? draft : null) as { firstName?: string; lastName?: string } | null;
          if (cd && (cd.firstName || cd.lastName)) {
            const name = encodeURIComponent((d.file_name ?? "lebenslauf.pdf").slice(0, 180));
            const plain = kind === "cv_visa" ? "&plain=1" : "";
            const url = `/api/portal/cv/live-file?cand=${encodeURIComponent(d.user_id)}&dlt=${encodeURIComponent(token)}&dl=1${plain}&name=${name}`;
            return { url, expiresInSec: 600, fileName: d.file_name ?? "lebenslauf.pdf", live: true };
          }
        }
        const name = encodeURIComponent((d.file_name ?? "document").slice(0, 180));
        const idPart = d.drive_file_id
          ? `id=${encodeURIComponent(d.drive_file_id)}`
          : `docId=${encodeURIComponent(d.id)}`;
        const url = `/api/portal/file?${idPart}&dlt=${encodeURIComponent(token)}&dl=1&name=${name}`;
        return { url, expiresInSec: 600, fileName: d.file_name ?? "document" };
      },
    }),

    getCvLinks: tool({
      description:
        "Pull the CVs of MANY candidates AT ONCE — use this WHENEVER the admin asks for the CVs of two or more people (e.g. 'CVs of Ismail Louali, Samira Irsani, Hajar El Kairaa and Lahcen Labzioui'). Pass `candidates` = the FULL names exactly as the admin gave them (a candidateUserId also works). It resolves every name, finds each one's latest CV, and returns one entry per request — the bot delivers each found CV file straight into the chat. ALWAYS use this for multi-person CV requests instead of calling searchCandidates + getDocumentDownloadLink one person at a time. Per-entry status: 'ok' (link delivered), 'ambiguous' (name matched several people — show the matches and ask which), 'no_cv' (no CV on file), 'not_found'. Links expire in 3 minutes.",
      inputSchema: z.object({
        candidates: z.array(z.string().min(1).max(120)).min(1).max(15).describe("the candidates' full names (or candidateUserIds), one per person the admin asked for"),
      }),
      execute: async ({ candidates }) => {
        if (lockedOut) return { results: [] };
        const roster = await candidateRoster();
        const results: Array<Record<string, unknown>> = [];
        for (const raw of candidates) {
          if (!(raw ?? "").trim()) continue;
          const m = pickCandidate(roster, raw);
          if (m.status === "not_found") { results.push({ query: raw, status: "not_found" }); continue; }
          if (m.status === "ambiguous") {
            results.push({ query: raw, status: "ambiguous", matches: m.matches.map((x) => ({ candidateUserId: x.userId, name: x.name })) });
            continue;
          }
          const cand = m.candidate;
          // PREFER the LIVE CV — rendered fresh from cv_draft (exactly what's on the
          // website right now), so a recent edit that wasn't re-published is still
          // reflected. Fall back to the stored CV document only if there's no draft.
          const { data: prof } = await db
            .from("candidate_profiles").select("cv_draft").eq("user_id", cand.userId).maybeSingle();
          let draft = (prof as { cv_draft?: unknown } | null)?.cv_draft as unknown;
          if (typeof draft === "string") { try { draft = JSON.parse(draft); } catch { draft = null; } }
          const d = (draft && typeof draft === "object" ? draft : null) as { firstName?: string; lastName?: string } | null;
          if (d && (d.firstName || d.lastName)) {
            const fn = String(d.firstName ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "kandidat";
            const ln = String(d.lastName ?? "").trim().toLowerCase().replace(/\s+/g, "_") || "unbekannt";
            const fileName = `${fn}_${ln}_pflegekraft_lebenslauf.pdf`;
            const token = signDlToken(scope.userId, 600); // 10 min — webhook delivers files AFTER the model run; 180s expired the tail of big batches (B7)
            const url = `/api/portal/cv/live-file?cand=${encodeURIComponent(cand.userId)}&dlt=${encodeURIComponent(token)}&dl=1&name=${encodeURIComponent(fileName)}`;
            results.push({ query: raw, name: cand.name, status: "ok", url, fileName, kind: "cv_de", live: true });
            continue;
          }
          const { data: docs } = await db
            .from("documents")
            .select("id, file_name, file_type, status, uploaded_at, drive_file_id, r2_key")
            .eq("user_id", cand.userId)
            .order("uploaded_at", { ascending: false });
          const cv = ((docs ?? []) as DocRow[]).find((d2) => CV_KINDS.has(resolveFileKey(d2.file_type)));
          if (!cv) { results.push({ query: raw, name: cand.name, status: "no_cv" }); continue; }
          const token = signDlToken(scope.userId, 600); // 10 min — webhook delivers files AFTER the model run; 180s expired the tail of big batches (B7)
          const fname = encodeURIComponent((cv.file_name ?? `${cand.name} CV`).slice(0, 180));
          const idPart = cv.drive_file_id ? `id=${encodeURIComponent(cv.drive_file_id)}` : `docId=${encodeURIComponent(cv.id)}`;
          const url = `/api/portal/file?${idPart}&dlt=${encodeURIComponent(token)}&dl=1&name=${fname}`;
          results.push({ query: raw, name: cand.name, status: "ok", url, fileName: cv.file_name ?? `${cand.name} CV`, kind: resolveFileKey(cv.file_type) });
        }
        return { results };
      },
    }),

    getAllCandidateDocuments: tool({
      description:
        "Deliver EVERY document a candidate has, all at once, by candidateUserId — passport, diploma, nursing cert, Anerkennung paperwork, contract, CVs, B2 cert, Impfung, anything. USE THIS for 'send me ALL of X's documents', 'everything on X', 'her whole file', 'all his papers'. The files are delivered straight into the chat — do NOT call getDocumentDownloadLink one at a time. Optional `filter` (e.g. 'passport', 'diploma') narrows it. Returns { results:[{docId,url,fileName,kind,status,uploadedAt}] }. out_of_scope if you can't see this candidate.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        filter: z.string().max(60).optional().describe("optional keyword to narrow, e.g. 'passport' or 'diploma'"),
      }),
      execute: async ({ candidateUserId, filter }) => {
        if (lockedOut) return { results: [] };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db
          .from("documents")
          .select("id, file_name, file_type, status, uploaded_at, drive_file_id, r2_key")
          .eq("user_id", candidateUserId)
          .order("uploaded_at", { ascending: false });
        if (error) return { error: "load_failed" };
        const needle = (filter ?? "").trim().toLowerCase();
        let rows = (data ?? []) as DocRow[];
        if (needle) rows = rows.filter((d) => docMatchesFilter(d.file_type ?? "", d.file_name, resolveFileKey(d.file_type), needle));
        rows = rows.slice(0, 25); // generous cap; the webhook streams each file in
        if (rows.length === 0) return { results: [] };
        // One admin token serves every file (re-checked at /api/portal/file serve time).
        const token = signDlToken(scope.userId, 600); // 10 min — webhook delivers files AFTER the model run; 180s expired the tail of big batches (B7)
        // CVs render LIVE from cv_draft (same freshness as getCvLinks) — read the draft once.
        const { data: prof } = await db.from("candidate_profiles").select("cv_draft").eq("user_id", candidateUserId).maybeSingle();
        let draft = (prof as { cv_draft?: unknown } | null)?.cv_draft as unknown;
        if (typeof draft === "string") { try { draft = JSON.parse(draft); } catch { draft = null; } }
        const cd = (draft && typeof draft === "object" ? draft : null) as { firstName?: string; lastName?: string } | null;
        const hasDraftName = !!(cd && (cd.firstName || cd.lastName));
        const results = rows.map((d) => {
          const kind = resolveFileKey(d.file_type);
          const fileName = d.file_name ?? `${kind || "dokument"}.pdf`;
          const nm = encodeURIComponent(fileName.slice(0, 180));
          let url: string;
          if (CV_KINDS.has(kind) && hasDraftName) {
            const plain = kind === "cv_visa" ? "&plain=1" : "";
            url = `/api/portal/cv/live-file?cand=${encodeURIComponent(candidateUserId)}&dlt=${encodeURIComponent(token)}&dl=1${plain}&name=${nm}`;
          } else {
            const idPart = d.drive_file_id ? `id=${encodeURIComponent(d.drive_file_id)}` : `docId=${encodeURIComponent(d.id)}`;
            url = `/api/portal/file?${idPart}&dlt=${encodeURIComponent(token)}&dl=1&name=${nm}`;
          }
          return { docId: d.id, url, fileName, kind, status: d.status, uploadedAt: d.uploaded_at };
        });
        return { results };
      },
    }),

    findDocumentsAcrossCandidates: tool({
      description:
        "Roster-wide document query (NOT one candidate). USE for 'who's missing a diploma', 'every pending passport waiting for review', 'how many docs are waiting for review', 'which candidates haven't uploaded their B2 cert'. status: 'pending'|'approved'|'rejected' filters uploaded docs; 'missing' returns candidates who have NO document of that kind (or no docs at all if kind omitted). Optional kind keyword (e.g. 'passport','diploma','langcert','contract'). Read-only, scoped to the candidates you can see. For a 'pending' hit, returns docId so you can chain reviewDocument.",
      inputSchema: z.object({
        kind: z.string().max(60).optional().describe("doc kind/keyword, e.g. 'passport' or 'diploma'"),
        status: z.enum(["pending", "approved", "rejected", "missing"]).optional(),
        limit: z.number().int().min(1).max(200).default(60),
      }),
      execute: async ({ kind, status, limit }) => {
        if (lockedOut) return { results: [] };
        const roster = await candidateRoster();
        if (roster.length === 0) return { results: [] };
        const nameById = new Map(roster.map((r) => [r.userId, r.name] as const));
        const ids = roster.map((r) => r.userId);
        const { data, error } = await db
          .from("documents")
          .select("id, user_id, file_name, file_type, status, uploaded_at")
          .in("user_id", ids)
          .order("uploaded_at", { ascending: false });
        if (error) return { error: "load_failed" };
        const needle = (kind ?? "").trim().toLowerCase();
        type Row = { id: string; user_id: string; file_name: string | null; file_type: string | null; status: string | null; uploaded_at: string | null };
        let docs = (data ?? []) as Row[];
        if (needle) docs = docs.filter((d) => docMatchesFilter(d.file_type ?? "", d.file_name, resolveFileKey(d.file_type), needle));
        if (status === "missing") {
          const have = new Set(docs.map((d) => d.user_id)); // user_ids WITH a (kind-matching) doc
          const results = roster
            .filter((c) => !have.has(c.userId))
            .slice(0, limit)
            .map((c) => ({ candidateUserId: c.userId, name: c.name, status: "missing" as const, kind: needle || "any" }));
          return { results, count: results.length };
        }
        if (status) docs = docs.filter((d) => (d.status ?? "") === status);
        const results = docs.slice(0, limit).map((d) => ({
          candidateUserId: d.user_id,
          name: nameById.get(d.user_id) ?? "—",
          docId: d.id,
          fileName: d.file_name ?? "Dokument",
          kind: resolveFileKey(d.file_type),
          status: d.status,
          uploadedAt: d.uploaded_at,
        }));
        return { results, count: results.length };
      },
    }),

    getCandidateDossier: tool({
      description:
        "ONE call = the WHOLE file on a candidate. USE for 'tell me everything about X', 'brief me on X', 'her full status', 'X's whole file', 'give me everything on X'. Accepts a NAME or a candidateUserId. Returns identity + email + B2 + the full pipeline (milestones, funnel stage, interview dates) + document counts — so you NEVER chain 8 separate calls. Per-result: 'ambiguous' (show the matches and ask which) or 'not_found', like getB2Status. out_of_scope if you can't see them.",
      inputSchema: z.object({ candidate: z.string().min(1).max(120).describe("the candidate's full name or candidateUserId") }),
      execute: async ({ candidate }) => {
        if (lockedOut) return { error: "out_of_scope" };
        const roster = await candidateRoster();
        const m = pickCandidate(roster, candidate);
        if (m.status === "not_found") return { status: "not_found" };
        if (m.status === "ambiguous") return { status: "ambiguous", matches: m.matches.map((x) => ({ candidateUserId: x.userId, name: x.name })) };
        const id = m.candidate.userId;
        if (!(await canActOnCandidate(scope.role, scope.email, id))) return { error: "out_of_scope" };
        const [profRes, pipeRes, docRes, authRes, memRes] = await Promise.all([
          db.from("candidate_profiles").select("b2_exam_date, passport_status, passport_expiry, passport_no, dob, sex, nationality, issue_date, issuing_authority, address_street, address_number, address_postal, city_of_residence, country_of_residence, city_of_birth, country_of_birth, marital_status, children_ages").eq("user_id", id).maybeSingle(),
          db.from("candidate_pipeline").select("*").eq("user_id", id).maybeSingle(),
          db.from("documents").select("status").eq("user_id", id),
          db.auth.admin.getUserById(id).catch(() => null),
          db.from("academy_cohort_members").select("cohort_id, current_level, status").eq("candidate_user_id", id).eq("status", "active").maybeSingle(),
        ]);
        const p = (profRes.data ?? {}) as Record<string, string | null>;
        const email = (authRes && "data" in authRes ? authRes.data?.user?.email : null) ?? null;
        const docs = (docRes.data ?? []) as { status: string | null }[];
        // Academy progress (so "tell me everything" truly includes the school) — best-effort.
        let academy: { enrolled: boolean; cohort?: string | null; level?: string | null; attendanceRatePct?: number | null; score?: number | null } = { enrolled: false };
        const mem = (memRes.data ?? null) as { cohort_id?: string; current_level?: string } | null;
        if (mem) {
          let cohortName: string | null = null;
          if (mem.cohort_id) { const { data: c } = await db.from("academy_cohorts").select("name").eq("id", mem.cohort_id).maybeSingle(); cohortName = (c as { name?: string } | null)?.name ?? null; }
          let rel: { attendanceRate: number; score: number } | null = null;
          try { const { getReliability } = await import("@/lib/academyPoints"); rel = await getReliability(id); } catch { /* best-effort */ }
          academy = { enrolled: true, cohort: cohortName, level: mem.current_level ?? null, attendanceRatePct: rel ? Math.round(rel.attendanceRate * 100) : null, score: rel ? rel.score : null };
        }
        return {
          candidate: {
            candidateUserId: id,
            name: m.candidate.name,
            email,
            b2ExamDate: p.b2_exam_date ?? null,
            passportStatus: p.passport_status ?? null,
            identity: {
              dob: p.dob ?? null, sex: p.sex ?? null, nationality: p.nationality ?? null,
              passportNo: p.passport_no ?? null, passportIssueDate: p.issue_date ?? null, passportExpiry: p.passport_expiry ?? null,
              issuingAuthority: p.issuing_authority ?? null,
              address: [p.address_street, p.address_number, p.address_postal, p.city_of_residence, p.country_of_residence].filter(Boolean).join(" ") || null,
              cityOfBirth: p.city_of_birth ?? null, countryOfBirth: p.country_of_birth ?? null,
              maritalStatus: p.marital_status ?? null, childrenAges: p.children_ages ?? null,
            },
            pipeline: pipeRes.data ?? null,
            documents: {
              total: docs.length,
              pending: docs.filter((d) => d.status === "pending").length,
              approved: docs.filter((d) => d.status === "approved").length,
              rejected: docs.filter((d) => d.status === "rejected").length,
            },
            academy,
          },
        };
      },
    }),

    findContactEmail: tool({
      description:
        "Find a PERSON's email by name — for 'what's Anna's email', 'what's the recruiter's address', or to grab a recipient before emailing. Checks THREE sources in order: (1) contacts you've been taught (rememberAboutMe kind 'contact'), (2) the candidate roster (their account email), (3) your Gmail inbox (someone who has emailed you — pulled off the sender header). Returns { contacts:[{name,email,source}] } — empty only if truly nowhere, in which case ask the founder for it; never invent one. Supreme-only.",
      inputSchema: z.object({ name: z.string().min(2).max(120) }),
      execute: async ({ name }) => {
        if (scope.role !== "admin" || !scope.userId) return { error: "admin_only" };
        const toks = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
        const out: { name: string; email: string; source: string }[] = [];
        const seen = new Set<string>();
        const add = (nm: string, em: string, src: string) => {
          const e = em.trim().toLowerCase();
          if (e && !seen.has(e)) { seen.add(e); out.push({ name: nm.trim() || name, email: em.trim(), source: src }); }
        };
        // 1) Taught contacts (assistant_memory kind 'contact', e.g. "Anna Gombert = a@x.de").
        try {
          const { data } = await db.from("assistant_memory").select("text").eq("owner_user_id", scope.userId).eq("kind", "contact").limit(300);
          for (const r of ((data ?? []) as { text: string }[])) {
            const t = r.text ?? "";
            if (toks.every((tk) => t.toLowerCase().includes(tk))) {
              const em = t.match(EMAIL_RE);
              if (em) add(t.split(/[=:]/)[0], em[0], "saved contact");
            }
          }
        } catch { /* best-effort */ }
        // 2) Candidates (their account email).
        try {
          const matches = await candidateRoster();
          const hits = matches.filter((c) => { const n = c.name.toLowerCase(); return toks.every((tk) => n.includes(tk)); }).slice(0, 5);
          for (const c of hits) {
            try { const { data: u } = await db.auth.admin.getUserById(c.userId); if (u?.user?.email) add(c.name, u.user.email, "candidate"); } catch { /* skip */ }
          }
        } catch { /* best-effort */ }
        // 3) Gmail inbox fallback — an EXTERNAL person (recruiter, employer) who has
        // emailed the founder but was never saved as a contact. Only when nothing else
        // matched, to keep it cheap. Pull their address off the sender header.
        if (out.length === 0 && gmailApiReady()) {
          try {
            const hits = await gmailSearch(`from:(${name})`, 15);
            for (const h of (hits ?? [])) {
              if (!h.from) continue;
              const hay = `${h.fromName ?? ""} ${h.from}`.toLowerCase();
              if (toks.every((tk) => hay.includes(tk))) add(h.fromName || h.from, h.from, "inbox");
            }
          } catch { /* best-effort */ }
        }
        return { contacts: out };
      },
    }),

    listMyCalendar: tool({
      description:
        "Read the FOUNDER'S OWN Google Calendar (the one he actually looks at). USE for 'what's on my calendar', 'what do I have today/tomorrow/this week', 'any meetings Thursday', 'my schedule'. Optional from/to (local ISO) — default is today → +7 days. Optional query to filter by text. Returns upcoming events with times, location, Meet link, and attendees. Read-only, supreme-only. NOTE: this is the founder's PERSONAL Google Calendar — NOT listCalendarEvents (which is the portal's candidate-facing community events).",
      inputSchema: z.object({
        from: z.string().max(40).optional().describe("start of window, local ISO e.g. 2026-06-18T00:00:00 (default: now)"),
        to: z.string().max(40).optional().describe("end of window (default: +7 days)"),
        query: z.string().max(120).optional(),
        max: z.number().int().min(1).max(50).default(25),
      }),
      execute: async ({ from, to, query, max }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const res = await readWorkspaceCalendar({ from, to, query, max });
        if (!res.ok) return { error: res.error === "workspace_not_connected" ? "calendar_not_connected" : "calendar_read_failed" };
        return { events: res.events };
      },
    }),

    getBusinessReport: tool({
      description:
        "On-demand 'state of the business' report — pipeline snapshot (total + interview-passed / contract / visa / arrived), the period's new signups + leads + documents uploaded, and the attention list (passports ≤90d, B2 exams ≤30d, stalled candidates). USE for 'state of the business', 'how's the business', 'weekly report', 'monthly report', 'give me the numbers'. period: 'week' (default) or 'month'. Supreme-only.",
      inputSchema: z.object({ period: z.enum(["week", "month"]).default("week") }),
      execute: async ({ period }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { text, count } = await computeWeeklyReport(period === "month" ? 30 : 7);
        return { report: text, attentionCount: count, period };
      },
    }),

    getFunnelSnapshot: tool({
      description:
        "Aggregate pipeline/funnel counts as structured numbers — total candidates + how many at each milestone (interviewPassed, contract, visa, arrived) + stalled (no movement 21d+). USE for 'funnel snapshot', 'how many at each stage', 'how many active vs arrived', 'pipeline numbers', 'conversion'. Scoped to the candidates you can see. Supreme-only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const roster = await candidateRoster();
        const ids = roster.map((r) => r.userId);
        if (ids.length === 0) return { snapshot: { total: 0, interviewPassed: 0, contract: 0, visa: 0, arrived: 0, stalled: 0 } };
        const { data } = await db
          .from("candidate_pipeline")
          .select("interview1_status, interview2_status, contract_done, visa_granted, arrived_done, updated_at")
          .in("user_id", ids);
        const rows = (data ?? []) as { interview1_status: string | null; interview2_status: string | null; contract_done: boolean | null; visa_granted: boolean | null; arrived_done: boolean | null; updated_at: string | null }[];
        const now = Date.now();
        let interviewPassed = 0, contract = 0, visa = 0, arrived = 0, stalled = 0;
        for (const p of rows) {
          if (p.interview1_status === "passed" || p.interview2_status === "passed") interviewPassed++;
          if (p.contract_done) contract++;
          if (p.visa_granted) visa++;
          if (p.arrived_done) arrived++;
          if (!p.arrived_done) { const t = Date.parse(p.updated_at ?? ""); if (Number.isFinite(t) && t < now - 21 * DAY) stalled++; }
        }
        return { snapshot: { total: roster.length, interviewPassed, contract, visa, arrived, stalled } };
      },
    }),

    getCandidateChecklist: tool({
      description:
        "What documents a candidate is STILL MISSING / pending / rejected for their file (Essentials + Qualifications, incl. each original + German translation). USE for 'what does Fatima still need', 'what's missing for the visa', 'is Asmae's file complete', 'what's left for X'. Returns each item's state (complete/pending/rejected/missing) + a completion percentage. Returns { error: 'out_of_scope' } if you can't see this candidate.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db
          .from("documents")
          .select("file_type, status")
          .eq("user_id", candidateUserId);
        if (error) return { error: "load_failed" };
        const cl = computeChecklist((data ?? []) as { file_type: string | null; status: string | null }[]);
        // Surface the actionable items by name so the bot can say exactly what's left.
        const label = (key: string) => translateDocLabel(key, "de") || key;
        const missing = cl.items.filter((i) => !i.optional && i.state === "missing").map((i) => label(i.key));
        const pending = cl.items.filter((i) => !i.optional && i.state === "pending").map((i) => label(i.key));
        const rejected = cl.items.filter((i) => i.state === "rejected").map((i) => label(i.key));
        return {
          pct: cl.pct,
          requiredComplete: cl.requiredComplete,
          requiredTotal: cl.requiredTotal,
          counts: cl.counts,
          missing, pending, rejected,
        };
      },
    }),

    getFunnelStageCounts: tool({
      description:
        "How many candidates sit at EACH recruitment funnel stage (funneling, screening call, interview 1, waiting for 2nd interview, interview 2, passed, departed). USE for 'break it down by stage', 'how many at each stage', 'how many in screening'. Returns {stage,label,count}[]. Scoped to candidates you can see. Supreme-only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const roster = await candidateRoster();
        const ids = roster.map((r) => r.userId);
        const counts = new Map<string, number>(FUNNEL_STAGES.map((s) => [s.key, 0]));
        let unset = 0;
        if (ids.length) {
          const { data } = await db.from("candidate_pipeline").select("user_id, funnel_stage").in("user_id", ids);
          const seen = new Set<string>();
          for (const r of (data ?? []) as { user_id: string; funnel_stage: string | null }[]) {
            seen.add(r.user_id);
            const k = r.funnel_stage;
            if (k && counts.has(k)) counts.set(k, counts.get(k)! + 1);
            else unset++;
          }
          // Candidates with no pipeline row at all = not yet started → count as unset.
          unset += ids.filter((id) => !seen.has(id)).length;
        }
        return {
          total: roster.length,
          stages: FUNNEL_STAGES.map((s) => ({ stage: s.key, label: s.label, count: counts.get(s.key) ?? 0 })),
          notStarted: unset,
        };
      },
    }),

    listCandidatesByFunnelStage: tool({
      description:
        "List the NAMES of candidates currently at one funnel stage. stage is one of: funneling, screening, interview1, waiting_2nd, interview2, passed, departed. USE for 'who's waiting for their 2nd interview', 'who's in screening', 'who's in the danger zone' (waiting_2nd). Scoped to candidates you can see. Supreme-only.",
      inputSchema: z.object({
        stage: z.enum(FUNNEL_STAGES.map((s) => s.key) as [FunnelStageKey, ...FunnelStageKey[]]),
      }),
      execute: async ({ stage }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const roster = await candidateRoster();
        const ids = roster.map((r) => r.userId);
        if (!ids.length) return { stage, label: funnelLabel(stage), candidates: [], count: 0 };
        const { data, error } = await db.from("candidate_pipeline").select("user_id").eq("funnel_stage", stage).in("user_id", ids);
        if (error) return { error: "load_failed" };
        const nameById = new Map(roster.map((r) => [r.userId, r.name] as const));
        const candidates = ((data ?? []) as { user_id: string }[])
          .filter((r) => nameById.has(r.user_id))
          .map((r) => ({ candidateUserId: r.user_id, name: nameById.get(r.user_id)! }));
        return { stage, label: funnelLabel(stage), candidates, count: candidates.length };
      },
    }),

    listCandidatesIn: tool({
      description:
        "List the NAMES of candidates in a group (the list tools give counts/ids but not the people). by: 'subAdmin' (value = their email, from listStaff), 'batch' (value = batchId, from listBatches), 'org' (value = orgId, from listOrganizations — approved members), or 'employer' (value = employerId, from listEmployers). USE for 'who's in the UKSH batch', 'show me Calmaroi's candidates', 'who's assigned to Khalid', 'everyone placed at UKSH'. Resolve the name→id with the matching list tool FIRST, then call this. Supreme-only.",
      inputSchema: z.object({
        by: z.enum(["subAdmin", "batch", "org", "employer"]),
        value: z.string().min(1).max(254).describe("the email (subAdmin) or id (batch/org/employer)"),
      }),
      execute: async ({ by, value }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const v = value.trim();
        let ids: string[] = [];
        try {
          if (by === "subAdmin") {
            const { data } = await db.from("sub_admin_assignments").select("candidate_user_id").eq("sub_admin_email", v.toLowerCase());
            ids = ((data ?? []) as { candidate_user_id: string }[]).map((r) => r.candidate_user_id);
          } else if (by === "batch") {
            const { data } = await db.from("candidate_pipeline").select("user_id").eq("batch_id", v);
            ids = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
          } else if (by === "org") {
            const { data } = await db.from("candidate_organizations").select("candidate_user_id").eq("org_id", v).eq("status", "approved");
            ids = ((data ?? []) as { candidate_user_id: string }[]).map((r) => r.candidate_user_id);
          } else {
            const { data } = await db.from("candidate_profiles").select("user_id").eq("employer_id", v);
            ids = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
          }
        } catch { return { error: "load_failed" }; }
        if (ids.length === 0) return { candidates: [], count: 0 };
        // Resolve names AND enforce scope (LAW #25): only candidates in the caller's
        // scoped roster survive — out-of-scope ids are silently dropped.
        const roster = await candidateRoster();
        const nameById = new Map(roster.map((r) => [r.userId, r.name] as const));
        const candidates = [...new Set(ids)].filter((id) => nameById.has(id)).map((id) => ({ candidateUserId: id, name: nameById.get(id)! }));
        return { candidates, count: candidates.length };
      },
    }),

    getNurseProfile: tool({
      description:
        "Read a candidate's NURSE profile — specialty, years of experience, current workplace, when they can start (available_from), and recognition (Anerkennung) stage. USE for 'what specialty is X', 'how many years experience does X have', 'when can X start', 'where does X work now'. out_of_scope if you can't see them.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db.from("candidate_profiles")
          .select("nursing_specialty, years_experience, current_workplace, available_from, anerkennung_stage")
          .eq("user_id", candidateUserId).maybeSingle();
        if (error) return { error: "load_failed" };
        const p = (data ?? {}) as { nursing_specialty: string | null; years_experience: number | null; current_workplace: string | null; available_from: string | null; anerkennung_stage: string | null };
        return {
          name: await displayName(candidateUserId),
          specialty: p.nursing_specialty,
          specialtyLabel: specialtyLabel(p.nursing_specialty, "en"),
          yearsExperience: p.years_experience,
          currentWorkplace: p.current_workplace,
          availableFrom: p.available_from,
          anerkennungStage: p.anerkennung_stage,
        };
      },
    }),

    listCandidatesByProfile: tool({
      description:
        "Find candidates by NURSE criteria — for matching to a hospital's need. Filters (all optional, combine them): specialty (a key — general, intensive (ICU), geriatric, surgical, pediatric, emergency, anesthesia, psychiatric, obstetrics, oncology, cardiology, dialysis; pass the closest), minYearsExperience, availableBy (ISO date — only those who can start on/before it). Returns [{candidateUserId,name,specialty,specialtyLabel,yearsExperience,availableFrom}], scoped to candidates you can see. USE for 'who are our ICU nurses', 'list candidates with 5+ years', 'who's available by September'.",
      inputSchema: z.object({
        specialty: z.string().max(40).optional(),
        minYearsExperience: z.number().int().min(0).max(60).optional(),
        availableBy: z.string().max(20).optional().describe("ISO date; only candidates available on/before this"),
      }),
      execute: async ({ specialty, minYearsExperience, availableBy }) => {
        if (lockedOut) return { candidates: [] };
        const roster = await candidateRoster();
        if (roster.length === 0) return { candidates: [] };
        const nameById = new Map(roster.map((r) => [r.userId, r.name] as const));
        const { data, error } = await db.from("candidate_profiles")
          .select("user_id, nursing_specialty, years_experience, available_from")
          .in("user_id", roster.map((r) => r.userId));
        if (error) return { error: "load_failed" };
        type Row = { user_id: string; nursing_specialty: string | null; years_experience: number | null; available_from: string | null };
        let rows = (data ?? []) as Row[];
        if (specialty && specialty.trim()) {
          const s = specialty.trim().toLowerCase();
          rows = rows.filter((r) => {
            const key = (r.nursing_specialty ?? "").toLowerCase();
            if (!key) return false;
            return key === s || key.includes(s) || specialtyLabel(r.nursing_specialty, "en").toLowerCase().includes(s);
          });
        }
        if (minYearsExperience != null) rows = rows.filter((r) => (r.years_experience ?? -1) >= minYearsExperience);
        if (availableBy && !Number.isNaN(Date.parse(availableBy))) {
          const by = Date.parse(availableBy);
          rows = rows.filter((r) => { const t = Date.parse(r.available_from ?? ""); return Number.isFinite(t) && t <= by; });
        }
        const candidates = rows.slice(0, 100).map((r) => ({
          candidateUserId: r.user_id,
          name: nameById.get(r.user_id) ?? "—",
          specialty: r.nursing_specialty,
          specialtyLabel: specialtyLabel(r.nursing_specialty, "en"),
          yearsExperience: r.years_experience,
          availableFrom: r.available_from,
        }));
        return { candidates, count: candidates.length };
      },
    }),

    getVaccineStatus: tool({
      description:
        "Vaccine / Impfung status for a candidate — how many Masern + Varizell doses they have vs needed, and whether they meet the requirement. Reference target = UKSH (2× Masern + 2× Varizell). USE for 'does X have her 2x Masern + 2x Varizellen', 'vaccine status for X', 'is X's Impfung done'. Reads the admin-only vaccine data. out_of_scope if you can't see them; 'vaccines_not_set_up' if the table isn't migrated.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db.from("candidate_status").select("vaccines").eq("user_id", candidateUserId).maybeSingle();
        if (error) {
          // `vaccines` is a hand-run COLUMN migration on an always-present table, so a
          // missing column is 42703 / PGRST204 (NOT PGRST205 table-not-found). Treat all
          // of those as "not set up yet" so the bot says that, not a generic error (B4).
          const code = (error as { code?: string }).code ?? "";
          const msg = (error as { message?: string }).message ?? "";
          const missing = code === "42703" || code === "PGRST204" || code === "PGRST205" || /column .* does not exist|schema cache/i.test(msg);
          return { error: missing ? "vaccines_not_set_up" : "load_failed" };
        }
        const vaccines = (data as { vaccines?: unknown } | null)?.vaccines as Record<string, { doses?: { got?: boolean | null }[] }> | null | undefined;
        const got = (key: string) => ((vaccines?.[key]?.doses ?? []) as { got?: boolean | null }[]).filter((d) => d.got === true).length;
        const masernHave = got("masern"), varizellHave = got("varizell");
        const need = { masern: 2, varizell: 2 }; // UKSH baseline (some employers need fewer/none)
        return {
          name: await displayName(candidateUserId),
          masern: { have: masernHave, need: need.masern },
          varizell: { have: varizellHave, need: need.varizell },
          meetsRequirement: masernHave >= need.masern && varizellHave >= need.varizell,
          note: "Target shown is the UKSH requirement (2× Masern + 2× Varizell); other employers may require fewer or none.",
        };
      },
    }),

    rescheduleCalendarEvent: tool({
      description:
        "Move / edit an event on the founder's OWN Google Calendar by its eventId (get it from listMyCalendar). Change start (startsAt = local ISO, no Z), end, title, and/or add a Meet link. USE for 'move my 3pm to 5pm', 'push the Erstgespräch to Thursday', 'rename that event', 'add a Meet link to it'. Applies immediately. Supreme-only.",
      inputSchema: z.object({
        eventId: z.string().min(1).max(1024),
        startsAt: z.string().max(40).optional().describe("new start, local ISO e.g. 2026-06-19T17:00:00"),
        endsAt: z.string().max(40).optional(),
        title: z.string().max(300).optional(),
        addMeet: z.boolean().optional(),
      }),
      execute: async ({ eventId, startsAt, endsAt, title, addMeet }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const r = await updateWorkspaceEvent({ eventId, startsAt, endsAt, title, addMeet });
        if (!r.ok) return { error: r.error === "workspace_not_connected" ? "calendar_not_connected" : r.error };
        return { updated: true, eventId: r.id, meetLink: r.meetLink, htmlLink: r.htmlLink };
      },
    }),

    cancelMyCalendarEvent: tool({
      description:
        "Cancel / delete an event from the founder's OWN Google Calendar by its eventId (get it from listMyCalendar). USE for 'cancel my call with Anna Thursday', 'delete that meeting', 'remove the 3pm'. Applies immediately. Supreme-only. NOTE: this is the founder's PERSONAL Google Calendar — NOT deleteCalendarEvent (which removes a portal community event for candidates).",
      inputSchema: z.object({ eventId: z.string().min(1).max(1024) }),
      execute: async ({ eventId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const r = await cancelWorkspaceEvent(eventId);
        if (!r.ok) return { error: r.error === "workspace_not_connected" ? "calendar_not_connected" : (r.error ?? "cancel_failed") };
        return { cancelled: true };
      },
    }),

    setTestAccount: tool({
      description:
        "Flag a candidate account as a TEST account (or unflag it). A test account is HIDDEN from ALL candidate counts, lists, search, rosters, matching and reports — so it never pollutes your real numbers. USE for 'mark X as a test account', 'X is just a test account we test features with', 'unmark X as test'. Resolve the name with searchCandidates first. Supreme-only, applies immediately.",
      inputSchema: z.object({ candidateUserId: z.string().uuid(), isTest: z.boolean().default(true) }),
      execute: async ({ candidateUserId, isTest }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        const { error } = await db.from("candidate_profiles").update({ is_test_account: isTest }).eq("user_id", candidateUserId);
        if (error) {
          const code = (error as { code?: string }).code ?? "";
          const msg = (error as { message?: string }).message ?? "";
          const missing = code === "42703" || code === "PGRST204" || /column .* does not exist|schema cache/i.test(msg);
          return { error: missing ? "test_flag_not_set_up" : "update_failed" };
        }
        return { ok: true, name, isTest };
      },
    }),

    // ── Personal task memory (the admin's OWN reminders — not candidate data) ──
    saveReminder: tool({
      description:
        "Save a personal reminder/task for the admin (e.g. 'chase Youssef's passport', 'call the embassy Monday'). Use this whenever the admin tells you to remember something or notes a task to do later. If a TIME or date was mentioned (\"tomorrow at 3pm\", \"Monday 9am\", \"tonight\", \"in 2 hours\"), pass dueAt as a LOCAL wall-clock ISO with NO Z (e.g. 2026-06-19T15:00:00), resolved against the RIGHT NOW moment in the system context — the bot will PING the admin at exactly that instant. For a REPEATING reminder ('every Monday', 'every month', 'each day'), set recurrence and a dueAt for the FIRST occurrence — it then re-fires each period until marked done. Omit dueAt for an open-ended task (it just nags in the briefing). Optionally tie it to a candidate.",
      inputSchema: z.object({
        text: z.string().min(1).max(500).describe("the task / thing to remember"),
        dueAt: z.string().optional().describe("LOCAL wall-clock ISO with time, e.g. 2026-06-19T15:00:00 (no Z) — when to PING. A date-only value defaults to 09:00 local."),
        recurrence: z.enum(["daily", "weekly", "monthly"]).optional().describe("set for a repeating reminder; the firing re-arms the next occurrence each period"),
        candidateUserId: z.string().uuid().optional().describe("if the reminder is about a specific candidate"),
      }),
      execute: async ({ text, dueAt, recurrence, candidateUserId }) => {
        if (candidateUserId && !(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const due = dueAt ? localIsoToInstant(dueAt) : null;
        const dueAtIso = due ? due.toISOString() : null;
        const dueDate = dueAtIso ? dueAtIso.slice(0, 10) : null;
        const row: Record<string, unknown> = { owner_user_id: scope.userId, text, due_date: dueDate, candidate_user_id: candidateUserId ?? null };
        if (dueAtIso) row.due_at = dueAtIso;
        if (recurrence) row.recurrence = recurrence;
        let { data, error } = await db.from("assistant_reminders").insert(row).select("id").maybeSingle();
        if (error && (dueAtIso || recurrence)) {
          // due_at/recurrence columns not migrated yet → retry date-only so the task still lands.
          ({ data, error } = await db
            .from("assistant_reminders")
            .insert({ owner_user_id: scope.userId, text, due_date: dueDate, candidate_user_id: candidateUserId ?? null })
            .select("id")
            .maybeSingle());
        }
        if (error) return { error: "save_failed" };
        return { saved: true, reminderId: (data as { id: string } | null)?.id ?? null, willFireAt: due ? fmtWhen(due) : null, recurrence: recurrence ?? null };
      },
    }),

    listReminders: tool({
      description:
        "List the admin's saved reminders/tasks (their own notes), soonest due first. Open (not-done) only by default. Use when the admin asks what they need to do, what's pending, or what's due. Negative daysUntil means it's overdue.",
      inputSchema: z.object({
        includeDone: z.boolean().default(false),
        dueWithinDays: z.number().int().min(1).max(365).optional().describe("only reminders due within N days"),
      }),
      execute: async ({ includeDone, dueWithinDays }) => {
        type R = { id: string; text: string; due_date: string | null; due_at?: string | null; candidate_user_id: string | null; done: boolean; created_at: string };
        const run = async (withDueAt: boolean) => {
          let qb = db
            .from("assistant_reminders")
            .select(withDueAt ? "id, text, due_date, due_at, candidate_user_id, done, created_at" : "id, text, due_date, candidate_user_id, done, created_at")
            .eq("owner_user_id", scope.userId);
          if (!includeDone) qb = qb.eq("done", false);
          return qb;
        };
        let { data, error } = await run(true);
        if (error) ({ data, error } = await run(false)); // due_at not migrated yet → fall back
        if (error) return { error: "load_failed" };
        let rows = (data ?? []) as unknown as R[];
        const now = Date.now();
        // Effective due instant: the precise due_at if set, else the legacy date.
        const dueMs = (r: R): number | null => {
          if (r.due_at) { const ms = Date.parse(r.due_at); if (!Number.isNaN(ms)) return ms; }
          return parseDate(r.due_date);
        };
        if (dueWithinDays != null) {
          const horizon = now + dueWithinDays * DAY;
          rows = rows.filter((r) => { const ms = dueMs(r); return ms !== null && ms <= horizon; });
        }
        rows.sort((a, b) => {
          const ma = dueMs(a), mb = dueMs(b);
          if (ma === null && mb === null) return 0;
          if (ma === null) return 1;
          if (mb === null) return -1;
          return ma - mb;
        });
        // Resolve the tied-to candidate id → a real NAME so "what's on my plate"
        // reads "chase Hajar's passport", never a raw UUID. One auth lookup for all.
        const candIds = [...new Set(rows.map((r) => r.candidate_user_id).filter((x): x is string => !!x))];
        const nameById = candIds.length ? await authNameMap(candIds) : new Map<string, string>();
        return {
          reminders: rows.map((r) => {
            const ms = dueMs(r);
            return {
              reminderId: r.id,
              text: r.text,
              dueDate: r.due_date,
              // The exact time it pings (when one was set), in the founder's tz.
              when: r.due_at ? fmtWhen(new Date(r.due_at)) : null,
              daysUntil: ms !== null ? Math.round((ms - now) / DAY) : null,
              candidateUserId: r.candidate_user_id,
              candidateName: r.candidate_user_id ? (nameById.get(r.candidate_user_id) || null) : null,
              done: r.done,
            };
          }),
        };
      },
    }),

    completeReminder: tool({
      description: "Mark one of the admin's reminders as done, by its reminderId (get the id from listReminders first).",
      inputSchema: z.object({ reminderId: z.string().uuid() }),
      execute: async ({ reminderId }) => {
        const { data, error } = await db
          .from("assistant_reminders")
          .update({ done: true })
          .eq("id", reminderId)
          .eq("owner_user_id", scope.userId) // can only complete your OWN reminders
          .select("id")
          .maybeSingle();
        if (error) return { error: "update_failed" };
        if (!data) return { error: "not_found" };
        return { completed: true };
      },
    }),

    updateReminder: tool({
      description:
        "Edit an EXISTING reminder by its reminderId (from listReminders) — to SNOOZE/reschedule it ('snooze that to tomorrow', 'push the embassy reminder to next Friday', 'change it to 5pm'), ADD a deadline to an undated task, change its TEXT, or set/clear a repeat. Pass only the fields that change. dueAt = LOCAL wall-clock ISO with no Z (e.g. 2026-06-20T17:00:00), resolved against RIGHT NOW. Clears the fired flag so a moved-forward reminder fires again at the new time.",
      inputSchema: z.object({
        reminderId: z.string().uuid(),
        text: z.string().min(1).max(500).optional().describe("new task text"),
        dueAt: z.string().optional().describe("new LOCAL wall-clock ISO with time (no Z) to reschedule/snooze to"),
        recurrence: z.enum(["daily", "weekly", "monthly", "none"]).optional().describe("set a repeat, or 'none' to make it one-shot"),
      }),
      execute: async ({ reminderId, text, dueAt, recurrence }) => {
        const patch: Record<string, unknown> = {};
        if (text != null) patch.text = text.slice(0, 500);
        if (dueAt != null) {
          const due = localIsoToInstant(dueAt);
          if (!due) return { error: "bad_dueAt" };
          patch.due_at = due.toISOString();
          patch.due_date = due.toISOString().slice(0, 10);
          patch.notified_at = null; // re-arm: a rescheduled reminder should fire again
        }
        if (recurrence != null) patch.recurrence = recurrence === "none" ? null : recurrence;
        if (Object.keys(patch).length === 0) return { error: "nothing_to_change" };
        let { data, error } = await db
          .from("assistant_reminders")
          .update(patch)
          .eq("id", reminderId)
          .eq("owner_user_id", scope.userId)
          .select("id, text, due_at")
          .maybeSingle();
        if (error && ("due_at" in patch || "notified_at" in patch || "recurrence" in patch)) {
          // columns not migrated yet → retry with only the always-present fields.
          const safe: Record<string, unknown> = {};
          if ("text" in patch) safe.text = patch.text;
          if ("due_date" in patch) safe.due_date = patch.due_date;
          if (Object.keys(safe).length === 0) return { error: "needs_migration" };
          ({ data, error } = await db
            .from("assistant_reminders").update(safe).eq("id", reminderId).eq("owner_user_id", scope.userId)
            .select("id, text, due_at").maybeSingle());
        }
        if (error) return { error: "update_failed" };
        if (!data) return { error: "not_found" };
        const row = data as { id: string; text: string; due_at: string | null };
        return { updated: true, reminderId: row.id, text: row.text, when: row.due_at ? fmtWhen(new Date(row.due_at)) : null };
      },
    }),

    clearReminders: tool({
      description:
        "Mark MANY of the admin's reminders done at once. scope: 'all' clears every open reminder ('clear all my reminders / wipe my to-do list'); 'overdue' clears only ones already past due. By design this is a soft close (done=true), never a hard delete. Returns how many were cleared.",
      inputSchema: z.object({ scope: z.enum(["all", "overdue"]).default("all") }),
      execute: async ({ scope: which }) => {
        // Load open ids first so we can both apply the 'overdue' filter (which needs
        // due_at/due_date math) and report an exact count.
        const sel = async (withDueAt: boolean) => db
          .from("assistant_reminders")
          .select(withDueAt ? "id, due_date, due_at" : "id, due_date")
          .eq("owner_user_id", scope.userId)
          .eq("done", false);
        let { data, error } = await sel(true);
        if (error) ({ data, error } = await sel(false));
        if (error) return { error: "load_failed" };
        type R = { id: string; due_date: string | null; due_at?: string | null };
        let rows = (data ?? []) as unknown as R[];
        const now = Date.now();
        if (which === "overdue") {
          rows = rows.filter((r) => {
            const ms = r.due_at ? Date.parse(r.due_at) : parseDate(r.due_date);
            return ms !== null && !Number.isNaN(ms) && ms <= now;
          });
        }
        const ids = rows.map((r) => r.id);
        if (!ids.length) return { cleared: 0 };
        const { error: uErr } = await db
          .from("assistant_reminders")
          .update({ done: true })
          .in("id", ids)
          .eq("owner_user_id", scope.userId);
        if (uErr) return { error: "clear_failed" };
        return { cleared: ids.length };
      },
    }),

    getTodayBriefing: tool({
      description:
        "Get the prioritized 'what needs you today' briefing — documents pending review, passports expiring, B2 exams coming up, and the admin's due reminders. Use when the admin asks what to do today, what's important, what's pending, or for a daily summary.",
      inputSchema: z.object({}),
      execute: async () => {
        const { text, count } = await computeBriefing(scope.userId);
        return { briefing: text, actionableCount: count };
      },
    }),

    // ── Native Google Workspace (service-account domain-wide delegation) setup ──
    getGoogleServiceAccountId: tool({
      description:
        "For SETTING UP native Google Workspace access: returns the service account's email + client ID + the scopes the admin must paste into the Google Workspace Admin console (Security → API controls → Domain-wide delegation). Use when the admin asks to set up / connect native Google / Workspace. Supreme-admin only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const sa = workspaceServiceAccount();
        if (!sa) return { error: "no_service_account_key", hint: "GOOGLE_VERTEX_CREDENTIALS / GOOGLE_WORKSPACE_CREDENTIALS is not set." };
        return {
          clientId: sa.clientId,
          serviceAccountEmail: sa.clientEmail,
          impersonates: sa.subject,
          scopes: WORKSPACE_SCOPES.join(","),
          where: "admin.google.com → Security → Access and data control → API controls → Domain-wide delegation → Add new: paste the Client ID + the scopes (comma-separated).",
        };
      },
    }),
    testGoogleWorkspace: tool({
      description:
        "Verify the native Google Workspace connection is live (after the admin set up domain-wide delegation). Reads the Gmail profile + checks Calendar. Returns the connected email or a clear error if delegation isn't granted yet. Supreme-admin only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!workspaceConfigured()) return { ok: false, error: "not_configured", hint: "Service-account key or impersonation subject missing." };
        return await testWorkspace();
      },
    }),

    // ── Native Gmail: search / read / reply-in-thread (Workspace) ──
    searchInbox: tool({
      description:
        "Search the founder's Gmail inbox (native Google). query = Gmail search syntax — e.g. 'from:anna newer_than:30d', 'subject:interview', 'is:unread', or just a name/email. Returns recent matches (id, from, subject, date, snippet). Use the id with readEmail or replyToEmail. Use this for 'find the email from X', 'what did Anna send', 'unread from this week'. Read-only. Supreme-admin only.",
      inputSchema: z.object({ query: z.string().max(200).default("in:inbox"), max: z.number().int().min(1).max(25).default(8) }),
      execute: async ({ query, max }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected", hint: "Connect Google Workspace (domain-wide delegation) first." };
        const r = await gmailSearch(query, max);
        if (r === null) return { error: "gmail_read_failed" };
        return { emails: r };
      },
    }),
    readEmail: tool({
      description:
        "Read ONE email in full — the decoded body plus sender/recipients/subject/date — by its id (from searchInbox). Use before replying or to answer 'what does that email say'. Read-only. Supreme-admin only.",
      inputSchema: z.object({ messageId: z.string().min(5) }),
      execute: async ({ messageId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected" };
        const m = await gmailGet(messageId);
        if (!m) return { error: "not_found" };
        return { email: { id: m.id, from: m.from, fromName: m.fromName, to: m.to, cc: m.cc, subject: m.subject, date: m.date, body: m.body } };
      },
    }),
    getEmailAttachments: tool({
      description:
        "Pull the FILE ATTACHMENTS off email(s) and deliver them in the chat as the ACTUAL documents (the files themselves — never links/text). Give EITHER: messageId (ONE email's id from searchInbox), OR query (a Gmail search to pull attachments from ALL matching emails — e.g. 'from:abdelhak' for everything Abdelhak attached across every email). For 'pull ALL the attachments X sent me' / 'all his emails', ALWAYS use query, not a single messageId — it gathers every attachment across all matching emails. The files are delivered right below; do NOT mention 'link' or 'expires' (there is none). Read-only. Supreme-admin only.",
      inputSchema: z.object({
        messageId: z.string().optional().describe("one email's id (from searchInbox)"),
        query: z.string().optional().describe("Gmail search to pull attachments from ALL matching emails, e.g. 'from:abdelhak newer_than:1y'"),
      }),
      execute: async ({ messageId, query }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected" };
        // Resolve which emails to pull from: one id, or every email matching a search.
        let ids: string[] = [];
        if (messageId && messageId.trim()) {
          ids = [messageId.trim()];
        } else if (query && query.trim()) {
          const found = await gmailSearch(query.trim(), 25);
          if (found === null) return { error: "read_failed" };
          ids = found.map((m) => m.id).filter(Boolean);
          if (ids.length === 0) return { results: [], note: "no_emails_found" };
        } else {
          return { error: "need_messageId_or_query" };
        }
        const token = signDlToken(scope.userId, 600); // 10 min — webhook delivers files AFTER the model run; 180s expired the tail of big batches (B7)
        const results: { url: string; fileName: string; mimeType: string }[] = [];
        for (const mid of ids) {
          const atts = await listEmailAttachments(mid);
          if (!atts) continue;
          for (const a of atts) {
            results.push({
              url: `/api/portal/admin/email-attachment?mid=${encodeURIComponent(mid)}&aid=${encodeURIComponent(a.attachmentId)}&dlt=${encodeURIComponent(token)}&name=${encodeURIComponent(a.filename)}`,
              fileName: a.filename,
              mimeType: a.mimeType,
            });
            if (results.length >= 25) break;
          }
          if (results.length >= 25) break;
        }
        if (results.length === 0) return { results: [], note: "no_attachments" };
        return { results, count: results.length };
      },
    }),
    showPendingAttachments: tool({
      description:
        "Pull the ACTUAL files attached to the email DRAFT I'm about to send, and deliver them here so I can eyeball them BEFORE sending. Use whenever I say 'show me the attached files', 'what's attached', 'let me see the files', 'show me what you'll send' while an email with attachments is waiting for my yes. Reads the REAL draft — never your guess of what's attached. Supreme-admin only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected" };
        const pend = await getPendingDraft(scope.userId);
        if (!pend) return { error: "no_pending_draft", note: "No email draft is waiting — ask me to compose one first." };
        const got = await listDraftAttachments(pend.draftId);
        if (!got) return { error: "read_failed" };
        if (got.attachments.length === 0) return { results: [], note: "no_attachments" };
        const token = signDlToken(scope.userId, 600); // 10 min — webhook delivers files AFTER the model run; 180s expired the tail of big batches (B7)
        const results = got.attachments.slice(0, 25).map((a) => ({
          url: `/api/portal/admin/email-attachment?mid=${encodeURIComponent(got.messageId)}&aid=${encodeURIComponent(a.attachmentId)}&dlt=${encodeURIComponent(token)}&name=${encodeURIComponent(a.filename)}`,
          fileName: a.filename,
          mimeType: a.mimeType,
        }));
        return { results, count: results.length };
      },
    }),
    replyToEmail: tool({
      description:
        "Reply to an email IN-THREAD by its id (from searchInbox/readEmail). This KEEPS the conversation in the SAME Gmail thread (correct In-Reply-To/References + same subject) and lands in the founder's Sent — use it whenever you're CONTINUING an existing email conversation; do NOT start a fresh email for a reply. Replies to the original sender; replyAll=true also CCs everyone else on it. You can ATTACH files on the reply: attachCandidateNames (comma-sep candidate FULL NAMES → their latest CV), attachDocIds (document ids), attachFromEmailIds (Gmail message ids whose attachments to forward — e.g. reply to Anna WITH the Defizitbescheid someone sent you). It's a SEND — goes out after the founder's one confirm; show the reply in the SHOWING-AN-EMAIL shape. Supreme-admin only.",
      inputSchema: z.object({
        messageId: z.string().min(5),
        body: z.string().min(1).max(8000),
        replyAll: z.boolean().default(false),
        attachCandidateNames: z.string().optional().describe("comma-sep candidate FULL NAMES whose latest CV to attach to the reply"),
        attachDocIds: z.string().optional().describe("comma-sep document ids to attach"),
        attachFromEmailIds: z.string().optional().describe("attach files from an email — best a Gmail SEARCH like 'from:abdelhak' (robust, the bot finds it), or a message id"),
        attachChatFiles: z.boolean().optional().describe("attach the files I recently sent the bot in THIS Telegram chat (photos/PDFs I uploaded)"),
      }),
      execute: async ({ messageId, body, replyAll, attachCandidateNames, attachDocIds, attachFromEmailIds, attachChatFiles }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected" };
        const orig = await gmailGet(messageId);
        if (!orig) return { error: "original_not_found" };
        // Resolve candidate names → real ids (same resolver as getCvLinks/sendExternalEmail).
        const candRefs = (attachCandidateNames ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const candIds: string[] = [];
        const unresolved: string[] = [];
        if (candRefs.length) {
          const roster = await candidateRoster();
          for (const ref of candRefs) {
            const m = pickCandidate(roster, ref);
            if (m.status === "ok") { if (!candIds.includes(m.candidate.userId)) candIds.push(m.candidate.userId); }
            else unresolved.push(ref);
          }
          if (unresolved.length) return { error: `couldnt_find_candidate: ${unresolved.join(", ")}` };
        }
        for (const cid of candIds) {
          if (!(await canActOnCandidate(scope.role, scope.email, cid))) return { error: "out_of_scope" };
        }
        const docIds = (attachDocIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const emailFwdIds = (attachFromEmailIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const cleanBody = stripEmailFormatting(body);
        const who = orig.fromName || orig.from;
        const subj = orig.subject || "";
        const names: string[] = [];
        for (const cid of candIds.slice(0, 10)) names.push(await displayName(cid));
        const attachDesc = [
          candIds.length ? `${candIds.length} CV${candIds.length > 1 ? "s" : ""}${names.length ? ` (${names.join(", ")})` : ""}` : null,
          docIds.length ? `${docIds.length} document${docIds.length > 1 ? "s" : ""}` : null,
          emailFwdIds.length ? `files from ${emailFwdIds.length} email${emailFwdIds.length > 1 ? "s" : ""}` : null,
          attachChatFiles ? "files you sent in chat" : null,
        ].filter(Boolean).join(" + ") || "none";
        // FUZZY attachments (chat uploads / email-search) → reply via a real Gmail
        // DRAFT (resolve + attach ONCE, in-thread), confirm SENDS that draft.
        // Verify-from-draft = sent. CV/doc stay on the proven path.
        const useDraft = emailFwdIds.length > 0 || attachChatFiles === true;
        if (useDraft) {
          let cc: string[] = [];
          if (replyAll) {
            const self = (scope.email || "").toLowerCase();
            cc = [...new Set([orig.to, orig.cc].join(",").split(",").map((s) => s.trim()).filter(Boolean)
              .filter((aa) => { const e = (aa.match(/<([^>]+)>/)?.[1] || aa).toLowerCase(); return e && (!self || !e.includes(self)) && e !== orig.from.toLowerCase(); }))];
          }
          const d = await prepareEmailDraft(scope, {
            to: orig.from, cc, replyToMessageId: messageId, subject: subj, body: cleanBody,
            candidateIds: candIds, docIds, attachFromEmailIds: emailFwdIds, chatFiles: attachChatFiles === true,
          });
          if (!d.ok) return { error: d.error };
          const back = await listDraftAttachments(d.draftId);
          const realNames = back ? back.attachments.map((a) => a.filename) : d.names;
          return stagePending(scope, {
            toolName: "sendDraft",
            args: { draftId: d.draftId, draftMessageId: d.draftMessageId, to: orig.from, subject: d.subject },
            candidateUserId: null,
            summary: `↩️ Reply${replyAll ? " (all)" : ""} to ${who} — ${d.subject}\n📎 Attached (verified on the draft): ${realNames.length ? realNames.join(", ") : "none"}\n(say "show me the attached files" to pull them off the draft and double-check before you send)\n\n${cleanBody.slice(0, 600)}${cleanBody.length > 600 ? "…" : ""}`,
          });
        }
        const args: Record<string, unknown> = { messageId, body: cleanBody, replyAll: replyAll === true };
        if (candIds.length) args.attachCandidateIds = candIds.join(",");
        if (docIds.length) args.attachDocIds = docIds.join(",");
        if (emailFwdIds.length) args.attachFromEmailIds = emailFwdIds.join(",");
        if (attachChatFiles) args.attachChatFiles = true;
        return stagePending(scope, {
          toolName: "replyToEmail",
          args,
          candidateUserId: null,
          summary: `↩️ Reply${replyAll ? " (all)" : ""} to ${who} — Re: ${subj}\nAttachments: ${attachDesc}\n\n${cleanBody.slice(0, 600)}${cleanBody.length > 600 ? "…" : ""}`,
        });
      },
    }),

    forwardEmail: tool({
      description:
        "FORWARD a received email to someone else — keeps the original message + its attachments, with an optional note you add on top. messageId from searchInbox/readEmail; to = recipient email; note = optional line above the forwarded content. e.g. 'forward Abdelhak's email to Anna', 'forward this to the embassy with a note'. It's a SEND — goes out after your one confirm. Supreme-only.",
      inputSchema: z.object({ messageId: z.string().min(5), to: z.string().min(3).max(254), note: z.string().max(4000).optional() }),
      execute: async ({ messageId, to, note }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected" };
        const dest = to.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) return { error: "bad_email" };
        const orig = await gmailGet(messageId);
        if (!orig) return { error: "original_not_found" };
        const cleanNote = note ? stripEmailFormatting(note) : "";
        const args: Record<string, unknown> = { messageId, to: dest };
        if (cleanNote) args.note = cleanNote;
        return stagePending(scope, {
          toolName: "forwardEmail", args, candidateUserId: null,
          summary: `↪️ Forward to ${dest} — Fwd: ${orig.subject}${cleanNote ? `\nNote: ${cleanNote.slice(0, 200)}` : ""}`,
        });
      },
    }),

    saveDraft: tool({
      description:
        "Save an email as a Gmail DRAFT (composed but NOT sent) — it lands in MY Gmail Drafts to review/finish/send myself. Use when I say 'draft an email to X', 'write up a draft', 'prepare it but don't send yet'. Same options as sendExternalEmail: to, cc, subject, body, and attachCandidateNames / attachDocIds / attachFromEmailIds for attachments. Applies immediately (a draft is never sent, so no confirm). Supreme-only.",
      inputSchema: z.object({
        to: z.string().min(3).max(254),
        cc: z.string().max(1000).optional(),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(8000),
        attachCandidateNames: z.string().optional(),
        attachDocIds: z.string().optional(),
        attachFromEmailIds: z.string().optional(),
        attachChatFiles: z.boolean().optional().describe("attach the files I recently sent the bot in THIS Telegram chat"),
      }),
      execute: async ({ to, cc, subject, body, attachCandidateNames, attachDocIds, attachFromEmailIds, attachChatFiles }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected" };
        const dest = to.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) return { error: "bad_email" };
        const candRefs = (attachCandidateNames ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const candIds: string[] = [];
        const unresolved: string[] = [];
        if (candRefs.length) {
          const roster = await candidateRoster();
          for (const ref of candRefs) {
            const m = pickCandidate(roster, ref);
            if (m.status === "ok") { if (!candIds.includes(m.candidate.userId)) candIds.push(m.candidate.userId); }
            else unresolved.push(ref);
          }
          if (unresolved.length) return { error: `couldnt_find_candidate: ${unresolved.join(", ")}` };
        }
        for (const cid of candIds) {
          if (!(await canActOnCandidate(scope.role, scope.email, cid))) return { error: "out_of_scope" };
        }
        const ccList = (cc ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        const docIds = (attachDocIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const emailFwdIds = (attachFromEmailIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const cleanBody = stripEmailFormatting(body);
        const cleanSubject = stripEmailFormatting(subject);
        const args: Record<string, unknown> = { to: dest, subject: cleanSubject, body: cleanBody };
        if (ccList.length) args.cc = ccList.join(",");
        if (candIds.length) args.attachCandidateIds = candIds.join(",");
        if (docIds.length) args.attachDocIds = docIds.join(",");
        if (emailFwdIds.length) args.attachFromEmailIds = emailFwdIds.join(",");
        if (attachChatFiles) args.attachChatFiles = true;
        return stagePending(scope, { toolName: "saveDraft", args, candidateUserId: null, summary: `📝 Draft → ${dest} · ${cleanSubject}` });
      },
    }),

    readThread: tool({
      description:
        "Read the WHOLE email conversation (every message back-and-forth) for a thread, given any messageId in it (from searchInbox). Use for 'show me the full conversation with Anna', 'what's the whole thread say', or to get full context before replying. Read-only. Supreme-only.",
      inputSchema: z.object({ messageId: z.string().min(5) }),
      execute: async ({ messageId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected" };
        const t = await gmailGetThread(messageId);
        if (!t) return { error: "not_found" };
        return { subject: t.subject, count: t.messages.length, messages: t.messages };
      },
    }),

    manageEmail: tool({
      description:
        "Organize an inbox email — the housekeeping you'd do by hand in Gmail. messageId from searchInbox. action: 'archive' (remove from inbox), 'unarchive', 'read' (mark read), 'unread', 'star', 'unstar', 'trash' (move to Trash — reversible ~30 days), 'untrash', or 'spam' (mark as spam). Applies immediately (your own mailbox + reversible) — no confirm. I NEVER permanently delete email. e.g. 'archive that', 'mark the embassy email unread', 'star Anna's email'. Supreme-only.",
      inputSchema: z.object({ messageId: z.string().min(5), action: z.enum(["archive", "unarchive", "read", "unread", "star", "unstar", "trash", "untrash", "spam"]) }),
      execute: async ({ messageId, action }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!gmailApiReady()) return { error: "workspace_not_connected" };
        let ok: boolean;
        if (action === "trash") ok = await gmailTrash(messageId, false);
        else if (action === "untrash") ok = await gmailTrash(messageId, true);
        else {
          const map: Record<string, [string[], string[]]> = {
            archive: [[], ["INBOX"]], unarchive: [["INBOX"], []],
            read: [[], ["UNREAD"]], unread: [["UNREAD"], []],
            star: [["STARRED"], []], unstar: [[], ["STARRED"]],
            spam: [["SPAM"], ["INBOX"]],
          };
          const [add, rem] = map[action] ?? [[], []];
          ok = await gmailModify(messageId, add, rem);
        }
        return ok ? { done: true, action } : { error: "failed" };
      },
    }),

    getApiUsage: tool({
      description:
        "Report the bot's own AI token consumption (Claude) — total input/output tokens, number of chats, how many input tokens were served from the prompt CACHE (cacheRead) + the cache-hit % (cacheHitPct), and a rough $ estimate that already prices cache reads at ~0.1×. period: 'today' (since midnight), 'week' (last 7 days), or 'month' (last 30 days). Use for 'how many tokens did I use this week', 'my API usage', 'how much is the bot costing me', 'is caching working'. A high cacheHitPct means caching is doing its job. Supreme-only. Tracks from when usage logging was switched on.",
      inputSchema: z.object({ period: z.enum(["today", "week", "month"]).default("today") }),
      execute: async ({ period }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const s = await getUsageSummary(period);
        if (!s.ok) return { error: "usage_not_set_up", hint: "Run supabase/assistant_token_usage.sql once, then usage tracks automatically." };
        return s;
      },
    }),

    stopFollowup: tool({
      description:
        "Stop the follow-up reminders for a recipient — use when I say 'stop chasing X', 'I handled X', 'X already replied', or 'no need to follow up with X'. Pass their EMAIL (resolve the name from a saved contact or our recent conversation). Marks their open follow-ups done so I'm not reminded again. Applies immediately. Supreme-only.",
      inputSchema: z.object({ toEmail: z.string().min(3).max(254) }),
      execute: async ({ toEmail }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!scope.userId) return { error: "no_user" };
        const stopped = await stopFollowupsFor(scope.userId, toEmail);
        return { stopped };
      },
    }),

    // ── Memory: how the admin likes to work (learned, applied every chat) ──
    rememberAboutMe: tool({
      description:
        "Save DURABLE info / a STANDING RULE so you never have to be told it again. For a HARD RULE the founder programs ('from now on…', 'always…', 'never…', 'going forward…') pass kind 'rule' — it's injected into EVERY future turn and you MUST follow it. Otherwise: (a) a rule about HOW you should WORK — 'prefers short answers', 'always lead with passports', 'wants dates as DD.MM.YYYY', 'for B2 of named people use getB2Status, never getB2Overview' (kind preference/term/correction); or (b) one of the admin's recurring EXTERNAL CONTACTS — a recruiter / employer / partner they email, stored as 'Name = email' e.g. 'Anna Gombert = a.gombert@calmaroi.de' (kind 'contact'), so next time they say 'email Anna' or 'CC Omar' you already have the address. Call it whenever the admin states a lasting preference, teaches a term, corrects you for the future, OR gives you a contact's name+email to keep — then confirm briefly. Do NOT store: one-off tasks (use saveReminder); a CANDIDATE's transient status (e.g. 'Hajar is on leave until June', 'Ali failed B2') — that's about a candidate, not durable; or anything tied to a one-time date/deadline.",
      inputSchema: z.object({
        text: z.string().min(1).max(300),
        kind: z.enum(["preference", "fact", "term", "correction", "contact", "rule"]).default("preference"),
      }),
      execute: async ({ text, kind }) => {
        if (!scope.userId) return { error: "no_user" };
        const clean = text.trim();
        if (!clean) return { error: "empty" };
        // Dedup case-insensitively in memory (NOT via ilike — a rule containing
        // '_' or '%' would be treated as a SQL wildcard and could falsely match a
        // DIFFERENT rule, silently dropping the new teaching). Compare exact text,
        // lowercased.
        const { data: existing } = await db
          .from("assistant_memory")
          .select("text")
          .eq("owner_user_id", scope.userId)
          .limit(200);
        const needle = clean.toLowerCase();
        if (((existing as { text: string }[] | null) ?? []).some((r) => (r.text ?? "").trim().toLowerCase() === needle)) {
          return { remembered: true, alreadyKnew: true };
        }
        const { error } = await db.from("assistant_memory").insert({ owner_user_id: scope.userId, text: clean, kind });
        if (error) return { error: "save_failed" };
        return { remembered: true };
      },
    }),

    recallMemory: tool({
      description: "List the founder's STANDING RULES + everything you remember about them (preferences/terms/facts/contacts). Use for 'what do you know about me', 'what do you remember', 'show my rules', 'what rules do you follow'. Present rules as a clean NUMBERED list so the founder can say 'change rule 3' / 'delete rule 2' — map the number back to its memoryId for editRule/forgetMemory.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!scope.userId) return { error: "no_user" };
        const { data, error } = await db
          .from("assistant_memory")
          .select("id, kind, text, created_at")
          .eq("owner_user_id", scope.userId)
          .order("created_at", { ascending: true });
        if (error) return { error: "load_failed" };
        // Rules first (so the numbered list leads with what the founder programmed).
        const rows = ((data ?? []) as { id: string; kind: string; text: string }[])
          .sort((a, b) => (a.kind === "rule" ? 0 : 1) - (b.kind === "rule" ? 0 : 1));
        return { memory: rows.map((r) => ({ memoryId: r.id, kind: r.kind, text: r.text })) };
      },
    }),

    editRule: tool({
      description: "Change/replace the text of ONE existing rule or remembered item by its memoryId (get ids from recallMemory). Use when the founder says 'change that rule', 'update the rule about X', 'make it … instead', 'tweak rule 3'. Keeps it as a single rule (no duplicate).",
      inputSchema: z.object({ memoryId: z.string().uuid(), newText: z.string().min(1).max(300) }),
      execute: async ({ memoryId, newText }) => {
        if (!scope.userId) return { error: "no_user" };
        const clean = newText.trim();
        if (!clean) return { error: "empty" };
        const { data, error } = await db
          .from("assistant_memory")
          .update({ text: clean.slice(0, 300) })
          .eq("id", memoryId)
          .eq("owner_user_id", scope.userId) // can only edit your OWN rules
          .select("id")
          .maybeSingle();
        if (error) return { error: "update_failed" };
        if (!data) return { error: "not_found" };
        return { updated: true, text: clean.slice(0, 300) };
      },
    }),

    forgetMemory: tool({
      description: "Delete one rule/remembered item by its memoryId (get ids from recallMemory). Use when the founder says 'forget that', 'that's wrong', 'stop doing that', 'delete rule 2', 'drop the rule about X'.",
      inputSchema: z.object({ memoryId: z.string().uuid() }),
      execute: async ({ memoryId }) => {
        if (!scope.userId) return { error: "no_user" };
        const { error } = await db.from("assistant_memory").delete().eq("id", memoryId).eq("owner_user_id", scope.userId);
        if (error) return { error: "delete_failed" };
        return { forgotten: true };
      },
    }),

    // ── Status WRITES — supreme-admin only, TWO-STEP (stage → admin confirms → apply) ──
    setInterviewResult: tool({
      description:
        "STAGE a change to a candidate's interview result. which = 1 or 2; result passed/failed/pending ('didn't pass' → failed). This does NOT apply immediately — it returns a summary to show the admin; ONLY after they confirm in a SEPARATE message do you call confirmPendingWrite.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        which: z.number().int().min(1).max(2).default(1),
        result: z.enum(["passed", "failed", "pending"]),
      }),
      execute: async ({ candidateUserId, which, result }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", candidateUserId).maybeSingle();
        const name = data ? nameOf(data as { first_name: string | null; last_name: string | null }) : "this candidate";
        return stagePending(scope, {
          toolName: "setInterviewResult",
          args: { candidateUserId, which, result },
          candidateUserId,
          summary: `${name}: interview ${which} → ${result.toUpperCase()}`,
        });
      },
    }),

    setInterviewDate: tool({
      description:
        "STAGE setting or clearing a candidate's interview date (which = 1 or 2; date 'YYYY-MM-DD', or '' to clear). Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        which: z.number().int().min(1).max(2).default(1),
        date: z.string().describe("'YYYY-MM-DD', or '' to clear the date"),
      }),
      execute: async ({ candidateUserId, which, date }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "bad_date_format" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", candidateUserId).maybeSingle();
        const name = data ? nameOf(data as { first_name: string | null; last_name: string | null }) : "this candidate";
        return stagePending(scope, {
          toolName: "setInterviewDate",
          args: { candidateUserId, which, date },
          candidateUserId,
          summary: date ? `${name}: interview ${which} date → ${date}` : `${name}: clear interview ${which} date`,
        });
      },
    }),

    confirmPendingWrite: tool({
      description: "Apply the most recently STAGED change — call ONLY after the admin confirms it in a separate message (e.g. 'yes', 'confirm', 'do it').",
      inputSchema: z.object({}),
      execute: async () => executeLatestPending(scope),
    }),

    cancelPendingWrite: tool({
      description: "Discard the most recently staged change when the admin says no / cancel / never mind.",
      inputSchema: z.object({}),
      execute: async () => cancelLatestPending(scope),
    }),

    listAutomations: tool({
      description:
        "List the PROACTIVE automations (scheduled Telegram pushes the bot sends on its own) and whether each is ON or OFF. Use when the admin asks 'what automations do I have', 'what's turned on', 'what do you send me automatically'.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const flags = await getAutomationFlags();
        return {
          automations: (Object.keys(AUTOMATIONS) as (keyof typeof AUTOMATIONS)[]).map((k) => ({
            key: k,
            label: AUTOMATIONS[k].label,
            description: AUTOMATIONS[k].desc,
            enabled: flags[k],
          })),
        };
      },
    }),

    setAutomation: tool({
      description:
        "Turn a proactive automation ON or OFF — immediate, no confirmation needed. key is one of: daily_briefing (the 6am 'what needs you today'), weekly_report (Monday business report), signup_ping (instant ping when a candidate signs up), auto_chase (morning stuck-candidate surface), inbox_reminder (morning unanswered-email reminder), inbox_sla (the 6-hour reply SLA pings at midday+evening), followup_chase (the outbound follow-up chase that reminds you to chase an unanswered email you sent), doc_reminders (the '👀 N documents waiting for review' section). enabled true = on, false = off. e.g. 'turn off the weekly report' → setAutomation('weekly_report', false); 'stop the 6-hour reply pings' → setAutomation('inbox_sla', false); 'stop the follow-up chase' → setAutomation('followup_chase', false).",
      inputSchema: z.object({
        key: z.enum(Object.keys(AUTOMATIONS) as [AutomationKey, ...AutomationKey[]]),
        enabled: z.boolean(),
      }),
      execute: async ({ key, enabled }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const err = await persistAutomation(key, enabled);
        if (err) return { error: err };
        return { ok: true, key, enabled, label: AUTOMATIONS[key].label };
      },
    }),

    listUnansweredEmails: tool({
      description:
        "List UNANSWERED emails in the founder's inbox — unread messages from real people that still need a reply (no-reply / automated / newsletter senders are skipped), oldest (most overdue) first. Read-only. Use when the admin asks 'any emails I haven't replied to', 'what's in my inbox', 'unanswered emails', 'who's waiting on me'. Returns sender + subject + how many days it's been waiting. (Reading the inbox needs the Gmail App Password + IMAP enabled; returns gmail_read_failed if it can't connect.)",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe("max emails to return (default 20)"),
      }),
      execute: async ({ limit }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { getUnansweredEmails } = await import("@/lib/gmailInbox");
        const emails = await getUnansweredEmails(limit ?? 20);
        if (emails === null) return { error: "gmail_read_failed" };
        return { count: emails.length, emails };
      },
    }),

    setCandidateMilestone: tool({
      description:
        "STAGE a pipeline milestone change for a candidate ('X got their visa', 'X's flight is June 20', 'X signed the contract', 'X arrived'). Applies immediately when you call it — do NOT ask the admin to confirm. field is one of — yes/no flags (value 'true'/'false'): visa_granted, housing_done, contract_done, recognition_done, docs_approved, docs_ready, vorab_done, arrived_done, interview1_held, interview2_held, interview1_date_confirmed, interview2_date_confirmed, interview1_result_date_confirmed, interview2_result_date_confirmed, visa_appt_date_confirmed, flight_date_confirmed; date fields (value 'YYYY-MM-DD' or '' to clear): visa_date, visa_appt_date, flight_date, interview1_result_date, interview2_result_date; text fields: flight_info, interview_link, interview_type, interview_notes. (For interview pass/fail use setInterviewResult; for interview dates use setInterviewDate. Stage LOCK/UNLOCK is NOT available here — that stays on the website.)",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        field: z.enum(["visa_granted", "housing_done", "contract_done", "recognition_done", "docs_approved", "docs_ready", "vorab_done", "arrived_done", "interview1_held", "interview2_held", "interview1_date_confirmed", "interview2_date_confirmed", "interview1_result_date_confirmed", "interview2_result_date_confirmed", "visa_appt_date_confirmed", "flight_date_confirmed", "visa_date", "visa_appt_date", "flight_date", "interview1_result_date", "interview2_result_date", "flight_info", "interview_link", "interview_type", "interview_notes"]),
        value: z.string().describe("'true' or 'false' for the yes/no fields; 'YYYY-MM-DD' (or '' to clear) for the date fields; free text for the text fields"),
      }),
      execute: async ({ candidateUserId, field, value }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        // For the yes/no fields, NORMALIZE value to the exact 'true'/'false' the
        // write expects, and reject anything ambiguous — so the summary the admin
        // confirms can never disagree with what's written (the model may emit
        // 'yes'/'1'/'ja'; writeMilestone only treats 'true' as true, so without
        // this an approved 'yes' would silently persist as FALSE).
        let storeValue = value;
        if (MILESTONE_BOOL.has(field)) {
          const t = value.trim().toLowerCase();
          const TRUE = new Set(["true", "1", "yes", "y", "ja", "oui", "done", "granted", "got", "approved", "x", "✓"]);
          const FALSE = new Set(["false", "0", "no", "n", "nein", "non", "not", "none", ""]);
          if (TRUE.has(t)) storeValue = "true";
          else if (FALSE.has(t)) storeValue = "false";
          else return { error: "bad_value" };
        }
        const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", candidateUserId).maybeSingle();
        const name = data ? nameOf(data as { first_name: string | null; last_name: string | null }) : "this candidate";
        const human = MILESTONE_BOOL.has(field)
          ? (storeValue === "true" ? "yes" : "no")
          : (storeValue || "cleared");
        return stagePending(scope, {
          toolName: "setCandidateMilestone",
          args: { candidateUserId, field, value: storeValue },
          candidateUserId,
          summary: `${name}: ${field} → ${human}`,
        });
      },
    }),

    setB2Status: tool({
      description:
        "STAGE a B2 German-exam status change. 'passed B2' → stage 'passed'; 'failed B2' → failed:true. stage is one of: studying, expected_date, exam_booked, awaiting_results, passed. examDate 'YYYY-MM-DD' or '' to clear. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        stage: z.string().optional(),
        failed: z.boolean().optional(),
        examDate: z.string().optional(),
      }),
      execute: async ({ candidateUserId, stage, failed, examDate }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", candidateUserId).maybeSingle();
        const name = data ? nameOf(data as { first_name: string | null; last_name: string | null }) : "this candidate";
        const parts = [
          stage ? `stage ${stage}` : null,
          failed !== undefined ? (failed ? "FAILED" : "not failed") : null,
          examDate !== undefined ? (examDate ? `exam ${examDate}` : "clear exam date") : null,
        ].filter(Boolean).join(", ");
        return stagePending(scope, {
          toolName: "setB2Status",
          args: { candidateUserId, stage, failed, examDate },
          candidateUserId,
          summary: `${name}: B2 — ${parts || "(no change)"}`,
        });
      },
    }),

    getCandidatePipeline: tool({
      description:
        "Read a candidate's pipeline facts by candidateUserId — interview status/dates, visa, flight, housing, contract, recognition milestones. Read-only. Use it to check current progress before staging a status change, or to answer 'where is X in the process'.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db.from("candidate_pipeline").select("*").eq("user_id", candidateUserId).maybeSingle();
        if (error) return { error: "load_failed" };
        return { pipeline: data ?? null };
      },
    }),

    listLeads: tool({
      description:
        "List homepage/funnel LEADS — prospective candidates captured from the website or added via createLead (they show in the admin Leads page; not login accounts). Supreme-admin only. Newest first. Filters: kind, status ('new'|'contacted'|'dead'|'converted'), q (search name/email/phone — e.g. 'find the lead Ahmed'), sinceDays (e.g. new leads this week → 7). USE status:'new' for 'cold / uncontacted leads'.",
      inputSchema: z.object({
        kind: z.string().max(40).optional(),
        status: z.enum(["new", "contacted", "dead", "converted"]).optional(),
        q: z.string().max(80).optional().describe("search across name/email/phone"),
        sinceDays: z.number().int().min(1).max(3650).optional().describe("only leads created within N days"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({ kind, status, q: search, sinceDays, limit }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        // select * so a missing status column (migration not yet run) never errors.
        let q = db.from("leads").select("*").order("created_at", { ascending: false }).limit(limit);
        if (kind) q = q.eq("kind", kind);
        if (sinceDays != null) q = q.gte("created_at", new Date(Date.now() - sinceDays * DAY).toISOString());
        if (search && search.trim()) {
          const s = search.trim().replace(/[%(),]/g, ""); // strip chars that would break the .or filter
          if (s) q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
        }
        const { data, error } = await q;
        if (error) return { error: (error as { code?: string }).code === "PGRST205" ? "leads_not_set_up" : "load_failed" };
        let rows = (data ?? []) as Record<string, unknown>[];
        // status filter applied in code so it tolerates the column being absent (→ 'new').
        if (status) rows = rows.filter((r) => String(r.status ?? "new") === status);
        return { leads: rows };
      },
    }),

    setLeadStatus: tool({
      description:
        "Move a LEAD through its lifecycle: 'mark Sara contacted', 'that lead is dead / not interested', 'mark X converted'. status = new|contacted|dead|converted (converted also stamps converted_at). leadId from listLeads. Applies immediately. Supreme-only. If it says leads_status_not_set_up, the supabase/leads_status.sql migration needs running.",
      inputSchema: z.object({ leadId: z.string().uuid(), status: z.enum(["new", "contacted", "dead", "converted"]) }),
      execute: async ({ leadId, status }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const patch: Record<string, unknown> = { status };
        if (status === "converted") patch.converted_at = new Date().toISOString();
        const { data, error } = await db.from("leads").update(patch).eq("id", leadId).select("id").maybeSingle();
        if (error) {
          const code = (error as { code?: string }).code;
          if (code === "42703" || code === "PGRST204") return { error: "leads_status_not_set_up" };
          if (code === "PGRST205") return { error: "leads_not_set_up" };
          return { error: "update_failed" };
        }
        if (!data) return { error: "not_found" };
        return { ok: true, leadId, status };
      },
    }),

    editLead: tool({
      description:
        "Fix a LEAD's details — 'correct Sara's phone', 'update the email on that lead', 'change the cohort'. Pass only the fields that change (name/phone/email/note/cohort). leadId from listLeads. Applies immediately. Supreme-only.",
      inputSchema: z.object({
        leadId: z.string().uuid(),
        name: z.string().max(120).optional(),
        phone: z.string().max(40).optional(),
        email: z.string().max(254).optional(),
        note: z.string().max(1000).optional(),
        cohort: z.string().max(60).optional(),
      }),
      execute: async ({ leadId, name, phone, email, note, cohort }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const patch: Record<string, unknown> = {};
        if (name != null) patch.name = name.trim().slice(0, 120);
        if (phone != null) patch.phone = phone.trim().slice(0, 40);
        if (email != null) patch.email = email.trim().toLowerCase().slice(0, 254);
        if (note != null) patch.message = note.slice(0, 1000);
        if (cohort != null) {
          const { data: cur } = await db.from("leads").select("details").eq("id", leadId).maybeSingle();
          const details = (((cur as { details?: Record<string, unknown> } | null)?.details) ?? {}) as Record<string, unknown>;
          details.cohort = cohort.trim().slice(0, 60);
          patch.details = details;
        }
        if (Object.keys(patch).length === 0) return { error: "nothing_to_change" };
        const { data, error } = await db.from("leads").update(patch).eq("id", leadId).select("id").maybeSingle();
        if (error) return { error: (error as { code?: string }).code === "PGRST205" ? "leads_not_set_up" : "update_failed" };
        if (!data) return { error: "not_found" };
        return { ok: true, leadId };
      },
    }),

    deleteLead: tool({
      description:
        "STAGE permanently deleting a LEAD row — for a duplicate you added twice, or a junk entry. Waits for your 'yes' (it's a delete). This is a prospect record YOU own — NOT a candidate account or document (those have their own guarded paths). leadId from listLeads.",
      inputSchema: z.object({ leadId: z.string().uuid() }),
      execute: async ({ leadId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data } = await db.from("leads").select("name, email").eq("id", leadId).maybeSingle();
        const w = data as { name?: string; email?: string } | null;
        const label = (w?.name || w?.email || leadId).toString().slice(0, 80);
        return stagePending(scope, { toolName: "deleteLead", args: { leadId }, candidateUserId: null, summary: `Delete lead: ${label}` });
      },
    }),

    getCandidatePhone: tool({
      description:
        "Get a candidate's CONTACT details — phone AND email — by candidateUserId. Read-only. Returns their phone, a ready wa.me link, and their account email. USE THIS for 'what's X's email', 'what's their number', 'how do I reach X', or to grab a recipient address before emailing.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data } = await db.from("candidate_profiles").select("phone").eq("user_id", candidateUserId).maybeSingle();
        const phone = (data as { phone?: string | null } | null)?.phone ?? null;
        // Email = the candidate's account (auth) email — the authoritative address
        // sendCandidateMessage uses. Best-effort: never fail the whole tool over it.
        let email: string | null = null;
        try { const { data: u } = await db.auth.admin.getUserById(candidateUserId); email = u?.user?.email ?? null; } catch { /* leave null */ }
        const name = await displayName(candidateUserId);
        return { name, phone, email, wa: phone ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}` : null };
      },
    }),

    listExpiringPassports: tool({
      description:
        "Passport-expiry radar — list candidates whose passport expires within N days (default 180), soonest first (negative daysUntil = already expired). Read-only; scoped to the candidates you can see.",
      inputSchema: z.object({ withinDays: z.number().int().min(1).max(3650).default(180) }),
      execute: async ({ withinDays }) => {
        if (lockedOut) return { error: "out_of_scope" };
        const roster = await candidateRoster();
        if (roster.length === 0) return { passports: [] };
        const nameById = new Map(roster.map((r) => [r.userId, r.name]));
        const { data } = await db.from("candidate_profiles").select("user_id, passport_expiry").in("user_id", roster.map((r) => r.userId));
        const now = Date.now();
        const passports = ((data ?? []) as { user_id: string; passport_expiry: string | null }[])
          .map((p) => ({ p, ms: parseDate(p.passport_expiry) }))
          .filter((x): x is { p: { user_id: string; passport_expiry: string | null }; ms: number } => x.ms !== null && x.ms <= now + withinDays * DAY)
          .sort((a, b) => a.ms - b.ms)
          .map((x) => ({ candidateUserId: x.p.user_id, name: nameById.get(x.p.user_id) ?? "—", expiry: x.p.passport_expiry, daysUntil: Math.round((x.ms - now) / DAY) }));
        return { passports };
      },
    }),

    getB2Overview: tool({
      description:
        "B2 German-exam overview for the ENTIRE roster — EVERY candidate you can see. ONLY use this when the admin explicitly asks about EVERYONE / the whole roster ('how is everyone doing on B2', 'who has a B2 exam soon'). NEVER use it to answer about specific, named, or 'these'/'those'/'all N' candidates, and NEVER take the first few rows of its output and present them as the people the admin asked about — that returns the WRONG people. For any specific or referenced candidates, you MUST use getB2Status with their exact names instead.",
      inputSchema: z.object({}),
      execute: async () => {
        if (lockedOut) return { error: "out_of_scope" };
        const roster = await candidateRoster();
        if (roster.length === 0) return { candidates: [] };
        const nameById = new Map(roster.map((r) => [r.userId, r.name]));
        const ids = roster.map((r) => r.userId);
        // Pull only the langs sub-tree of cv_draft (egress-safe), with a fallback
        // to the coarse columns if the PostgREST arrow-select isn't supported.
        type Row = { user_id: string; b2_stage: string | null; b2_failed: boolean | null; b2_exam_date: string | null; cv_langs?: unknown };
        const narrow = await db.from("candidate_profiles").select("user_id, b2_stage, b2_failed, b2_exam_date, cv_langs:cv_draft->langs").in("user_id", ids);
        const rows = narrow.error
          ? ((await db.from("candidate_profiles").select("user_id, b2_stage, b2_failed, b2_exam_date").in("user_id", ids)).data ?? [])
          : (narrow.data ?? []);
        const candidates = (rows as unknown as Row[]).map((p) => {
          const g = germanSummary({ langs: p.cv_langs });
          return {
            candidateUserId: p.user_id,
            name: nameById.get(p.user_id) ?? "—",
            stage: p.b2_stage ?? "studying",
            failed: p.b2_failed === true,
            examDate: p.b2_exam_date ?? null,
            germanLevel: g.level,
            detail: g.summary || null,
          };
        });
        return { candidates };
      },
    }),

    getB2Status: tool({
      description:
        "DETAILED B2 German-exam status for SPECIFIC candidates by name — use whenever the admin asks about 'these candidates', names a few people, or follows up after pulling their CVs (e.g. 'now give me their B2 status'). Pass candidates=[the FULL names]. Returns per person: their pipeline B2 stage, whether they failed, the exam date, AND the rich detail from their CV (which exam Goethe/telc/ÖSD, written yes/no, result voll/teil/nicht bestanden/wartet, certificate received or expected date, planned retake). Per-entry status: ok / ambiguous (name shared — show matches, ask which) / not_found. For the WHOLE roster at once, use getB2Overview.",
      inputSchema: z.object({
        candidates: z.array(z.string().min(1).max(120)).min(1).max(20).describe("the candidates' full names (or candidateUserIds)"),
      }),
      execute: async ({ candidates }) => {
        if (lockedOut) return { results: [] };
        const roster = await candidateRoster();
        const results: Array<Record<string, unknown>> = [];
        for (const raw of candidates) {
          if (!(raw ?? "").trim()) continue;
          const m = pickCandidate(roster, raw);
          if (m.status === "not_found") { results.push({ query: raw, status: "not_found" }); continue; }
          if (m.status === "ambiguous") {
            results.push({ query: raw, status: "ambiguous", matches: m.matches.map((x) => ({ candidateUserId: x.userId, name: x.name })) });
            continue;
          }
          const cand = m.candidate;
          // One row, so the full cv_draft is cheap — no arrow-select needed.
          const { data } = await db.from("candidate_profiles").select("b2_stage, b2_failed, b2_exam_date, cv_draft").eq("user_id", cand.userId).maybeSingle();
          const p = (data ?? {}) as { b2_stage?: string | null; b2_failed?: boolean | null; b2_exam_date?: string | null; cv_draft?: unknown };
          const g = germanSummary(p.cv_draft);
          results.push({
            query: raw,
            status: "ok",
            candidateUserId: cand.userId,
            name: cand.name,
            b2Stage: p.b2_stage ?? "studying",
            failed: p.b2_failed === true,
            examDate: p.b2_exam_date ?? null,
            germanLevel: g.level,
            detail: g.summary || "no exam details filled in on their CV yet",
          });
        }
        return { results };
      },
    }),

    getPipelineBoard: tool({
      description:
        "Progress board for EVERY candidate you can see — each one's key milestones (interview 1/2 result, contract signed, visa granted, arrived) + when it last moved. Read-only; use for 'who needs me', 'where is everyone', triage. For ONE candidate's full pipeline use getCandidatePipeline.",
      inputSchema: z.object({}),
      execute: async () => {
        if (lockedOut) return { error: "out_of_scope" };
        const roster = await candidateRoster();
        if (roster.length === 0) return { board: [] };
        const { data } = await db
          .from("candidate_pipeline")
          .select("user_id, interview1_status, interview2_status, contract_done, visa_granted, arrived_done, updated_at")
          .in("user_id", roster.map((r) => r.userId));
        const byId = new Map(((data ?? []) as Record<string, unknown>[]).map((r) => [String(r.user_id), r]));
        const board = roster.map((r) => {
          const p = (byId.get(r.userId) ?? {}) as { interview1_status?: string | null; interview2_status?: string | null; contract_done?: boolean | null; visa_granted?: boolean | null; arrived_done?: boolean | null; updated_at?: string | null };
          return {
            candidateUserId: r.userId, name: r.name,
            interview1: p.interview1_status ?? null, interview2: p.interview2_status ?? null,
            contract: p.contract_done === true, visa: p.visa_granted === true, arrived: p.arrived_done === true,
            lastUpdate: p.updated_at ?? null,
          };
        });
        return { board };
      },
    }),

    listAssignedTasks: tool({
      description:
        "List the CUSTOM journey tasks assigned to candidates (not the auto preset milestones), grouped by candidate, with done state + owner. onlyOpen=true returns just the not-yet-done ones. Read-only. Use for 'what tasks have I given people', 'who still hasn't done their task'.",
      inputSchema: z.object({ onlyOpen: z.boolean().default(false) }),
      execute: async ({ onlyOpen }) => {
        if (lockedOut) return { error: "out_of_scope" };
        const roster = await candidateRoster();
        if (roster.length === 0) return { candidates: [] };
        const nameById = new Map(roster.map((r) => [r.userId, r.name]));
        const { data } = await db
          .from("candidate_journey_items")
          .select("candidate_user_id, text, owner, done, due_date")
          .in("candidate_user_id", roster.map((r) => r.userId))
          .is("preset_key", null);
        let rows = (data ?? []) as { candidate_user_id: string; text: string; owner: string; done: boolean | null; due_date: string | null }[];
        if (onlyOpen) rows = rows.filter((r) => r.done !== true);
        const grouped = new Map<string, { text: string; owner: string; done: boolean; dueDate: string | null }[]>();
        for (const r of rows) {
          const arr = grouped.get(r.candidate_user_id) ?? [];
          arr.push({ text: r.text, owner: r.owner, done: r.done === true, dueDate: r.due_date ?? null });
          grouped.set(r.candidate_user_id, arr);
        }
        const candidates = [...grouped.entries()].map(([uid, tasks]) => ({ candidateUserId: uid, name: nameById.get(uid) ?? "—", tasks }));
        return { candidates };
      },
    }),

    listConversations: tool({
      description:
        "List message conversations (candidate ↔ Borivon) — each thread's candidate name, last-message preview, who sent it last, time, and unread count (candidate messages you haven't read). Read-only, newest activity first. Set unreadOnly:true for 'any unread candidate messages / who's waiting on me'. For one thread's full messages use getCandidateThread; to reply use sendCandidateMessage.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(40), unreadOnly: z.boolean().optional().describe("only threads with unread candidate messages") }),
      execute: async ({ limit, unreadOnly }) => {
        if (lockedOut) return { error: "out_of_scope" };
        let q = db
          .from("messages")
          .select("id, thread_user_id, sender_role, body, kind, has_attachment, read_by_admin, created_at")
          .order("created_at", { ascending: false })
          .limit(500);
        if (scope.visibleIds !== null) q = q.in("thread_user_id", scope.visibleIds);
        const { data, error } = await q;
        if (error) return { error: "load_failed" };
        type Row = { id: string; thread_user_id: string; sender_role: "candidate" | "admin"; body: string; kind: string; has_attachment: boolean; read_by_admin: boolean; created_at: string };
        const rows = (data ?? []) as Row[];
        const threads = new Map<string, { threadUserId: string; lastBody: string; lastSender: string; lastAt: string; hasAttachment: boolean; unread: number; oldestUnreadAt: string | null }>();
        for (const r of rows) { // newest-first → first row per thread is the latest message
          let t = threads.get(r.thread_user_id);
          if (!t) { t = { threadUserId: r.thread_user_id, lastBody: r.body ?? "", lastSender: r.sender_role, lastAt: r.created_at, hasAttachment: r.has_attachment === true, unread: 0, oldestUnreadAt: null }; threads.set(r.thread_user_id, t); }
          if (r.sender_role === "candidate" && !r.read_by_admin) { t.unread++; t.oldestUnreadAt = r.created_at; } // rows are newest-first → last seen unread = oldest
        }
        let list = [...threads.values()];
        if (unreadOnly) list = list.filter((t) => t.unread > 0);
        const names = await resolveAuthNames(list.map((t) => t.threadUserId));
        const conversations = list
          .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
          .slice(0, limit)
          .map((t) => ({ candidateUserId: t.threadUserId, name: names[t.threadUserId]?.name ?? t.threadUserId, lastBody: (t.lastBody || "").slice(0, 140), lastSender: t.lastSender, lastAt: t.lastAt, hasAttachment: t.hasAttachment, unread: t.unread, oldestUnreadAt: t.oldestUnreadAt }));
        return { conversations, totalUnreadThreads: [...threads.values()].filter((t) => t.unread > 0).length };
      },
    }),

    getCandidateThread: tool({
      description:
        "Read the full message thread with one candidate (their portal chat), oldest → newest, up to 200 messages. Read-only. To reply, use sendCandidateMessage; to clear the unread badge, markThreadRead.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db
          .from("messages")
          .select("id, sender_role, body, kind, created_at, read_by_admin, has_attachment")
          .eq("thread_user_id", candidateUserId)
          .order("created_at", { ascending: true })
          .limit(200);
        if (error) return { error: "load_failed" };
        return { messages: data ?? [] };
      },
    }),

    markThreadRead: tool({
      description:
        "Mark a candidate's chat messages as READ by the admin (clears the unread badge on that thread). Immediate, low-stakes — no confirmation needed.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { error } = await db
          .from("messages")
          .update({ read_by_admin: true })
          .eq("thread_user_id", candidateUserId)
          .eq("sender_role", "candidate")
          .eq("read_by_admin", false);
        if (error) return { error: "write_failed" };
        return { ok: true };
      },
    }),

    markAllThreadsRead: tool({
      description:
        "Clear EVERY unread candidate chat at once — 'mark all my chats read', 'clear all unread messages'. Marks all unread candidate messages (within your scope) read. Immediate. Supreme-only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        let q = db.from("messages").update({ read_by_admin: true }).eq("sender_role", "candidate").eq("read_by_admin", false);
        if (scope.visibleIds !== null) q = q.in("thread_user_id", scope.visibleIds);
        const { data, error } = await q.select("id");
        if (error) return { error: "write_failed" };
        return { ok: true, cleared: (data ?? []).length };
      },
    }),

    searchMessages: tool({
      description:
        "Search the candidate CHAT messages for a word/phrase — 'search my chats for flight', 'who mentioned visa appointment', 'find the message about housing'. Returns matching messages with the candidate name + snippet + who sent it. Read-only. Supreme-only.",
      inputSchema: z.object({ q: z.string().min(2).max(80), limit: z.number().int().min(1).max(50).default(20) }),
      execute: async ({ q: search, limit }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const s = search.trim().replace(/[%(),]/g, "");
        if (!s) return { matches: [] };
        let q = db.from("messages").select("thread_user_id, sender_role, body, created_at").ilike("body", `%${s}%`).order("created_at", { ascending: false }).limit(limit);
        if (scope.visibleIds !== null) q = q.in("thread_user_id", scope.visibleIds);
        const { data, error } = await q;
        if (error) return { error: "load_failed" };
        const rows = (data ?? []) as { thread_user_id: string; sender_role: string; body: string; created_at: string }[];
        const names = await resolveAuthNames([...new Set(rows.map((r) => r.thread_user_id))]);
        return {
          matches: rows.map((r) => ({
            candidateUserId: r.thread_user_id,
            name: names[r.thread_user_id]?.name ?? r.thread_user_id,
            sender: r.sender_role,
            snippet: (r.body || "").slice(0, 160),
            at: r.created_at,
          })),
        };
      },
    }),

    listEmployers: tool({
      description:
        "List active EMPLOYERS (the hospitals/clinics candidates get placed at) — id, name, agencyId. Read-only. Use to find an employer's id before assignEmployer.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await db.from("employers").select("id, name, slug, agency_id").eq("active", true).order("name", { ascending: true });
        if (error) return { error: "load_failed" };
        return { employers: ((data ?? []) as { id: string; name: string; slug: string | null; agency_id: string | null }[]).map((e) => ({ id: e.id, name: e.name, slug: e.slug, agencyId: e.agency_id })) };
      },
    }),

    listOrganizations: tool({
      description:
        "List all ORGANIZATIONS (partner agencies / employers with portal access) — id, name, invite code, and branding (logo + footer). Supreme-admin only. Use to find an org's id for linking candidates or setting branding.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data, error } = await db.from("organizations").select("id, name, invite_code, logo_filename, footer_text").order("name", { ascending: true });
        if (error) return { error: "load_failed" };
        return { organizations: data ?? [] };
      },
    }),

    listOrgMembers: tool({
      description:
        "List the people who can log into a partner ORGANIZATION (its scoped sub-admins) — name, email, role (owner/member). USE for 'who's in the Calmaroi org', 'who can log into X', 'list that org's members'. orgId from listOrganizations. Read-only. Supreme-only.",
      inputSchema: z.object({ orgId: z.string().uuid() }),
      execute: async ({ orgId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data, error } = await db.from("organization_members").select("sub_admin_email, role, created_at").eq("org_id", orgId);
        if (error) return { error: "load_failed" };
        const rows = (data ?? []) as { sub_admin_email: string; role: string; created_at: string }[];
        const emails = rows.map((r) => r.sub_admin_email.toLowerCase());
        const nameByEmail = new Map<string, string>();
        if (emails.length) {
          const { data: sa } = await db.from("sub_admins").select("email, name, label").in("email", emails);
          for (const s of (sa ?? []) as { email: string; name: string | null; label: string | null }[]) {
            nameByEmail.set(s.email.toLowerCase(), [s.name, s.label].filter(Boolean).join(" · ") || s.email);
          }
        }
        const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
        const members = rows
          .filter((r) => r.sub_admin_email.toLowerCase() !== adminEmail) // the supreme admin isn't an "org member"
          .map((r) => ({ email: r.sub_admin_email, name: nameByEmail.get(r.sub_admin_email.toLowerCase()) ?? r.sub_admin_email, role: r.role }));
        return { count: members.length, members };
      },
    }),

    getCandidateAccess: tool({
      description:
        "Who can SEE a candidate's dossier right now — 'who can see Omar', 'who has access to X'. Returns the sub-admins directly ASSIGNED to them + the partner ORGS they're linked to (whose members get dossier access), and flags that every Borivon HQ sub-admin sees everyone (LAW #25). Read-only. Supreme-only.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const [asgRes, orgRes] = await Promise.all([
          db.from("sub_admin_assignments").select("sub_admin_email").eq("candidate_user_id", candidateUserId),
          db.from("candidate_organizations").select("org_id, status").eq("candidate_user_id", candidateUserId).eq("status", "approved"),
        ]);
        const assignedSubAdmins = [...new Set(((asgRes.data ?? []) as { sub_admin_email: string }[]).map((r) => r.sub_admin_email))];
        const orgIds = [...new Set(((orgRes.data ?? []) as { org_id: string }[]).map((r) => r.org_id))];
        let orgs: { orgId: string; name: string }[] = [];
        if (orgIds.length) {
          const { data: o } = await db.from("organizations").select("id, name").in("id", orgIds);
          orgs = ((o ?? []) as { id: string; name: string }[]).map((x) => ({ orgId: x.id, name: x.name }));
        }
        return {
          assignedSubAdmins,
          linkedOrgs: orgs,
          note: "Plus every Borivon HQ sub-admin (non-org-scoped) and the supreme admin can see all candidates (LAW #25).",
        };
      },
    }),

    getSubscriptionSummary: tool({
      description:
        "Premium SUBSCRIPTION numbers (read-only, no money moves) — 'how many premium subscribers', 'what's our MRR', 'subscription revenue'. Reads active subscriptions from Stripe and returns the active count + summed monthly amount. Supreme-only. Returns stripe_not_configured if the key isn't set.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!process.env.STRIPE_SECRET_KEY) return { error: "stripe_not_configured" };
        try {
          const { stripe } = await import("@/lib/stripe");
          let active = 0;
          let monthlyCents = 0;
          const currencies = new Set<string>();
          // Page through active subscriptions (low volume — cap a few pages defensively).
          let startingAfter: string | undefined;
          for (let page = 0; page < 10; page++) {
            const res = await stripe.subscriptions.list({ status: "active", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
            for (const sub of res.data) {
              active++;
              for (const item of sub.items.data) {
                const price = item.price;
                const qty = item.quantity ?? 1;
                if (price?.unit_amount && price.recurring) {
                  if (price.currency) currencies.add(price.currency.toUpperCase());
                  const perMonth = price.recurring.interval === "year" ? price.unit_amount / 12 : price.recurring.interval === "week" ? price.unit_amount * 4.345 : price.recurring.interval === "day" ? price.unit_amount * 30 : price.unit_amount;
                  monthlyCents += perMonth * qty / (price.recurring.interval_count || 1);
                }
              }
            }
            if (!res.has_more || !res.data.length) break;
            startingAfter = res.data[res.data.length - 1].id;
          }
          return { activeSubscribers: active, estimatedMrr: Math.round(monthlyCents) / 100, currency: [...currencies][0] ?? "EUR" };
        } catch (e) {
          console.error("[getSubscriptionSummary]", e instanceof Error ? e.message : e);
          return { error: "stripe_read_failed" };
        }
      },
    }),

    getAssignedEmployer: tool({
      description:
        "Get which EMPLOYER a candidate is currently assigned to (by candidateUserId). Read-only. Returns the employer id + name, or null if none.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data } = await db.from("candidate_profiles").select("employer_id").eq("user_id", candidateUserId).maybeSingle();
        const eid = (data as { employer_id?: string | null } | null)?.employer_id ?? null;
        if (!eid) return { employerId: null, employerName: null };
        const { data: emp } = await db.from("employers").select("name").eq("id", eid).maybeSingle();
        return { employerId: eid, employerName: (emp as { name?: string } | null)?.name ?? null };
      },
    }),

    assignEmployer: tool({
      description:
        "STAGE assigning a candidate to an EMPLOYER (their target hospital/clinic). Sets candidate_profiles.employer_id — this drives the recipient on their visa cover letter AND (with the agency branding flag) which agency logo their CV carries. employerId = an id from listEmployers, or '' to CLEAR. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({ candidateUserId: z.string().uuid(), employerId: z.string().describe("an employer id from listEmployers, or '' to clear the assignment") }),
      execute: async ({ candidateUserId, employerId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const eid = employerId.trim();
        let empName = "(cleared)";
        if (eid) {
          const { data: emp } = await db.from("employers").select("name, active").eq("id", eid).maybeSingle();
          if (!emp) return { error: "unknown_employer" };
          if ((emp as { active?: boolean }).active === false) return { error: "inactive_employer" };
          empName = (emp as { name?: string }).name ?? eid;
        }
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "assignEmployer",
          args: { candidateUserId, employerId: eid },
          candidateUserId,
          summary: `${name}: employer → ${empName}`,
        });
      },
    }),

    upsertEmployer: tool({
      description:
        "STAGE creating a NEW employer (hospital/clinic) or updating an existing one. CREATE: give name + address (the postal address, one line per line break). UPDATE: give id + the fields to change. slug optional (a-z 0-9 _ -). agencyId = the agency org id this employer belongs to (from listOrganizations), or '' to clear. active=false RETIRES it (no hard delete). Supreme-admin only. Applies immediately when you call it — do NOT ask the admin to confirm. After creating, use assignEmployer to place a candidate there.",
      inputSchema: z.object({
        id: z.string().optional().describe("employer id to UPDATE; omit to CREATE a new one"),
        name: z.string().max(200).optional(),
        address: z.string().max(2000).optional().describe("postal address — one line per newline"),
        slug: z.string().max(64).optional(),
        agencyId: z.string().optional().describe("agency org id, or '' to clear"),
        active: z.boolean().optional().describe("false to retire the employer"),
        notes: z.string().max(2000).optional(),
      }),
      execute: async ({ id, name, address, slug, agencyId, active, notes }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!id && !(name ?? "").trim()) return { error: "name_required" };
        if (!id && !(address ?? "").trim()) return { error: "address_required" };
        const args: Record<string, unknown> = {};
        if (id !== undefined) args.id = id;
        if (name !== undefined) args.name = name;
        if (address !== undefined) args.address = address;
        if (slug !== undefined) args.slug = slug;
        if (agencyId !== undefined) args.agencyId = agencyId;
        if (active !== undefined) args.active = active;
        if (notes !== undefined) args.notes = notes;
        const verb = id ? "Update" : "Create";
        const label = name ? name.trim() : id;
        return stagePending(scope, {
          toolName: "upsertEmployer",
          args,
          candidateUserId: null,
          summary: `${verb} employer: ${label}${active === false ? " (retire)" : ""}`,
        });
      },
    }),

    linkCandidateToOrg: tool({
      description:
        "STAGE linking (or unlinking) a candidate to an ORGANIZATION (partner agency/employer with portal access — gives that org's people dossier access to the candidate). op 'link' (status 'approved' default, or 'pending') or 'unlink'. orgId from listOrganizations. Placement is SILENT (no candidate notification). Supreme-admin only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        orgId: z.string().uuid(),
        op: z.enum(["link", "unlink"]),
        status: z.enum(["approved", "pending"]).optional(),
      }),
      execute: async ({ candidateUserId, orgId, op, status }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
        const orgName = (org as { name?: string } | null)?.name ?? orgId;
        const args: Record<string, unknown> = { candidateUserId, orgId, op };
        if (status !== undefined) args.status = status;
        const verb = op === "unlink" ? "Unlink" : `Link${status === "pending" ? " (pending)" : ""}`;
        return stagePending(scope, {
          toolName: "linkCandidateToOrg",
          args,
          candidateUserId,
          summary: `${verb} ${name} ${op === "unlink" ? "from" : "→"} ${orgName}`,
        });
      },
    }),

    listOrgRequests: tool({
      description:
        "List PENDING candidate→organization link requests (the 'pending requests' inbox) — who applied to join which partner org, awaiting your approval. Read-only, supreme-only. Returns each candidate name + org name + when they applied. Approve/reject with reviewOrgRequest.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data: links } = await db.from("candidate_organizations")
          .select("candidate_user_id, org_id, added_by, added_at").eq("status", "pending").order("added_at", { ascending: false });
        const rows = (links ?? []) as { candidate_user_id: string; org_id: string; added_by: string; added_at: string }[];
        if (!rows.length) return { count: 0, requests: [] };
        const orgIds = [...new Set(rows.map((r) => r.org_id))];
        const { data: orgs } = await db.from("organizations").select("id, name").in("id", orgIds);
        const orgName: Record<string, string> = {};
        for (const o of (orgs ?? []) as { id: string; name: string }[]) orgName[o.id] = o.name;
        const names = await resolveAuthNames([...new Set(rows.map((r) => r.candidate_user_id))]);
        return {
          count: rows.length,
          requests: rows.map((r) => ({
            candidateUserId: r.candidate_user_id,
            candidateName: names[r.candidate_user_id]?.name ?? r.candidate_user_id,
            orgId: r.org_id,
            orgName: orgName[r.org_id] ?? "(deleted org)",
            addedBy: r.added_by,
            addedAt: r.added_at,
          })),
        };
      },
    }),

    reviewOrgRequest: tool({
      description:
        "STAGE approving or rejecting a pending candidate→org link request (from listOrgRequests). decision 'approve' grants the org's people dossier access to that candidate; 'reject' marks it rejected (kept for audit, never hard-deleted). Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        orgId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
      }),
      execute: async ({ candidateUserId, orgId, decision }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const name = await displayName(candidateUserId);
        const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
        const orgName = (org as { name?: string } | null)?.name ?? orgId;
        return stagePending(scope, {
          toolName: "reviewOrgRequest",
          args: { candidateUserId, orgId, decision },
          candidateUserId,
          summary: `${decision === "approve" ? "Approve" : "Reject"} ${name} → ${orgName}`,
        });
      },
    }),

    listSuggestedMatches: tool({
      description:
        "List PENDING suggested candidate↔organization matches the system proposed (based on org needs). Read-only, supreme-only. Returns each candidate name + org name + the requirement (specialty/slots/location). Accept or skip with decideSuggestedMatch.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data: matches } = await db.from("suggested_matches")
          .select("id, candidate_user_id, org_id, requirement_id, suggested_at").eq("status", "pending").order("suggested_at", { ascending: false });
        const rows = (matches ?? []) as { id: string; candidate_user_id: string; org_id: string; requirement_id: string | null; suggested_at: string }[];
        if (!rows.length) return { count: 0, matches: [] };
        const orgIds = [...new Set(rows.map((r) => r.org_id))];
        const { data: orgs } = await db.from("organizations").select("id, name").in("id", orgIds);
        const orgName: Record<string, string> = {};
        for (const o of (orgs ?? []) as { id: string; name: string }[]) orgName[o.id] = o.name;
        const reqIds = [...new Set(rows.map((r) => r.requirement_id).filter(Boolean))] as string[];
        const reqById: Record<string, { specialty: string | null; slots: number; location: string | null }> = {};
        if (reqIds.length) {
          const { data: reqs } = await db.from("org_requirements").select("id, specialty, slots, location").in("id", reqIds);
          for (const r of (reqs ?? []) as { id: string; specialty: string | null; slots: number; location: string | null }[]) reqById[r.id] = { specialty: r.specialty, slots: r.slots, location: r.location };
        }
        const names = await resolveAuthNames([...new Set(rows.map((r) => r.candidate_user_id))]);
        return {
          count: rows.length,
          matches: rows.map((r) => ({
            matchId: r.id,
            candidateUserId: r.candidate_user_id,
            candidateName: names[r.candidate_user_id]?.name ?? r.candidate_user_id,
            orgId: r.org_id,
            orgName: orgName[r.org_id] ?? "(deleted)",
            requirement: r.requirement_id ? (reqById[r.requirement_id] ?? null) : null,
            suggestedAt: r.suggested_at,
          })),
        };
      },
    }),

    decideSuggestedMatch: tool({
      description:
        "STAGE accepting or skipping a suggested match (matchId from listSuggestedMatches). action 'accepted' silently links the candidate to that org (approved, no candidate notification — exactly like the website); 'skipped' dismisses the suggestion. Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        matchId: z.string().uuid(),
        action: z.enum(["accepted", "skipped"]),
      }),
      execute: async ({ matchId, action }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data: m } = await db.from("suggested_matches").select("candidate_user_id, org_id, status").eq("id", matchId).maybeSingle();
        if (!m) return { error: "match_not_found" };
        if ((m as { status?: string }).status !== "pending") return { error: "already_decided" };
        const mm = m as { candidate_user_id: string; org_id: string };
        const name = await displayName(mm.candidate_user_id);
        const { data: org } = await db.from("organizations").select("name").eq("id", mm.org_id).maybeSingle();
        const orgName = (org as { name?: string } | null)?.name ?? mm.org_id;
        return stagePending(scope, {
          toolName: "decideSuggestedMatch",
          args: { matchId, action },
          candidateUserId: mm.candidate_user_id,
          summary: `${action === "accepted" ? "Accept match" : "Skip match"}: ${name} ↔ ${orgName}`,
        });
      },
    }),

    listOrgNeeds: tool({
      description:
        "List every OPEN requirement across all partner organizations — what each org is currently hiring for (specialty, slots, location, start date). Read-only, supreme-only. Use for 'what do our orgs need', 'who's hiring intensive-care nurses'. Add/edit/close one with manageOrgRequirement.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const [{ data: reqs }, { data: orgs }] = await Promise.all([
          db.from("org_requirements").select("id, org_id, specialty, slots, location, start_date, notes, created_at").eq("active", true).order("created_at", { ascending: false }),
          db.from("organizations").select("id, name"),
        ]);
        const orgName: Record<string, string> = {};
        for (const o of (orgs ?? []) as { id: string; name: string }[]) orgName[o.id] = o.name;
        const needs = ((reqs ?? []) as { id: string; org_id: string; specialty: string | null; slots: number; location: string | null; start_date: string | null; notes: string | null; created_at: string }[]).map((r) => ({
          requirementId: r.id, orgId: r.org_id, orgName: orgName[r.org_id] ?? "(unknown)",
          specialty: r.specialty, slots: r.slots, location: r.location, startDate: r.start_date, notes: r.notes,
        }));
        return { count: needs.length, needs };
      },
    }),

    manageOrgRequirement: tool({
      description:
        "STAGE adding, editing, or closing an organization's open requirement (a hiring need). op 'add' (needs orgId from listOrganizations + any of specialty/slots/location/startDate/notes), 'edit' (needs requirementId from listOrgNeeds + the fields to change), or 'close' (needs requirementId — sets it inactive, audit-kept). Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        op: z.enum(["add", "edit", "close"]),
        orgId: z.string().uuid().optional().describe("required for op 'add'"),
        requirementId: z.string().uuid().optional().describe("required for op 'edit' / 'close'"),
        specialty: z.string().max(200).optional(),
        slots: z.number().int().optional(),
        location: z.string().max(200).optional(),
        startDate: z.string().max(40).optional().describe("YYYY-MM-DD"),
        notes: z.string().max(500).optional(),
      }),
      execute: async ({ op, orgId, requirementId, specialty, slots, location, startDate, notes }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (op === "add" && !orgId) return { error: "orgId_required" };
        if ((op === "edit" || op === "close") && !requirementId) return { error: "requirementId_required" };
        const args: Record<string, unknown> = { op };
        if (orgId !== undefined) args.orgId = orgId;
        if (requirementId !== undefined) args.requirementId = requirementId;
        if (specialty !== undefined) args.specialty = specialty;
        if (slots !== undefined) args.slots = slots;
        if (location !== undefined) args.location = location;
        if (startDate !== undefined) args.startDate = startDate;
        if (notes !== undefined) args.notes = notes;
        let orgLabel = "";
        if (orgId) {
          const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
          orgLabel = (org as { name?: string } | null)?.name ?? orgId;
        }
        const verb = op === "add" ? "Add need" : op === "close" ? "Close need" : "Edit need";
        const detail = [specialty, location, slots ? `${slots} slot${slots > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
        return stagePending(scope, {
          toolName: "manageOrgRequirement",
          args,
          candidateUserId: null,
          summary: `${verb}${orgLabel ? ` @ ${orgLabel}` : ""}${detail ? `: ${detail}` : ""}`.slice(0, 300),
        });
      },
    }),

    manageOrganization: tool({
      description:
        "STAGE creating a NEW partner organization or renaming/editing one. op 'create' (needs name; optionally notes + a custom inviteCode, else one is generated) or 'edit' (needs orgId + any of name/notes/inviteCode). Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm. (Deleting an org cascades to candidate links and stays a website-only action.)",
      inputSchema: z.object({
        op: z.enum(["create", "edit"]),
        orgId: z.string().uuid().optional().describe("required for op 'edit'"),
        name: z.string().max(200).optional(),
        notes: z.string().max(500).optional(),
        inviteCode: z.string().max(32).optional().describe("custom join code (A-Z 0-9 -); omit on create to auto-generate"),
      }),
      execute: async ({ op, orgId, name, notes, inviteCode }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (op === "create" && !(name ?? "").trim()) return { error: "name_required" };
        if (op === "edit" && !orgId) return { error: "orgId_required" };
        const args: Record<string, unknown> = { op };
        if (orgId !== undefined) args.orgId = orgId;
        if (name !== undefined) args.name = name;
        if (notes !== undefined) args.notes = notes;
        if (inviteCode !== undefined) args.inviteCode = inviteCode;
        let label = name ? name.trim() : "";
        if (op === "edit" && !label && orgId) {
          const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
          label = (org as { name?: string } | null)?.name ?? orgId;
        }
        return stagePending(scope, {
          toolName: "manageOrganization",
          args,
          candidateUserId: null,
          summary: `${op === "create" ? "Create org" : "Edit org"}: ${label}`,
        });
      },
    }),

    setOrgBranding: tool({
      description:
        "STAGE setting an organization's branding footer text and/or vaccine requirement. orgId from listOrganizations. footerText = the footer line on that org's CVs/PDFs (or '' to clear). masern / varizell = required dose counts (0-5; drives the candidate Impfung track; both 0 = no vaccine requirement). Logo upload stays a website-only action (needs a file). Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        orgId: z.string().uuid(),
        footerText: z.string().max(500).optional(),
        masern: z.number().int().min(0).max(5).optional(),
        varizell: z.number().int().min(0).max(5).optional(),
      }),
      execute: async ({ orgId, footerText, masern, varizell }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (footerText === undefined && masern === undefined && varizell === undefined) return { error: "nothing_to_change" };
        const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
        const orgName = (org as { name?: string } | null)?.name ?? orgId;
        const args: Record<string, unknown> = { orgId };
        if (footerText !== undefined) args.footerText = footerText;
        if (masern !== undefined) args.masern = masern;
        if (varizell !== undefined) args.varizell = varizell;
        const bits = [
          footerText !== undefined ? `footer: ${footerText || "(cleared)"}` : "",
          (masern !== undefined || varizell !== undefined) ? `vaccine: Masern ${masern ?? 0} / Varizellen ${varizell ?? 0}` : "",
        ].filter(Boolean).join(", ");
        return stagePending(scope, {
          toolName: "setOrgBranding",
          args,
          candidateUserId: null,
          summary: `${orgName} branding → ${bits}`.slice(0, 300),
        });
      },
    }),

    listAgencies: tool({
      description:
        "List all AGENCIES (the multi-tenancy containers that isolate sub-admins + candidates) — id, name, and admin/member/candidate counts. Read-only, supreme-only. (Distinct from organizations: agencies are the tenancy layer; organizations are the per-employer job layer.)",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data: agencies } = await db.from("agencies").select("id, name, created_at").order("name", { ascending: true });
        const rows = (agencies ?? []) as { id: string; name: string; created_at: string }[];
        if (!rows.length) return { count: 0, agencies: [] };
        const [{ data: subs }, { data: cands }] = await Promise.all([
          db.from("sub_admins").select("agency_id, is_agency_admin"),
          db.from("candidate_profiles").select("agency_id"),
        ]);
        const adminCount: Record<string, number> = {};
        const memberCount: Record<string, number> = {};
        for (const s of (subs ?? []) as { agency_id: string | null; is_agency_admin: boolean }[]) {
          if (!s.agency_id) continue;
          if (s.is_agency_admin) adminCount[s.agency_id] = (adminCount[s.agency_id] ?? 0) + 1;
          else memberCount[s.agency_id] = (memberCount[s.agency_id] ?? 0) + 1;
        }
        const candCount: Record<string, number> = {};
        for (const c of (cands ?? []) as { agency_id: string | null }[]) {
          if (c.agency_id) candCount[c.agency_id] = (candCount[c.agency_id] ?? 0) + 1;
        }
        return {
          count: rows.length,
          agencies: rows.map((a) => ({
            id: a.id, name: a.name,
            adminCount: adminCount[a.id] ?? 0,
            memberCount: memberCount[a.id] ?? 0,
            candidateCount: candCount[a.id] ?? 0,
          })),
        };
      },
    }),

    listSlots: tool({
      description:
        "List the Bearbeitung or Visum WIZARD SLOTS (the per-phase document/sign/fill steps a candidate works through). phase 'bearbeitung' or 'visum'; optional orgId for an org's slots (omit for the global set). Read-only, supreme-only. Returns each slot's id, label, what's required (sign/fill, who), whether a PDF template is attached. Use to find a slotId for sendSlotRequest.",
      inputSchema: z.object({
        phase: z.enum(["bearbeitung", "visum"]),
        orgId: z.string().uuid().optional(),
      }),
      execute: async ({ phase, orgId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        let q = db.from("phase_slots").select("id, label, phase, position, type, action_type, admin_signs, candidate_signs, admin_fills, candidate_fills, pdf_has_native_fields, template_pdf_path, org_id").eq("phase", phase);
        q = orgId ? q.eq("org_id", orgId) : q.is("org_id", null);
        const { data, error } = await q.order("position", { ascending: true });
        if (error) return { error: "load_failed" };
        const slots = ((data ?? []) as { id: string; label: string; position: number; type: string; action_type: string | null; admin_signs: boolean; candidate_signs: boolean; admin_fills: boolean; candidate_fills: boolean; pdf_has_native_fields: boolean; template_pdf_path: string | null }[]).map((s) => ({
          slotId: s.id, label: s.label, position: s.position, type: s.type, actionType: s.action_type,
          adminSigns: s.admin_signs, candidateSigns: s.candidate_signs, adminFills: s.admin_fills, candidateFills: s.candidate_fills,
          hasTemplate: !!s.template_pdf_path, hasNativeFields: s.pdf_has_native_fields,
        }));
        return { count: slots.length, slots };
      },
    }),

    sendSlotRequest: tool({
      description:
        "STAGE sending a candidate a Bearbeitung/Visum slot request — the action that turns the slot ORANGE (waiting on the candidate to sign/fill it) and drops a bell notification in their portal. slotId from listSlots. By default it figures out whether the candidate needs to sign and/or fill from the slot's own flags; you may override with needsSign/needsFill. Applies immediately when you call it — do NOT ask the admin to confirm. (Uploading the slot's PDF template + drawing signature zones stays a website-only action.)",
      inputSchema: z.object({
        slotId: z.string().uuid(),
        candidateUserId: z.string().uuid(),
        needsSign: z.boolean().optional().describe("override; defaults to the slot's candidate_signs flag"),
        needsFill: z.boolean().optional().describe("override; defaults to the slot's candidate_fills flag"),
      }),
      execute: async ({ slotId, candidateUserId, needsSign, needsFill }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data: slot } = await db.from("phase_slots").select("label, candidate_signs, candidate_fills").eq("id", slotId).maybeSingle();
        if (!slot) return { error: "slot_not_found" };
        const s = slot as { label?: string; candidate_signs?: boolean; candidate_fills?: boolean };
        const sign = needsSign === undefined ? !!s.candidate_signs : needsSign;
        const fill = needsFill === undefined ? !!s.candidate_fills : needsFill;
        const name = await displayName(candidateUserId);
        const what = sign && fill ? "sign + fill" : sign ? "sign" : fill ? "fill" : "review";
        return stagePending(scope, {
          toolName: "sendSlotRequest",
          args: { slotId, candidateUserId, needsSign: sign, needsFill: fill },
          candidateUserId,
          summary: `Ask ${name} to ${what}: ${(s.label || "Dokument").slice(0, 80)}`,
        });
      },
    }),

    listSignRequests: tool({
      description:
        "List a candidate's stand-alone SIGN-REQUESTS (PDFs sent for their signature) with each one's status (pending / signed / declined) and review outcome (accepted/rejected). Read-only. Use to see what's waiting — a 'signed' request with no review yet is ready for reviewSignRequest.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db.from("sign_requests")
          .select("id, document_name, note, status, review_status, review_feedback, signed_at, created_at")
          .eq("candidate_user_id", candidateUserId).order("created_at", { ascending: false });
        if (error) return { error: "load_failed" };
        const requests = ((data ?? []) as { id: string; document_name: string; note: string | null; status: string; review_status: string | null; review_feedback: string | null; signed_at: string | null; created_at: string }[]).map((r) => ({
          signRequestId: r.id, documentName: r.document_name, note: r.note,
          status: r.status, reviewStatus: r.review_status, reviewFeedback: r.review_feedback,
          signedAt: r.signed_at, createdAt: r.created_at,
          awaitingReview: r.status === "signed" && !r.review_status,
          signedPdfAvailable: r.status === "signed", // deliver with getSignRequestFile
        }));
        return { count: requests.length, requests };
      },
    }),

    getSignRequestFile: tool({
      description:
        "Deliver a candidate's SIGNED sign-request PDF (e.g. the signed Arbeitsvertrag / contract they returned) straight into the chat — or the ORIGINAL unsigned version. The signed PDF lives in storage, NOT in the documents list, so getDocumentDownloadLink can't reach it — use THIS. Get the signRequestId from listSignRequests (a request with status 'signed' / signedPdfAvailable). which: 'signed' (default) or 'original'. out_of_scope if you can't see the candidate; 'not_signed_yet' if they haven't signed it.",
      inputSchema: z.object({
        signRequestId: z.string().uuid(),
        which: z.enum(["signed", "original"]).default("signed"),
      }),
      execute: async ({ signRequestId, which }) => {
        const { data, error } = await db.from("sign_requests")
          .select("id, candidate_user_id, document_name, signed_pdf_path, pdf_storage_path")
          .eq("id", signRequestId).maybeSingle();
        if (error) return { error: "load_failed" };
        if (!data) return { error: "not_found" };
        const r = data as { id: string; candidate_user_id: string; document_name: string | null; signed_pdf_path: string | null; pdf_storage_path: string | null };
        if (!(await canActOnCandidate(scope.role, scope.email, r.candidate_user_id))) return { error: "out_of_scope" };
        const path = which === "original" ? r.pdf_storage_path : (r.signed_pdf_path ?? null);
        if (!path) return { error: which === "signed" ? "not_signed_yet" : "no_original_file" };
        // The signed/original PDFs live in the "sign-documents" Storage bucket — mint a
        // short-lived Supabase signed URL (absolute; the webhook fetches it as-is).
        const { data: urlData, error: urlErr } = await db.storage.from("sign-documents").createSignedUrl(path, 600);
        if (urlErr || !urlData?.signedUrl) return { error: "serve_failed" };
        const base = (r.document_name ?? "dokument").replace(/[^\w.\-]+/g, "_") || "dokument";
        const fileName = base.toLowerCase().endsWith(".pdf") ? base : `${base}${which === "signed" ? "_signed" : ""}.pdf`;
        return { url: urlData.signedUrl, fileName, expiresInSec: 600 };
      },
    }),

    listPendingSignatures: tool({
      description:
        "Roster-wide signature radar across EVERYONE you can see. Returns two buckets: awaitingCandidate = slot/sign requests you sent that they HAVEN'T signed yet (who still owes you a signature), and awaitingMyReview = ones they signed that YOU haven't accepted/rejected. USE for 'who owes me a signature', 'who hasn't signed the slot I sent', 'any signed contracts waiting for my review'. Each row has sinceDays (how long it's been waiting). Read-only. Supreme-only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const roster = await candidateRoster();
        if (!roster.length) return { awaitingCandidate: [], awaitingMyReview: [], awaitingCandidateCount: 0, awaitingReviewCount: 0 };
        const ids = roster.map((r) => r.userId);
        const nameById = new Map(roster.map((r) => [r.userId, r.name] as const));
        const days = (iso: string | null) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : Math.round((Date.now() - t) / DAY); };
        type Row = { candidateUserId: string; name: string; document: string; kind: "slot" | "sign_request"; signRequestId?: string; sinceDays: number | null };
        const [notifRes, srRes] = await Promise.all([
          db.from("notifications").select("user_id, doc_name, created_at").eq("action", "sign_request").eq("read", false).in("user_id", ids),
          db.from("sign_requests").select("id, candidate_user_id, document_name, status, review_status, created_at").in("candidate_user_id", ids),
        ]);
        const awaitingCandidate: Row[] = [];
        const awaitingMyReview: Row[] = [];
        for (const n of (notifRes.data ?? []) as { user_id: string; doc_name: string | null; created_at: string }[]) {
          if (!nameById.has(n.user_id)) continue;
          awaitingCandidate.push({ candidateUserId: n.user_id, name: nameById.get(n.user_id)!, document: n.doc_name || "Dokument", kind: "slot", sinceDays: days(n.created_at) });
        }
        for (const r of (srRes.data ?? []) as { id: string; candidate_user_id: string; document_name: string; status: string; review_status: string | null; created_at: string }[]) {
          if (!nameById.has(r.candidate_user_id)) continue;
          if (r.status === "pending") awaitingCandidate.push({ candidateUserId: r.candidate_user_id, name: nameById.get(r.candidate_user_id)!, document: r.document_name, kind: "sign_request", signRequestId: r.id, sinceDays: days(r.created_at) });
          else if (r.status === "signed" && !r.review_status) awaitingMyReview.push({ candidateUserId: r.candidate_user_id, name: nameById.get(r.candidate_user_id)!, document: r.document_name, kind: "sign_request", signRequestId: r.id, sinceDays: days(r.created_at) });
        }
        const bySince = (a: Row, b: Row) => (b.sinceDays ?? 0) - (a.sinceDays ?? 0); // longest-waiting first
        awaitingCandidate.sort(bySince); awaitingMyReview.sort(bySince);
        return { awaitingCandidate, awaitingMyReview, awaitingCandidateCount: awaitingCandidate.length, awaitingReviewCount: awaitingMyReview.length };
      },
    }),

    cancelSlotRequest: tool({
      description:
        "Retract an OPEN slot/sign request you sent a candidate by mistake (the orange 'please sign/fill' bell) — e.g. 'cancel the slot I sent Asmae'. Marks their pending request(s) read so the slot drops back to neutral. With slotId, cancels just that one; without it, cancels ALL their open slot requests. Applies immediately. Supreme-only.",
      inputSchema: z.object({ candidateUserId: z.string().uuid(), slotId: z.string().uuid().optional() }),
      execute: async ({ candidateUserId, slotId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        let q = db.from("notifications").update({ read: true }).eq("user_id", candidateUserId).eq("action", "sign_request").eq("read", false);
        if (slotId) q = q.eq("doc_id", slotId);
        const { data, error } = await q.select("id");
        if (error) return { error: "cancel_failed" };
        return { ok: true, cancelled: (data ?? []).length };
      },
    }),

    reviewSignRequest: tool({
      description:
        "STAGE accepting or rejecting a candidate-SIGNED sign-request (signRequestId from listSignRequests). Only a request the candidate has already signed can be reviewed. 'reject' NEEDS a feedback reason (LAW #20) — the candidate is notified either way. Applies immediately when you call it — do NOT ask the admin to confirm. (Creating a new sign-request from a PDF stays a website-only action.)",
      inputSchema: z.object({
        signRequestId: z.string().uuid(),
        action: z.enum(["accept", "reject"]),
        feedback: z.string().max(2000).optional().describe("required when action is 'reject'"),
      }),
      execute: async ({ signRequestId, action, feedback }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (action === "reject" && !(feedback ?? "").trim()) return { error: "feedback_required" };
        const { data: sr } = await db.from("sign_requests").select("candidate_user_id, document_name, status").eq("id", signRequestId).maybeSingle();
        if (!sr) return { error: "not_found" };
        const r = sr as { candidate_user_id: string; document_name: string; status: string };
        if (r.status !== "signed") return { error: "not_signed_yet" };
        if (!(await canActOnCandidate(scope.role, scope.email, r.candidate_user_id))) return { error: "out_of_scope" };
        const name = await displayName(r.candidate_user_id);
        const args: Record<string, unknown> = { signRequestId, action };
        if (feedback !== undefined) args.feedback = feedback;
        return stagePending(scope, {
          toolName: "reviewSignRequest",
          args,
          candidateUserId: r.candidate_user_id,
          summary: `${action === "accept" ? "Accept" : "Reject"} ${name}'s signed "${(r.document_name || "document").slice(0, 60)}"${action === "reject" ? ` — ${(feedback ?? "").trim().slice(0, 80)}` : ""}`,
        });
      },
    }),

    listStaff: tool({
      description:
        "List your STAFF — every sub-admin (Borivon HQ helpers + org-scoped admins) with their name/label, whether they're org-scoped (is_agency_admin), and how many candidates are directly assigned to them. Read-only, supreme-only. Use for 'who has access', 'how many candidates does X handle'. (To see one org's members, use listOrganizations + the org's people on the site.)",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const [{ data: subs }, { data: asg }] = await Promise.all([
          db.from("sub_admins").select("email, name, label, is_agency_admin, agency_id, created_at").order("created_at", { ascending: true }),
          db.from("sub_admin_assignments").select("sub_admin_email, candidate_user_id"),
        ]);
        const counts: Record<string, number> = {};
        for (const a of (asg ?? []) as { sub_admin_email: string }[]) counts[a.sub_admin_email] = (counts[a.sub_admin_email] ?? 0) + 1;
        const staff = ((subs ?? []) as { email: string; name: string | null; label: string | null; is_agency_admin: boolean | null; agency_id: string | null }[]).map((s) => ({
          email: s.email, name: s.name || null, label: s.label || null,
          orgScoped: !!s.is_agency_admin, agencyId: s.agency_id || null,
          assignedCount: counts[s.email] ?? 0,
        }));
        return { count: staff.length, staff };
      },
    }),

    inviteSubAdmin: tool({
      description:
        "Generate a fresh SUB-ADMIN invite link — the same /join/subadmin link the Manage page produces. Whoever redeems it becomes a Borivon HQ sub-admin (all-candidate visibility, LAW #25). Returns a URL — include it verbatim so the admin can copy and send it. Each call mints a NEW single-use link. Immediate — NO confirmation step. Supreme-only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const code = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
        let { error } = await db.from("invite_tokens").insert({ org_id: null, type: "sub-admin", code, agency_id: null });
        if (error) ({ error } = await db.from("invite_tokens").insert({ org_id: null, type: "member", code, agency_id: null }));
        if (error) return { error: "invite_failed" };
        const base = (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");
        return { url: `${base}/join/subadmin/${code}`, code, note: "single-use sub-admin invite link" };
      },
    }),

    manageSubAdmin: tool({
      description:
        "STAGE creating or removing a Borivon HQ SUB-ADMIN. op 'create' (needs email; optional name + label) adds a sub-admin who can see ALL candidates (LAW #25). op 'remove' (needs email) deletes them and all their candidate assignments. Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm. (To onboard them yourself, use inviteSubAdmin for a self-serve link instead.)",
      inputSchema: z.object({
        op: z.enum(["create", "remove"]),
        email: z.string().max(254),
        name: z.string().max(200).optional(),
        label: z.string().max(200).optional(),
      }),
      execute: async ({ op, email, name, label }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const e = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: "bad_email" };
        const args: Record<string, unknown> = { op, email: e };
        if (name !== undefined) args.name = name;
        if (label !== undefined) args.label = label;
        return stagePending(scope, {
          toolName: "manageSubAdmin",
          args,
          candidateUserId: null,
          summary: `${op === "create" ? "Add" : "Remove"} sub-admin: ${e}${name ? ` (${name})` : ""}`,
        });
      },
    }),

    assignCandidate: tool({
      description:
        "STAGE assigning (or unassigning) a candidate to a SUB-ADMIN so that sub-admin handles them. op 'assign' or 'unassign'; subAdminEmail from listStaff + candidateUserId from searchCandidates. Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        op: z.enum(["assign", "unassign"]),
        subAdminEmail: z.string().max(254),
        candidateUserId: z.string().uuid(),
      }),
      execute: async ({ op, subAdminEmail, candidateUserId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const e = subAdminEmail.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: "bad_email" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "assignCandidate",
          args: { op, subAdminEmail: e, candidateUserId },
          candidateUserId,
          summary: `${op === "assign" ? "Assign" : "Unassign"} ${name} ${op === "assign" ? "→" : "from"} ${e}`,
        });
      },
    }),

    setCandidateVerified: tool({
      description:
        "STAGE granting or revoking a candidate's blue VERIFIED tick (manually_verified). Grant makes them show as verified everywhere regardless of document status, and sends them a one-time 'verified' notification + email. verified true to grant, false to revoke. Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        verified: z.boolean(),
      }),
      execute: async ({ candidateUserId, verified }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "setCandidateVerified",
          args: { userId: candidateUserId, verified },
          candidateUserId,
          summary: `${verified ? "Grant" : "Revoke"} verified tick: ${name}`,
        });
      },
    }),

    manageOrgMember: tool({
      description:
        "STAGE adding, changing the role of, or removing an ORGANIZATION MEMBER (a person who logs in scoped to one partner org — sees ONLY that org's candidates). orgId from listOrganizations. op 'add' (email + role member/owner, optional name/label — creates their org-scoped sub-admin login if new), 'setRole' (email + role), or 'remove' (email — removes them from the org but keeps their account). Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        op: z.enum(["add", "setRole", "remove"]),
        orgId: z.string().uuid(),
        email: z.string().max(254),
        role: z.enum(["member", "owner"]).optional(),
        name: z.string().max(200).optional(),
        label: z.string().max(200).optional(),
      }),
      execute: async ({ op, orgId, email, role, name, label }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const e = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: "bad_email" };
        if (op === "setRole" && !role) return { error: "role_required" };
        const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
        const orgName = (org as { name?: string } | null)?.name ?? orgId;
        const args: Record<string, unknown> = { op, orgId, email: e };
        if (role !== undefined) args.role = role;
        if (name !== undefined) args.name = name;
        if (label !== undefined) args.label = label;
        const verb = op === "add" ? `Add ${e}${role ? ` (${role})` : ""} to` : op === "setRole" ? `Set ${e} role ${role} @` : `Remove ${e} from`;
        return stagePending(scope, {
          toolName: "manageOrgMember",
          args,
          candidateUserId: null,
          summary: `${verb} ${orgName}`,
        });
      },
    }),

    listCalendarEvents: tool({
      description:
        "List the upcoming community CALENDAR events — title, date/time, location, link, and whether it's VIP-only. Read-only, supreme-only. Optional onlyUpcoming (default true) to hide past events; limit caps the count. Use for 'what's on the calendar', 'next event'. Create one with createCalendarEvent, remove with deleteCalendarEvent.",
      inputSchema: z.object({
        onlyUpcoming: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ onlyUpcoming, limit }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data, error } = await db.from("calendar_events")
          .select("id, title, starts_at, ends_at, location, link_url, vip_only, attendee_ids")
          .order("starts_at", { ascending: true });
        if (error) return { error: "load_failed" };
        const nowIso = new Date().toISOString();
        let rows = ((data ?? []) as { id: string; title: string; starts_at: string; ends_at: string | null; location: string | null; link_url: string | null; vip_only: boolean; attendee_ids: string[] | null }[]);
        if (onlyUpcoming !== false) rows = rows.filter((r) => (r.ends_at ?? r.starts_at) >= nowIso);
        const events = rows.slice(0, limit ?? 50).map((r) => ({
          eventId: r.id, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at,
          location: r.location, linkUrl: r.link_url, vipOnly: r.vip_only,
          tagged: Array.isArray(r.attendee_ids) && r.attendee_ids.length > 0,
        }));
        return { count: events.length, events };
      },
    }),

    bookCalendarEvent: tool({
      description:
        "Put an event on the founder's OWN Google Calendar (the real calendar they look at) — for 'book / schedule / block X', meetings, interviews, calls, personal appointments. title + startsAt required; optional endsAt (else +60 min), description, location, addMeet. Times are the founder's LOCAL time (Africa/Casablanca): emit startsAt as a local wall-clock ISO with NO Z and NO offset, e.g. 2026-06-15T15:00:00 (the system tells you TODAY's date — resolve 'today / Monday / tomorrow / 15h' against it, never guess the year). Set addMeet:true when it's a video call / online interview / 'with a Meet link' — Google attaches a Google Meet link and you'll get the link back to share. Writes straight to their Google Calendar and applies immediately — do NOT ask to confirm. To invite OTHER people by email with Yes/Maybe/No, use sendCalendarInvite instead. For a PUBLIC candidate-facing community event (the portal Calendar tab), use createCalendarEvent. Supreme-only.",
      inputSchema: z.object({
        title: z.string().min(1).max(300),
        startsAt: z.string().min(10).describe("LOCAL wall-clock ISO, no Z/offset, e.g. 2026-06-15T15:00:00"),
        endsAt: z.string().max(40).optional(),
        description: z.string().max(4000).optional(),
        location: z.string().max(300).optional(),
        addMeet: z.boolean().optional().describe("true → attach a Google Meet video link (for online meetings/interviews)"),
        recurrence: z.enum(["daily", "weekly", "monthly"]).optional().describe("make it a REPEATING series, e.g. 'weekly office-hours every Monday' → 'weekly' (startsAt = the first occurrence)"),
      }),
      execute: async ({ title, startsAt, endsAt, description, location, addMeet, recurrence }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!title.trim()) return { error: "title_required" };
        if (!Number.isFinite(Date.parse(startsAt))) return { error: "bad_start" };
        const args: Record<string, unknown> = { title, startsAt };
        if (endsAt !== undefined) args.endsAt = endsAt;
        if (description !== undefined) args.description = description;
        if (location !== undefined) args.location = location;
        if (addMeet !== undefined) args.addMeet = addMeet;
        if (recurrence !== undefined) args.recurrence = recurrence;
        const when = startsAt.replace("T", " ").slice(0, 16);
        return stagePending(scope, {
          toolName: "bookCalendarEvent",
          args,
          candidateUserId: null,
          summary: `Book on your calendar: "${title.trim().slice(0, 80)}" @ ${when}${recurrence ? ` (${recurrence})` : ""}${location ? ` · ${location}` : ""}${addMeet ? " · 📹 Meet" : ""}`,
        });
      },
    }),

    checkAvailability: tool({
      description:
        "Check whether the founder is FREE or has a conflict in a time window on their own Google Calendar — for 'am I free Thursday at 3?', 'do I have anything at 10am tomorrow?', 'what's blocking my afternoon?'. from + to are LOCAL wall-clock ISO (no Z), resolved against TODAY. Returns busy (true/false) + the conflicting events. Read-only. Supreme-only.",
      inputSchema: z.object({
        from: z.string().min(10).describe("window start, LOCAL ISO e.g. 2026-06-19T15:00:00"),
        to: z.string().min(10).describe("window end, LOCAL ISO e.g. 2026-06-19T16:00:00"),
      }),
      execute: async ({ from, to }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const res = await readWorkspaceCalendar({ from, to, max: 50 });
        if (!res.ok) return { error: res.error === "workspace_not_connected" ? "calendar_not_connected" : "load_failed" };
        // events.list with a from/to window returns only events overlapping it.
        const conflicts = res.events
          .filter((e) => !e.allDay)
          .map((e) => ({ title: e.title, start: e.start, end: e.end, meetLink: e.meetLink }));
        return { busy: conflicts.length > 0, conflicts };
      },
    }),

    createCalendarEvent: tool({
      description:
        "STAGE creating a community CALENDAR event. title + startsAt (ISO date-time) required; optional endsAt, description, location, linkUrl (http/https), vipOnly (premium-only), repeatWeekly (1-52 → that many weekly copies). The event is PUBLIC (shown to everyone, or all premium if vipOnly). Image upload + tagging specific attendees stay website-only. Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        title: z.string().max(200),
        startsAt: z.string().max(40).describe("ISO 8601, e.g. 2026-07-10T10:00:00Z"),
        endsAt: z.string().max(40).optional(),
        description: z.string().max(4000).optional(),
        location: z.string().max(200).optional(),
        linkUrl: z.string().max(1000).optional(),
        vipOnly: z.boolean().optional(),
        repeatWeekly: z.number().int().min(1).max(52).optional(),
      }),
      execute: async ({ title, startsAt, endsAt, description, location, linkUrl, vipOnly, repeatWeekly }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!title.trim()) return { error: "title_required" };
        if (!Number.isFinite(Date.parse(startsAt))) return { error: "bad_start" };
        const args: Record<string, unknown> = { title, startsAt };
        if (endsAt !== undefined) args.endsAt = endsAt;
        if (description !== undefined) args.description = description;
        if (location !== undefined) args.location = location;
        if (linkUrl !== undefined) args.linkUrl = linkUrl;
        if (vipOnly !== undefined) args.vipOnly = vipOnly;
        if (repeatWeekly !== undefined) args.repeatWeekly = repeatWeekly;
        const when = new Date(Date.parse(startsAt)).toISOString().replace("T", " ").slice(0, 16);
        const rep = repeatWeekly && repeatWeekly > 1 ? ` ×${repeatWeekly} weekly` : "";
        return stagePending(scope, {
          toolName: "createCalendarEvent",
          args,
          candidateUserId: null,
          summary: `Calendar event: "${title.trim().slice(0, 80)}" @ ${when}${location ? ` · ${location}` : ""}${vipOnly ? " (VIP)" : ""}${rep}`,
        });
      },
    }),

    deleteCalendarEvent: tool({
      description:
        "STAGE deleting a community CALENDAR event by eventId (from listCalendarEvents). Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({ eventId: z.string().uuid() }),
      execute: async ({ eventId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data: ev } = await db.from("calendar_events").select("title, starts_at").eq("id", eventId).maybeSingle();
        if (!ev) return { error: "not_found" };
        const e = ev as { title?: string; starts_at?: string };
        const when = e.starts_at ? ` (${new Date(e.starts_at).toISOString().slice(0, 10)})` : "";
        return stagePending(scope, {
          toolName: "deleteCalendarEvent",
          args: { eventId },
          candidateUserId: null,
          summary: `Delete calendar event: "${(e.title || "event").slice(0, 80)}"${when}`,
        });
      },
    }),

    sendCalendarInvite: tool({
      description:
        "Send a REAL CALENDAR INVITATION to people — an email carrying an .ics so each attendee gets Yes/Maybe/No (RSVP) and it lands in their calendar (Gmail, Outlook, Apple). Use for 'invite Anna to a meeting', 'send a calendar invite for the interview Thursday 3pm', 'set up a call with X'. attendees = comma-separated EMAIL addresses. startsAt = ISO datetime (e.g. 2026-07-10T10:00:00Z); give endsAt (ISO) OR durationMinutes (defaults to 60). Optional location (a place OR a video-call link) and description. You (the founder) are the organizer. It goes out AFTER you confirm (it's a send). Supreme-admin only. (For a public community event with no attendees, use createCalendarEvent instead.)",
      inputSchema: z.object({
        attendees: z.string().min(3).describe("comma-separated email addresses of the people to invite"),
        title: z.string().min(1).max(200),
        startsAt: z.string().min(10).describe("ISO datetime, e.g. 2026-07-10T10:00:00Z"),
        endsAt: z.string().optional().describe("ISO datetime; omit to use durationMinutes (or 60 min)"),
        durationMinutes: z.number().int().min(5).max(1440).optional(),
        location: z.string().max(300).optional().describe("a place or a video-call link"),
        description: z.string().max(2000).optional(),
        method: z.enum(["request", "cancel"]).default("request").describe("'cancel' to call off a meeting you invited earlier"),
      }),
      execute: async (args) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const emails = args.attendees.split(",").map((s) => s.trim()).filter(Boolean);
        const bad = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        if (bad) return { error: `bad_attendee:${bad}` };
        if (!emails.length) return { error: "no_attendees" };
        if (Number.isNaN(new Date(args.startsAt).getTime())) return { error: "bad_start_time" };
        const verb = args.method === "cancel" ? "Cancel meeting" : "Calendar invite";
        return stagePending(scope, {
          toolName: "sendCalendarInvite",
          args,
          candidateUserId: null,
          summary: `${verb}: "${args.title.slice(0, 80)}" → ${emails.join(", ")} (${args.startsAt})`,
        });
      },
    }),

    toggleStageLock: tool({
      description:
        "STAGE locking or UNLOCKING a candidate's pipeline STAGE (LAW #31 — supreme admin only; you operating it via the bot IS that power). stage one of 'bearbeitung' (the recognition/Bearbeitung stage), 'visum' (the embassy/Visum stage), 'integration', or 'start'. unlocked=true opens the stage for the candidate, false locks it. Applies immediately when you call it — do NOT ask the admin to confirm. e.g. 'unlock the Visum stage for Hajar' → toggleStageLock(candidateUserId, 'visum', true); 'lock Bearbeitung for Ali' → toggleStageLock(candidateUserId, 'bearbeitung', false).",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        stage: z.enum(["bearbeitung", "recognition", "visum", "embassy", "integration", "start"]),
        unlocked: z.boolean(),
      }),
      execute: async ({ candidateUserId, stage, unlocked }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const name = await displayName(candidateUserId);
        const label = stage === "bearbeitung" || stage === "recognition" ? "Bearbeitung" : stage === "visum" || stage === "embassy" ? "Visum" : stage === "integration" ? "Integration" : "Start";
        return stagePending(scope, {
          toolName: "toggleStageLock",
          args: { candidateUserId, stage, unlocked },
          candidateUserId,
          summary: `${unlocked ? "Unlock" : "Lock"} the ${label} stage for ${name}`,
        });
      },
    }),

    deleteOrganization: tool({
      description:
        "STAGE permanently DELETING a partner ORGANIZATION by orgId (get it from listOrganizations). This CASCADES: it removes the org's members and unlinks every candidate tied to it (the candidates' own accounts are NOT deleted). Supreme-only, IRREVERSIBLE. This is one of the only two actions that still needs confirmation: state exactly what will be deleted and WAIT for the admin's explicit 'yes' (the system will not apply it until they confirm).",
      inputSchema: z.object({ orgId: z.string().uuid() }),
      execute: async ({ orgId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
        if (!org) return { error: "not_found" };
        const orgName = (org as { name?: string } | null)?.name ?? orgId;
        return stagePending(scope, {
          toolName: "deleteOrganization",
          args: { orgId },
          candidateUserId: null,
          summary: `DELETE organization "${orgName}" — also unlinks its candidates + removes its members (cannot be undone)`,
        });
      },
    }),

    uploadOrgLogo: tool({
      description:
        "Set a partner ORGANIZATION's logo from a PHOTO/IMAGE the admin ATTACHED to this message (PNG/JPEG/WebP/GIF, up to ~300KB). orgId from listOrganizations. That logo brands the org's candidates' CVs (agency branding) + their footer. Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm. Only call this when the admin actually ATTACHED an image AND named an org (otherwise an attached file is a candidate document → storeCandidateDocument).",
      inputSchema: z.object({ orgId: z.string().uuid() }),
      execute: async ({ orgId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!pendingFile) return { error: "no_file" };
        const { data: org } = await db.from("organizations").select("name").eq("id", orgId).maybeSingle();
        if (!org) return { error: "not_found" };
        const orgName = (org as { name?: string } | null)?.name ?? orgId;
        return stagePending(scope, {
          toolName: "uploadOrgLogo",
          args: { orgId, r2Key: pendingFile.r2Key, mime: pendingFile.mime },
          candidateUserId: null,
          summary: `Set ${orgName}'s logo to the attached image (${pendingFile.fileName})`,
        });
      },
    }),

    deleteCandidateAccount: tool({
      description:
        "STAGE permanently DELETING a candidate's ENTIRE account + ALL their data — documents, pipeline, profile, messages, sign-requests, feed activity — and their login. IRREVERSIBLE. Supreme-only. Use ONLY when the admin clearly says to delete/remove a person's account (not for 'archive' or 'hide'). If unsure who they mean, searchCandidates first. IRREVERSIBLE — this is one of the only two actions that still needs confirmation: state exactly whose account will be deleted and WAIT for the admin's explicit 'yes' (the system will not apply it until they confirm).",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "deleteCandidateAccount",
          args: { candidateUserId },
          candidateUserId,
          summary: `PERMANENTLY DELETE ${name}'s account + all their data — this cannot be undone`,
        });
      },
    }),

    listCohorts: tool({
      description:
        "List the ACADEMY cohorts (German-school classes) — id, name, target level, status, and member count. Read-only, supreme-only. Use for 'what cohorts do we have'. For one candidate's standing, use getAcademyStanding.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const [{ data: cohorts, error }, { data: members }] = await Promise.all([
          db.from("academy_cohorts").select("id, name, target_level, status, created_at").order("created_at", { ascending: false }),
          db.from("academy_cohort_members").select("cohort_id, status"),
        ]);
        if (error) return { error: "load_failed" };
        const counts: Record<string, number> = {};
        for (const m of (members ?? []) as { cohort_id: string; status: string }[]) {
          if (m.status === "active") counts[m.cohort_id] = (counts[m.cohort_id] ?? 0) + 1;
        }
        const rows = ((cohorts ?? []) as { id: string; name: string; target_level: string | null; status: string | null }[]).map((c) => ({
          cohortId: c.id, name: c.name, targetLevel: c.target_level, status: c.status,
          activeMembers: counts[c.id] ?? 0,
        }));
        return { count: rows.length, cohorts: rows };
      },
    }),

    getAcademyStanding: tool({
      description:
        "Read a candidate's ACADEMY standing — their cohort + current CEFR level, total points (score), and the employer-facing reliability snapshot (attendance rate, punctuality, quiz on-time/pass rates). Read-only. Use for 'how is X doing in the academy / school', 'X's attendance'.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data: mem } = await db.from("academy_cohort_members")
          .select("cohort_id, current_level, status").eq("candidate_user_id", candidateUserId).eq("status", "active").maybeSingle();
        const m = mem as { cohort_id?: string; current_level?: string } | null;
        if (!m) return { enrolled: false };
        let cohortName: string | null = null;
        if (m.cohort_id) {
          const { data: c } = await db.from("academy_cohorts").select("name").eq("id", m.cohort_id).maybeSingle();
          cohortName = (c as { name?: string } | null)?.name ?? null;
        }
        const { getScore, getReliability } = await import("@/lib/academyPoints");
        const [score, reliability] = await Promise.all([getScore(candidateUserId), getReliability(candidateUserId)]);
        return {
          enrolled: true,
          cohortName,
          level: m.current_level ?? null,
          score,
          attendanceRatePct: Math.round(reliability.attendanceRate * 100),
          punctualityPct: Math.round(reliability.punctualityRate * 100),
          sessionsAttended: reliability.sessions,
          quizzes: reliability.quizzes,
          quizOnTimePct: Math.round(reliability.onTimeRate * 100),
          quizPassPct: Math.round(reliability.passRate * 100),
        };
      },
    }),

    setAcademyLevel: tool({
      description:
        "STAGE setting a candidate's ACADEMY (German-school) CEFR LEVEL — 'A1', 'A2', 'B1' or 'B2' — in their active cohort. Climbing UP awards the one-time level-up points + pings the student. The candidate must already be enrolled in a cohort (else not_enrolled — enrol them on the website first). Supreme-only. Applies immediately when you call it — do NOT ask the admin to confirm. e.g. 'promote Hajar to B2 in the school' → setAcademyLevel(candidateUserId, 'B2'). (Marking attendance + class bonus + building quizzes stay on the live-class teacher screen.)",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        level: z.enum(["A1", "A2", "B1", "B2"]),
      }),
      execute: async ({ candidateUserId, level }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "setAcademyLevel",
          args: { candidateUserId, level },
          candidateUserId,
          summary: `Set ${name}'s academy level to ${level}`,
        });
      },
    }),

    manageCohortMember: tool({
      description:
        "ENROL a candidate into an academy cohort, or DROP them out of one. op 'enroll' adds them as an active member (starts at A1 unless they already have a level — re-enrolling reactivates a dropped one); 'drop' marks their membership dropped (soft + reversible — never deletes). cohortId from listCohorts. USE for 'enrol Asmae in the June B2 cohort', 'drop Imane from her class'. Applies immediately. Supreme-only.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        cohortId: z.string().uuid(),
        op: z.enum(["enroll", "drop"]),
      }),
      execute: async ({ candidateUserId, cohortId, op }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data: coh } = await db.from("academy_cohorts").select("id, name").eq("id", cohortId).maybeSingle();
        if (!coh) return { error: "cohort_not_found" };
        const cohortName = (coh as { name?: string }).name ?? null;
        if (op === "enroll") {
          const { data: existing } = await db.from("academy_cohort_members")
            .select("cohort_id").eq("cohort_id", cohortId).eq("candidate_user_id", candidateUserId).maybeSingle();
          if (existing) {
            const { error } = await db.from("academy_cohort_members").update({ status: "active" })
              .eq("cohort_id", cohortId).eq("candidate_user_id", candidateUserId);
            if (error) return { error: "write_failed" };
          } else {
            const { error } = await db.from("academy_cohort_members")
              .insert({ cohort_id: cohortId, candidate_user_id: candidateUserId, status: "active", current_level: "A1" });
            if (error) return { error: "write_failed" };
          }
          return { ok: true, op, cohortName };
        }
        const { data: upd, error } = await db.from("academy_cohort_members").update({ status: "dropped" })
          .eq("cohort_id", cohortId).eq("candidate_user_id", candidateUserId).select("cohort_id").maybeSingle();
        if (error) return { error: "write_failed" };
        if (!upd) return { error: "not_a_member" };
        return { ok: true, op, cohortName };
      },
    }),

    getAcademyOverview: tool({
      description:
        "Academy progress for EVERYONE you can see — each active student's cohort, CEFR level, attendance %, and score, worst-attendance first. USE for 'how's the school going', 'who's behind / failing on attendance', 'who's still below B2 in the academy'. Read-only. Supreme-only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const roster = await candidateRoster();
        if (!roster.length) return { count: 0, students: [] };
        const ids = roster.map((r) => r.userId);
        const nameById = new Map(roster.map((r) => [r.userId, r.name] as const));
        const { data: mems } = await db.from("academy_cohort_members")
          .select("candidate_user_id, cohort_id, current_level, status").in("candidate_user_id", ids).eq("status", "active");
        const members = (mems ?? []) as { candidate_user_id: string; cohort_id: string; current_level: string | null }[];
        if (!members.length) return { count: 0, students: [] };
        const cohortIds = [...new Set(members.map((m) => m.cohort_id).filter(Boolean))];
        const { data: cohs } = cohortIds.length
          ? await db.from("academy_cohorts").select("id, name").in("id", cohortIds)
          : { data: [] as { id: string; name: string }[] };
        const cohortName = new Map(((cohs ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name] as const));
        const { getReliability } = await import("@/lib/academyPoints");
        const students = await Promise.all(members.map(async (m) => {
          const rel = await getReliability(m.candidate_user_id).catch(() => null);
          return {
            candidateUserId: m.candidate_user_id,
            name: nameById.get(m.candidate_user_id) || "—",
            cohort: m.cohort_id ? (cohortName.get(m.cohort_id) || null) : null,
            level: m.current_level ?? null,
            attendanceRatePct: rel ? Math.round(rel.attendanceRate * 100) : null,
            score: rel ? rel.score : null,
          };
        }));
        students.sort((a, b) => (a.attendanceRatePct ?? 101) - (b.attendanceRatePct ?? 101));
        return { count: students.length, students };
      },
    }),

    listBatches: tool({
      description:
        "List the employer intake BATCHES (e.g. 'UKSH — Q2 2026') — each with its employer, seat target, how many candidates are assigned so far (filled), target window, and status. Read-only, supreme-only. Default shows only OPEN batches; includeClosed=true to see all. Use for 'which batches do we have', 'how full is the UKSH intake'. Create/edit with manageBatch; put a candidate in one with setFunnelStage(batchId).",
      inputSchema: z.object({ includeClosed: z.boolean().optional() }),
      execute: async ({ includeClosed }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        let q = db.from("employer_batches").select("id, employer_id, name, seats, target_start, target_end, status").order("created_at", { ascending: false });
        if (!includeClosed) q = q.eq("status", "open");
        const { data: batches, error } = await q;
        if (error) return { error: "load_failed" };
        const list = (batches ?? []) as { id: string; employer_id: string | null; name: string; seats: number; target_start: string | null; target_end: string | null; status: string }[];
        const { data: assigned } = await db.from("candidate_pipeline").select("batch_id").not("batch_id", "is", null);
        const cnt = new Map<string, number>();
        for (const r of (assigned ?? []) as { batch_id: string }[]) cnt.set(r.batch_id, (cnt.get(r.batch_id) ?? 0) + 1);
        const empIds = [...new Set(list.map((b) => b.employer_id).filter(Boolean) as string[])];
        const empName = new Map<string, string>();
        if (empIds.length) {
          const { data: emps } = await db.from("employers").select("id, name").in("id", empIds);
          for (const e of (emps ?? []) as { id: string; name: string }[]) empName.set(e.id, e.name);
        }
        return {
          count: list.length,
          batches: list.map((b) => ({
            batchId: b.id, name: b.name, employer: b.employer_id ? empName.get(b.employer_id) ?? null : null,
            filled: cnt.get(b.id) ?? 0, seats: b.seats, targetStart: b.target_start, targetEnd: b.target_end, status: b.status,
          })),
        };
      },
    }),

    manageBatch: tool({
      description:
        "STAGE creating/editing/closing an employer intake BATCH. op 'create' (name required, e.g. 'UKSH — Q3 2026'; optional employerId from listEmployers, seats default 10, targetStart/targetEnd as YYYY-MM-DD, notes), 'edit' (batchId + any field), or 'close' (batchId — stops it counting as an open gap to fill). Supreme-only; applies immediately when you call it. e.g. 'open a UKSH batch for Q3, 10 seats' → manageBatch(op 'create', name 'UKSH — Q3 2026', seats 10).",
      inputSchema: z.object({
        op: z.enum(["create", "edit", "close"]),
        batchId: z.string().uuid().optional(),
        employerId: z.string().uuid().optional(),
        name: z.string().max(120).optional(),
        seats: z.number().int().min(1).max(1000).optional(),
        targetStart: z.string().max(10).optional(),
        targetEnd: z.string().max(10).optional(),
        notes: z.string().max(500).optional(),
      }),
      execute: async ({ op, batchId, employerId, name, seats, targetStart, targetEnd, notes }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if ((op === "edit" || op === "close") && !batchId) return { error: "batchId_required" };
        if (op === "create" && !name) return { error: "name_required" };
        const args: Record<string, unknown> = { op };
        if (batchId !== undefined) args.batchId = batchId;
        if (employerId !== undefined) args.employerId = employerId;
        if (name !== undefined) args.name = name;
        if (seats !== undefined) args.seats = seats;
        if (targetStart !== undefined) args.targetStart = targetStart;
        if (targetEnd !== undefined) args.targetEnd = targetEnd;
        if (notes !== undefined) args.notes = notes;
        if (op === "close") args.close = true;
        let label = batchId ?? "";
        if (op !== "create" && batchId) {
          const { data: b } = await db.from("employer_batches").select("name").eq("id", batchId).maybeSingle();
          label = (b as { name?: string } | null)?.name ?? batchId;
        }
        const summary = op === "create" ? `Open new batch "${name}"${seats ? ` (${seats} seats)` : ""}` : op === "close" ? `Close batch "${label}"` : `Edit batch "${label}"`;
        return stagePending(scope, { toolName: "manageBatch", args, candidateUserId: null, summary });
      },
    }),

    setFunnelStage: tool({
      description:
        "STAGE setting a candidate's FUNNEL STAGE and/or their BATCH. stage one of funneling / screening / interview1 / waiting_2nd / interview2 / passed / departed ('waiting_2nd' = passed the 1st interview and waiting for the 2nd date — the DROP-OUT danger zone the daily tasks watch). batchId from listBatches (or '' to unassign). At least one of stage/batchId required. Supreme-only; applies immediately when you call it. e.g. 'mark Hajar waiting for her 2nd interview' → setFunnelStage(candidateUserId, stage 'waiting_2nd'); 'put Ali in the UKSH Q3 batch' → setFunnelStage(candidateUserId, batchId …).",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        stage: z.enum(["funneling", "screening", "interview1", "waiting_2nd", "interview2", "passed", "departed"]).optional(),
        batchId: z.string().optional(),
      }),
      execute: async ({ candidateUserId, stage, batchId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (stage === undefined && batchId === undefined) return { error: "nothing_to_set" };
        const name = await displayName(candidateUserId);
        const args: Record<string, unknown> = { candidateUserId };
        if (stage !== undefined) args.stage = stage;
        if (batchId !== undefined) args.batchId = batchId; // "" → unassign
        const bits = [stage ? `stage → ${stage}` : null, batchId !== undefined ? (batchId ? "assign to a batch" : "unassign batch") : null].filter(Boolean).join(", ");
        return stagePending(scope, { toolName: "setFunnelStage", args, candidateUserId, summary: `${name}: ${bits}` });
      },
    }),

    listStuckCandidates: tool({
      description:
        "List candidates who may need a NUDGE — their latest uploaded document was rejected ≥3 days ago and not re-submitted, or their pipeline hasn't moved in 3+ weeks. Read-only; returns each name + the reason(s). To nudge them, use nudgeStuckCandidates (all at once) or message one with sendCandidateMessage / sendFollowUpNudge. This is the same list the daily auto-chase push surfaces.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { computeStuckCandidates } = await import("@/lib/autoChase");
        const { candidates, count } = await computeStuckCandidates({ includeRejectedDocs: true });
        return { count, candidates };
      },
    }),

    nudgeStuckCandidates: tool({
      description:
        "STAGE a gentle follow-up nudge (a 'Borivon' bell reminder, never auto-sent) to ALL currently-stuck candidates (the listStuckCandidates set). Optional short custom message. Applies immediately when you call it — it sends each stuck candidate the reminder right away; report how many. (For one candidate, use sendFollowUpNudge or sendCandidateMessage.)",
      inputSchema: z.object({ message: z.string().max(200).optional() }),
      execute: async ({ message }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { computeStuckCandidates } = await import("@/lib/autoChase");
        const { candidates } = await computeStuckCandidates({ includeRejectedDocs: true });
        if (candidates.length === 0) return { error: "none_stuck" };
        const ids = candidates.map((c) => c.userId);
        const names = candidates.slice(0, 12).map((c) => c.name).join(", ");
        const args: Record<string, unknown> = { candidateIds: ids };
        if (message !== undefined) args.message = message;
        return stagePending(scope, {
          toolName: "nudgeStuckCandidates",
          args,
          candidateUserId: null,
          summary: `Nudge ${candidates.length} stuck candidate${candidates.length > 1 ? "s" : ""}: ${names}${candidates.length > 12 ? "…" : ""}`,
        });
      },
    }),

    getAgencyProfile: tool({
      description:
        "Read YOUR agency/employer contact profile (firma, address, contact person, phone, email, Betriebsnummer, etc.) — the block that auto-fills section C of German employer forms. Read-only, supreme-admin only.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data } = await db.from("agency_profiles").select("firma, strasse, hausnummer, plz, ort, kontaktperson, telefon, email, telefax, betriebsnummer").eq("user_id", scope.userId).maybeSingle();
        return { profile: data ?? null };
      },
    }),

    setAgencyProfile: tool({
      description:
        "STAGE updating YOUR agency/employer contact profile (fills section C of German employer forms). Pass only the fields to change: firma (company name), strasse, hausnummer, plz, ort, kontaktperson, telefon, email, telefax, betriebsnummer. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        firma: z.string().max(200).optional(),
        strasse: z.string().max(200).optional(),
        hausnummer: z.string().max(40).optional(),
        plz: z.string().max(20).optional(),
        ort: z.string().max(120).optional(),
        kontaktperson: z.string().max(120).optional(),
        telefon: z.string().max(60).optional(),
        email: z.string().max(254).optional(),
        telefax: z.string().max(60).optional(),
        betriebsnummer: z.string().max(60).optional(),
      }),
      execute: async (inp) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const entries = Object.entries(inp).filter(([, v]) => v !== undefined);
        if (entries.length === 0) return { error: "nothing_to_change" };
        const args: Record<string, unknown> = {};
        for (const [k, v] of entries) args[k] = v;
        const summary = `Agency profile → ${entries.map(([k, v]) => `${k}: ${v || "(cleared)"}`).join(", ")}`.slice(0, 350);
        return stagePending(scope, { toolName: "setAgencyProfile", args, candidateUserId: null, summary });
      },
    }),

    setAnerkennungStage: tool({
      description:
        "STAGE a candidate's Anerkennung (German diploma-recognition) stage. stage is one of: not_started, submitted (Antrag sent), in_review, deficit (Defizitbescheid), exam_or_course (Kenntnisprüfung/Anpassungslehrgang), recognized (full Approbation). Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        stage: z.enum(["not_started", "submitted", "in_review", "deficit", "exam_or_course", "recognized"]),
      }),
      execute: async ({ candidateUserId, stage }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "setAnerkennungStage",
          args: { candidateUserId, stage },
          candidateUserId,
          summary: `${name}: Anerkennung → ${stage}`,
        });
      },
    }),

    setNurseProfile: tool({
      description:
        "STAGE a candidate's nurse-profile facts (the structured data German hospitals filter on). Pass ONLY the fields to change. specialty ∈ general/intensive/geriatric/surgical/pediatric/emergency/anesthesia/psychiatric/obstetrics/oncology/cardiology/dialysis (or '' to clear). yearsExperience = whole number 0–60 as a string (or '' to clear). workplace = current/last workplace (or '' to clear). availableFrom = 'YYYY-MM-DD' (or '' to clear). Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        specialty: z.string().optional(),
        yearsExperience: z.string().optional().describe("whole number 0-60 as a string, or '' to clear"),
        workplace: z.string().optional(),
        availableFrom: z.string().optional().describe("'YYYY-MM-DD' or '' to clear"),
      }),
      execute: async ({ candidateUserId, specialty, yearsExperience, workplace, availableFrom }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const args: Record<string, unknown> = { candidateUserId };
        const parts: string[] = [];
        if (specialty !== undefined) { args.specialty = specialty; parts.push(specialty ? `specialty ${specialty}` : "clear specialty"); }
        if (yearsExperience !== undefined) { args.yearsExperience = yearsExperience; parts.push(yearsExperience ? `${yearsExperience}y experience` : "clear experience"); }
        if (workplace !== undefined) { args.workplace = workplace; parts.push(workplace ? `workplace "${workplace.slice(0, 40)}"` : "clear workplace"); }
        if (availableFrom !== undefined) { args.availableFrom = availableFrom; parts.push(availableFrom ? `available ${availableFrom}` : "clear availability"); }
        if (parts.length === 0) return { error: "nothing_to_change" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "setNurseProfile",
          args,
          candidateUserId,
          summary: `${name}: ${parts.join(", ")}`,
        });
      },
    }),

    sendFollowUpNudge: tool({
      description:
        "STAGE a gentle follow-up nudge into a candidate's notification bell (shown as coming from 'Borivon', never you) — use when they've gone quiet or missed a step. Optional short message. De-duped: refreshes an existing unread nudge rather than stacking. Applies immediately when you call it — do NOT ask the admin to confirm. (To send an actual chat message or email, use sendCandidateMessage instead.)",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        message: z.string().max(200).optional(),
      }),
      execute: async ({ candidateUserId, message }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        const preview = (message ?? "").trim().slice(0, 80);
        const args: Record<string, unknown> = { candidateUserId };
        if (message !== undefined) args.message = message;
        return stagePending(scope, {
          toolName: "sendFollowUpNudge",
          args,
          candidateUserId,
          summary: `Nudge ${name}${preview ? `: "${preview}"` : ""}`,
        });
      },
    }),

    manageJourneyItem: tool({
      description:
        "STAGE a change to a candidate's JOURNEY checklist. op: 'add' a task (text required; owner = who it's tagged to — 'candidate' = a task the candidate sees & does (DEFAULT), 'borivon' = internal Borivon task, 'organization' = the partner org's task); 'toggle' done/undone (id + done); 'rename' a custom task (id + text); 'delete' a custom task (id); 'setDue' a deadline (id + dueDate 'YYYY-MM-DD' or '' to clear); 'setBlocked' (id + blocked true/false + optional reason). Preset milestones can be toggled/dated/blocked but NOT renamed or deleted. Item ids show on the candidate's dashboard journey list. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        op: z.enum(["add", "toggle", "rename", "delete", "setDue", "setBlocked"]),
        text: z.string().max(500).optional(),
        owner: z.enum(["candidate", "borivon", "organization"]).optional(),
        id: z.string().uuid().optional().describe("the journey item id (for toggle/rename/delete/setDue/setBlocked)"),
        done: z.boolean().optional(),
        dueDate: z.string().optional().describe("'YYYY-MM-DD' or '' to clear"),
        blocked: z.boolean().optional(),
        reason: z.string().max(500).optional(),
      }),
      execute: async ({ candidateUserId, op, text, owner, id, done, dueDate, blocked, reason }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        if (op === "add" && !(text ?? "").trim()) return { error: "text_required" };
        if (op !== "add" && !id) return { error: "id_required" };
        const name = await displayName(candidateUserId);
        let summary: string;
        if (op === "add") summary = `${name}: add task "${(text ?? "").trim().slice(0, 80)}" (${owner ?? "candidate"})`;
        else if (op === "toggle") summary = `${name}: mark a task ${done === false ? "NOT done" : "done"}`;
        else if (op === "rename") summary = `${name}: rename a task → "${(text ?? "").trim().slice(0, 80)}"`;
        else if (op === "delete") summary = `${name}: delete a custom task`;
        else if (op === "setDue") summary = `${name}: task due ${dueDate || "(cleared)"}`;
        else summary = `${name}: task ${blocked ? "blocked" : "unblocked"}${blocked && reason ? ` (${reason.slice(0, 40)})` : ""}`;
        const args: Record<string, unknown> = { candidateUserId, op };
        if (text !== undefined) args.text = text;
        if (owner !== undefined) args.owner = owner;
        if (id !== undefined) args.id = id;
        if (done !== undefined) args.done = done;
        if (dueDate !== undefined) args.dueDate = dueDate;
        if (blocked !== undefined) args.blocked = blocked;
        if (reason !== undefined) args.reason = reason;
        return stagePending(scope, { toolName: "manageJourneyItem", args, candidateUserId, summary });
      },
    }),

    reviewDocument: tool({
      description:
        "STAGE approving / rejecting / re-pending a candidate's uploaded DOCUMENT by its docId. status: 'approved' | 'rejected' | 'pending'. A rejection MUST include a non-empty feedback reason (shown to the candidate). Approve/reject fires the candidate's notification + email automatically (same as the website). Get the docId from listCandidateDocuments. NOTE: to approve/reject the passport DATA (extracted fields), use setPassportDataStatus instead — this is for the uploaded file's status. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        docId: z.string().uuid(),
        status: z.enum(["approved", "rejected", "pending"]),
        feedback: z.string().max(2000).optional().describe("REQUIRED when status is 'rejected' — the reason shown to the candidate"),
      }),
      execute: async ({ docId, status, feedback }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (status === "rejected" && !(feedback ?? "").trim()) return { error: "reject_needs_reason" };
        const { data: doc } = await db.from("documents").select("user_id, file_name, file_type").eq("id", docId).maybeSingle();
        if (!doc) return { error: "not_found" };
        const ownerId = (doc as { user_id: string }).user_id;
        if (!(await canActOnCandidate(scope.role, scope.email, ownerId))) return { error: "out_of_scope" };
        const name = await displayName(ownerId);
        const fileLabel = String((doc as { file_name?: string | null; file_type?: string | null }).file_name || (doc as { file_type?: string | null }).file_type || "document").slice(0, 60);
        const verb = status === "approved" ? "APPROVE" : status === "rejected" ? "REJECT" : "re-pend";
        const args: Record<string, unknown> = { docId, status };
        if (feedback !== undefined) args.feedback = feedback;
        return stagePending(scope, {
          toolName: "reviewDocument",
          args,
          candidateUserId: ownerId,
          summary: `${verb} "${fileLabel}" for ${name}${status === "rejected" && feedback ? ` — reason: "${feedback.trim().slice(0, 80)}"` : ""}`,
        });
      },
    }),

    setPassportDataStatus: tool({
      description:
        "STAGE approving / rejecting / re-pending a candidate's passport DATA (the extracted fields: name, dob, passport no, etc. — NOT the scan PDF, which is reviewDocument). status: 'approved' | 'rejected' | 'pending'. Rejecting REQUIRES feedback, WIPES the extracted OCR fields, and notifies the candidate to re-submit. (LAW #38: this only flips the data's status — it can NEVER tick the human passport confirmation checkboxes.) Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        status: z.enum(["approved", "rejected", "pending"]),
        feedback: z.string().max(2000).optional().describe("REQUIRED when status is 'rejected'"),
      }),
      execute: async ({ candidateUserId, status, feedback }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (status === "rejected" && !(feedback ?? "").trim()) return { error: "reject_needs_reason" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        const args: Record<string, unknown> = { candidateUserId, status };
        if (feedback !== undefined) args.feedback = feedback;
        return stagePending(scope, {
          toolName: "setPassportDataStatus",
          args,
          candidateUserId,
          summary: `${name}: passport DATA → ${status.toUpperCase()}${status === "rejected" ? " (wipes the extracted fields)" : ""}`,
        });
      },
    }),

    editCandidateProfileField: tool({
      description:
        "STAGE editing ONE passport/identity/contact field on a candidate's profile. candidate_profiles is the SINGLE SOURCE OF TRUTH (LAW #37) — the edit auto-propagates into their CV draft and everywhere their name shows. field is one of: first_name, last_name, dob, sex, nationality, passport_no, passport_expiry, city_of_birth, country_of_birth, issuing_authority, issue_date, address_street, address_number, address_postal, city_of_residence, country_of_residence, marital_status, children_ages. Dates accept 'YYYY-MM-DD' or 'DD.MM.YYYY'. value = the new value ('' clears it). To APPROVE/REJECT the passport data, use setPassportDataStatus. Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        field: z.enum(["first_name", "last_name", "dob", "sex", "nationality", "passport_no", "passport_expiry", "city_of_birth", "country_of_birth", "issuing_authority", "issue_date", "address_street", "address_number", "address_postal", "city_of_residence", "country_of_residence", "marital_status", "children_ages"]),
        value: z.string().describe("the new value, or '' to clear"),
      }),
      execute: async ({ candidateUserId, field, value }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "editCandidateProfileField",
          args: { candidateUserId, field, value },
          candidateUserId,
          summary: `${name}: set ${field} → ${value || "(cleared)"}`,
        });
      },
    }),

    rotateDocument: tool({
      description:
        "STAGE rotating a stored document by a multiple of 90° (deltaRotation: 90, 180, 270, or -90). Persists the rotation. Passport scans rotate too (metadata-only — the bytes are never altered). Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        docId: z.string().uuid(),
        deltaRotation: z.number().int().describe("degrees to rotate by — a multiple of 90 (e.g. 90, -90, 180)"),
      }),
      execute: async ({ docId, deltaRotation }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (deltaRotation % 90 !== 0) return { error: "bad_rotation" };
        const { data: doc } = await db.from("documents").select("user_id, file_name").eq("id", docId).maybeSingle();
        if (!doc) return { error: "not_found" };
        const ownerId = (doc as { user_id: string }).user_id;
        if (!(await canActOnCandidate(scope.role, scope.email, ownerId))) return { error: "out_of_scope" };
        const name = await displayName(ownerId);
        const label = String((doc as { file_name?: string | null }).file_name || "document").slice(0, 50);
        return stagePending(scope, {
          toolName: "rotateDocument",
          args: { docId, deltaRotation },
          candidateUserId: ownerId,
          summary: `${name}: rotate "${label}" by ${deltaRotation}°`,
        });
      },
    }),

    readCvDraft: tool({
      description:
        "Read a candidate's CV draft (the structured data behind their German CV) by candidateUserId. Read-only; returns the draft JSON so you can answer questions about their CV or check it before staging an edit. Returns { hasCv: false } if they have no CV yet. Note: identity/passport fields mirror their profile (edit those via editCandidateProfileField); driver licence / hobbies / contact are CV-only (edit via editCvDraft).",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db.from("candidate_profiles").select("cv_draft").eq("user_id", candidateUserId).maybeSingle();
        if (error) return { error: "load_failed" };
        const draft = (data as { cv_draft?: unknown } | null)?.cv_draft ?? null;
        if (!draft) return { hasCv: false };
        return { hasCv: true, draft };
      },
    }),

    editCvDraft: tool({
      description:
        "STAGE editing a CV-only field on a candidate's German CV draft. field ∈ driverLicense ('B' for a B licence, or '' for none), hobbies (free text), email, phone. value = the new value ('' clears it). For NAME / birth date / address / nationality / marital status, use editCandidateProfileField instead — those are the single source of truth and propagate into the CV automatically. The candidate must already have a CV draft (returns no_cv_yet otherwise). Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        field: z.enum(["driverLicense", "hobbies", "email", "phone"]),
        value: z.string().describe("the new value, or '' to clear"),
      }),
      execute: async ({ candidateUserId, field, value }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "editCvDraft",
          args: { candidateUserId, field, value },
          candidateUserId,
          summary: `${name}: CV ${field} → ${value || "(cleared)"}`,
        });
      },
    }),

    generateAndPublishCv: tool({
      description:
        "STAGE generating the candidate's German CV PDF from their CV data and PUBLISHING it as their official 'Lebenslauf' document (it appears on their dashboard as approved/green and becomes attachable/sendable). It uses the candidate's current CV-branding setting — set it first with setCvBrandingMode if the admin wants agency/no branding. Requires the candidate to have CV data (returns no_cv_data otherwise). Use this when the admin says 'generate/make X's CV', or before emailing a CV for a candidate who has none on file yet. Applies immediately when you call it — do NOT ask the admin to confirm. After it's published you can attach it via sendExternalEmail or deliver it via getDocumentDownloadLink.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        return stagePending(scope, {
          toolName: "generateAndPublishCv",
          args: { candidateUserId },
          candidateUserId,
          summary: `Generate & publish the German CV (Lebenslauf) for ${name}`,
        });
      },
    }),

    setCvBrandingMode: tool({
      description:
        "STAGE the branding used on a candidate's ADMIN-generated CV. mode: 'agency' = their employer's agency logo + footer (e.g. the Calmaroi branding); 'borivon' = plain Borivon; 'none' = no logo or footer at all. (Branding only applies when the CV is generated on the admin side — a candidate's own download is always plain Borivon.) Applies immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        mode: z.enum(["agency", "borivon", "none"]),
      }),
      execute: async ({ candidateUserId, mode }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const name = await displayName(candidateUserId);
        const desc = mode === "agency" ? "agency logo + footer" : mode === "borivon" ? "plain Borivon" : "no branding";
        return stagePending(scope, {
          toolName: "setCvBrandingMode",
          args: { candidateUserId, mode },
          candidateUserId,
          summary: `${name}: CV branding → ${desc}`,
        });
      },
    }),

    sendExternalEmail: tool({
      description:
        "STAGE an outbound EMAIL to an EXTERNAL person (an employer, recruiter, hospital contact — NOT a candidate; for candidates use sendCandidateMessage). e.g. 'send Hajar and Ali's CVs to anna.gombert@klinikum.de'. Provide to (ONE primary recipient's email), an optional toName, an optional cc (comma-separated extra recipients to copy — e.g. 'email Anna and CC Omar' → to=anna@…, cc='omar@…'), a subject, and a body (you write a clean, professional message). To attach candidate CVs, pass their FULL NAMES (comma-separated, exactly as you'd give them to getCvLinks) in attachCandidateNames — e.g. 'Ismail Louali, Samira Irsani, Hajar El Kairaa, Lahcen Labzioui'. The bot resolves each name to that person's latest CV and attaches it. ALWAYS use names (attachCandidateNames) for CVs — do NOT try to pass ids you don't have. To attach specific documents by id, use attachDocIds. To FORWARD files that were attached to an email you received (e.g. 'send Anna the Defizitbescheid Abdelhak attached'), pass that email's id(s) in attachFromEmailIds — get the id from searchInbox/readEmail; the bot re-fetches those attachments natively and encloses them. It sends from youness.taoufiq@borivon.com.",
      inputSchema: z.object({
        to: z.string().min(3).max(254).describe("the ONE primary recipient's email address"),
        toName: z.string().max(120).optional().describe("the recipient's name, if known"),
        cc: z.string().max(1000).optional().describe("comma-separated additional recipients to CC (copy), e.g. 'omar@x.com, sara@x.com'"),
        bcc: z.string().max(1000).optional().describe("comma-separated BCC recipients (blind copy — hidden from the other recipients)"),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(8000).describe("the email body — write it professionally"),
        attachCandidateNames: z.string().optional().describe("comma-separated candidate FULL NAMES whose latest CV to attach — e.g. 'Ismail Louali, Samira Irsani'. This is the reliable way; names always resolve."),
        attachCandidateIds: z.string().optional().describe("(legacy) comma-separated candidate names OR candidateUserIds whose latest CV to attach — resolved the same way as attachCandidateNames"),
        attachDocIds: z.string().optional().describe("comma-separated document ids to attach"),
        attachFromEmailIds: z.string().optional().describe("attach files that came IN an email. Best: a Gmail SEARCH like 'from:abdelhak' (the bot finds the email + pulls its attachments — robust, no id needed). A message id also works, but PREFER the search so you never guess a wrong id."),
        attachChatFiles: z.boolean().optional().describe("attach the files I recently sent the bot in THIS Telegram chat (photos/PDFs I uploaded) — for 'attach the photos/files I sent'"),
      }),
      execute: async ({ to, toName, cc, bcc, subject, body, attachCandidateNames, attachCandidateIds, attachDocIds, attachFromEmailIds, attachChatFiles }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        // Tolerant: if several addresses get lumped into `to`, the FIRST is the
        // primary recipient and the rest fold into CC — so "send to A, B" works
        // even if the model didn't split them itself.
        const toParts = to.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
        const email = toParts[0] ?? "";
        if (!emailRe.test(email)) return { error: "bad_email" };
        const ccList = [...toParts.slice(1), ...(cc ?? "").split(/[,;]/)]
          .map((s) => s.trim()).filter(Boolean)
          .filter((c) => c.toLowerCase() !== email.toLowerCase()); // never CC the primary
        const badCc = ccList.find((c) => !emailRe.test(c));
        if (badCc) return { error: `bad_cc:${badCc}` };
        const bccList = (bcc ?? "").split(/[,;]/).map((s) => s.trim()).filter(Boolean)
          .filter((c) => c.toLowerCase() !== email.toLowerCase());
        const badBcc = bccList.find((c) => !emailRe.test(c));
        if (badBcc) return { error: `bad_bcc:${badBcc}` };
        // Resolve attachment candidates BY NAME (or id) through the SAME roster
        // resolver getCvLinks uses — the model reliably knows names but routinely
        // mangles ids (it was passing garbage ids → every CV "went missing"). So
        // every reference, whether a name or a uuid, is resolved to a REAL id here.
        const candRefs = [...(attachCandidateNames ?? "").split(","), ...(attachCandidateIds ?? "").split(",")]
          .map((s) => s.trim()).filter(Boolean);
        const candIds: string[] = [];
        const unresolved: string[] = [];
        if (candRefs.length) {
          const roster = await candidateRoster();
          for (const ref of candRefs) {
            const m = pickCandidate(roster, ref);
            if (m.status === "ok") { if (!candIds.includes(m.candidate.userId)) candIds.push(m.candidate.userId); }
            else unresolved.push(ref);
          }
          if (unresolved.length) return { error: `couldnt_find_candidate: ${unresolved.join(", ")}` };
        }
        const docIds = (attachDocIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const emailFwdIds = (attachFromEmailIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        // Must be allowed to send each attached candidate's CV.
        for (const cid of candIds) {
          if (!(await canActOnCandidate(scope.role, scope.email, cid))) return { error: "out_of_scope" };
        }
        const names: string[] = [];
        for (const cid of candIds.slice(0, 10)) names.push(await displayName(cid));
        const attachDesc =
          [
            candIds.length ? `${candIds.length} CV${candIds.length > 1 ? "s" : ""}${names.length ? ` (${names.join(", ")})` : ""}` : null,
            docIds.length ? `${docIds.length} document${docIds.length > 1 ? "s" : ""}` : null,
            emailFwdIds.length ? `files from ${emailFwdIds.length} email${emailFwdIds.length > 1 ? "s" : ""}` : null,
            attachChatFiles ? "files you sent in chat" : null,
          ].filter(Boolean).join(" + ") || "none";
        // Strip any markdown the model added so the preview AND the sent email
        // are plain text — no relying on it to "remember" the no-stars rule.
        const cleanBody = stripEmailFormatting(body);
        const cleanSubject = stripEmailFormatting(subject);
        // ── FUZZY attachments (chat uploads / email-search files) → build a real
        // Gmail DRAFT now (resolve + attach ONCE), and the confirm step SENDS THAT
        // DRAFT. The draft is the single source of truth: "show me the files" reads
        // it, send sends it — so what you verify is byte-for-byte what goes out
        // (kills the "claimed X, sent Y" bug). CV/doc attachments are id-exact (no
        // drift), so they stay on the proven path. The draft still includes any
        // CVs/docs requested alongside the fuzzy files. ──
        const useDraft = emailFwdIds.length > 0 || attachChatFiles === true;
        if (useDraft) {
          const d = await prepareEmailDraft(scope, {
            to: email, cc: ccList, bcc: bccList, subject: cleanSubject, body: cleanBody,
            candidateIds: candIds, docIds, attachFromEmailIds: emailFwdIds, chatFiles: attachChatFiles === true,
          });
          if (!d.ok) return { error: d.error };
          // Read the attachments BACK off the real draft — the names shown are
          // PROVEN on the draft, not claimed. (If Gmail silently dropped one, the
          // read-back reveals it.)
          const back = await listDraftAttachments(d.draftId);
          const realNames = back ? back.attachments.map((a) => a.filename) : d.names;
          return stagePending(scope, {
            toolName: "sendDraft",
            args: { draftId: d.draftId, draftMessageId: d.draftMessageId, to: email, subject: cleanSubject },
            candidateUserId: null,
            summary: `📧 To: ${toName ? `${toName} <${email}>` : email}${ccList.length ? `\nCC: ${ccList.join(", ")}` : ""}${bccList.length ? `\nBCC: ${bccList.join(", ")}` : ""}\nSubject: ${cleanSubject}\n📎 Attached (verified on the draft): ${realNames.length ? realNames.join(", ") : "none"}\n(say "show me the attached files" to pull them off the draft and double-check before you send)\n\n${cleanBody.slice(0, 600)}${cleanBody.length > 600 ? "…" : ""}`,
          });
        }
        const args: Record<string, unknown> = { to: email, subject: cleanSubject, body: cleanBody };
        if (toName !== undefined) args.toName = toName;
        if (ccList.length) args.cc = ccList.join(",");
        if (bccList.length) args.bcc = bccList.join(",");
        if (candIds.length) args.attachCandidateIds = candIds.join(","); // RESOLVED real ids, not the raw input
        if (attachDocIds !== undefined) args.attachDocIds = attachDocIds;
        if (emailFwdIds.length) args.attachFromEmailIds = emailFwdIds.join(",");
        if (attachChatFiles) args.attachChatFiles = true;
        return stagePending(scope, {
          toolName: "sendExternalEmail",
          args,
          candidateUserId: null,
          summary: `📧 To: ${toName ? `${toName} <${email}>` : email}${ccList.length ? `\nCC: ${ccList.join(", ")}` : ""}${bccList.length ? `\nBCC: ${bccList.join(", ")}` : ""}\nSubject: ${cleanSubject}\nAttachments: ${attachDesc}\n\n${cleanBody.slice(0, 600)}${cleanBody.length > 600 ? "…" : ""}`,
        });
      },
    }),

    listRecentSentEmails: tool({
      description:
        "List the recent emails you've SENT for the admin (recipient, subject, a body preview, which candidates' CVs were attached, and when). Read-only, supreme-only. Use this to RECALL or RESEND a past email — e.g. 'resend yesterday's email' / 'the same one as before' → call this, find the matching one, then resendEmail(emailId) to send it again exactly, OR sendExternalEmail (reusing its subject + body + attachCandidateNames) to send to a NEW recipient or with edits. NEVER ask the admin to retype an email you already sent — recall it here.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
      execute: async ({ limit }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data, error } = await db
          .from("assistant_sent_emails")
          .select("id, to_email, cc, subject, body, candidate_ids, sent_at")
          .eq("owner_user_id", scope.userId)
          .order("sent_at", { ascending: false })
          .limit(limit ?? 8);
        if (error) return { error: "load_failed" };
        const rows = (data ?? []) as { id: string; to_email: string; cc: string | null; subject: string; body: string; candidate_ids: string | null; sent_at: string }[];
        const allIds = [...new Set(rows.flatMap((r) => (r.candidate_ids ?? "").split(",").map((s) => s.trim()).filter(Boolean)))];
        let nameById = new Map<string, string>();
        if (allIds.length) {
          const roster = await candidateRoster();
          nameById = new Map(roster.map((c) => [c.userId, c.name]));
        }
        return {
          count: rows.length,
          emails: rows.map((r) => ({
            emailId: r.id,
            to: r.to_email,
            cc: r.cc || null,
            subject: r.subject,
            bodyPreview: r.body.slice(0, 400),
            attachedCandidates: (r.candidate_ids ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((id) => nameById.get(id) || id),
            sentAt: r.sent_at,
          })),
        };
      },
    }),

    resendEmail: tool({
      description:
        "Resend an email you previously sent, EXACTLY as before — same recipient, CC, subject, body, and the SAME CV attachments. emailId comes from listRecentSentEmails. Use for 'resend that' / 'send it again'. (To resend to a DIFFERENT recipient or with edits, use sendExternalEmail instead, reusing the subject + body from listRecentSentEmails.) Supreme-only; sends immediately when you call it.",
      inputSchema: z.object({ emailId: z.string().uuid() }),
      execute: async ({ emailId }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { data } = await db.from("assistant_sent_emails")
          .select("to_email, cc, subject, body, candidate_ids, doc_ids")
          .eq("id", emailId).eq("owner_user_id", scope.userId).maybeSingle();
        if (!data) return { error: "not_found" };
        const e = data as { to_email: string; cc: string | null; subject: string; body: string; candidate_ids: string | null; doc_ids: string | null };
        const args: Record<string, unknown> = { to: e.to_email, subject: e.subject, body: e.body };
        if (e.cc) args.cc = e.cc;
        if (e.candidate_ids) args.attachCandidateIds = e.candidate_ids; // stored REAL ids → writeExternalEmail re-attaches the CVs
        if (e.doc_ids) args.attachDocIds = e.doc_ids;
        return stagePending(scope, {
          toolName: "sendExternalEmail",
          args,
          candidateUserId: null,
          summary: `Resend email to ${e.to_email}: ${e.subject}`,
        });
      },
    }),

    sendCandidateMessage: tool({
      description:
        "STAGE a message to a candidate — e.g. 'tell X to re-upload their CV in French', 'message X their interview is Monday 10:00', 'email X to send their passport scan'. channel: 'chat' = post into their portal chat as 'Borivon Support' (in-app, default); 'email' = send it as an email; 'both'. The message is sent immediately when you call it — do NOT ask the admin to confirm.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        text: z.string().min(1).max(2000).describe("the message to send"),
        channel: z.enum(["chat", "email", "both"]).default("chat").describe("'chat' = portal chat (default), 'email', or 'both'"),
      }),
      execute: async ({ candidateUserId, text, channel }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", candidateUserId).maybeSingle();
        let name = data ? nameOf(data as { first_name: string | null; last_name: string | null }) : "—";
        if (name === "—") {
          try {
            const { data: u } = await db.auth.admin.getUserById(candidateUserId);
            const fn = ((u?.user?.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim();
            name = fn || u?.user?.email || "this candidate";
          } catch { name = "this candidate"; }
        }
        const via = channel === "email" ? "email" : channel === "both" ? "chat + email" : "portal chat";
        const preview = text.trim().slice(0, 120);
        return stagePending(scope, {
          toolName: "sendCandidateMessage",
          args: { candidateUserId, text, channel: channel ?? "chat" },
          candidateUserId,
          summary: `Message to ${name} (${via}): "${preview}${text.trim().length > 120 ? "…" : ""}"`,
        });
      },
    }),

    createLead: tool({
      description:
        "STAGE creating a new LEAD / prospective-candidate record in Borivon — e.g. 'add Sara Alami, +212600112233, as a June 2027 candidate'. Captures the name + optional phone/email/note + an optional cohort label (like 'June 2027'). Applies immediately when you call it — do NOT ask the admin to confirm. This creates a LEAD (it shows up in the admin Leads page); it does NOT create a candidate login account.",
      inputSchema: z.object({
        name: z.string().min(1).max(120),
        phone: z.string().max(40).optional(),
        email: z.string().max(254).optional(),
        note: z.string().max(1000).optional(),
        cohort: z.string().max(60).optional().describe("a batch/cohort label, e.g. 'June 2027'"),
      }),
      execute: async ({ name, phone, email, note, cohort }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const parts = [name.trim(), cohort ? `(${cohort})` : null, phone || null, email || null].filter(Boolean).join(" · ");
        return stagePending(scope, {
          toolName: "createLead",
          args: { name, phone, email, note, cohort },
          candidateUserId: null,
          summary: `New lead: ${parts}`,
        });
      },
    }),

    createCandidateInviteLink: tool({
      description:
        "Generate a fresh CANDIDATE invitation link — the exact same /join/candidate signup link the website's 'Invite candidate' button produces. Use this whenever the admin asks for an invite link, a signup link, or to 'invite a new candidate'. Returns a URL — ALWAYS include the full URL verbatim in your reply so the admin can copy and send it. Each call mints a NEW single-use link (one candidate per link). This is immediate — no confirmation step.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        // Mirror the HQ branch of /api/portal/admin/invite-candidate: a standalone
        // single-use candidate token (org_id null, agency_id null for the supreme admin).
        const code = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
        const { error } = await db.from("invite_tokens").insert({ org_id: null, type: "candidate", code, agency_id: null });
        if (error) return { error: "invite_failed" };
        const base = (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");
        return { url: `${base}/join/candidate/${code}`, code, note: "single-use candidate invite link" };
      },
    }),

    storeCandidateDocument: tool({
      description:
        "STAGE storing the FILE the admin just attached to their Telegram message (a photo or document) into a candidate's documents. ONLY works when a file was actually attached — returns no_file otherwise. Steps: identify the candidate (searchCandidates / listAllCandidates), then call this with their candidateUserId and the docKey. docKey: 'id'=passport, 'cv_de'=CV, 'langcert'=B2 certificate, 'diploma', 'studyprog'=study programme, 'transcript'=Notenspiegel, 'abitur', 'praktikum', 'workcert'=work certificate, 'work_experience', 'impfung'=vaccination, 'arbeitsvertrag'=employment contract, 'defizitbescheid', 'ezb'=Anerkennung/EzB, 'vorabzustimmung', 'bildungsplan', 'versicherung'=insurance, or 'other'=Sonstiges (default — use when unsure). Set translated:true for the GERMAN TRANSLATION of a qualification ('store Hicham's diploma but the translated version' → docKey:'diploma', translated:true → files it as the _uebersetzt copy). Two-step: stage → admin confirms in a SEPARATE message → confirmPendingWrite. The file lands in the candidate's portal as a pending document for review.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        docKey: z.enum(["id", "cv_de", "langcert", "letter", "diploma", "studyprog", "transcript", "abitur", "praktikum", "workcert", "work_experience", "impfung", "arbeitsvertrag", "defizitbescheid", "ezb", "vorabzustimmung", "bildungsplan", "versicherung", "other"]).default("other"),
        translated: z.boolean().optional().describe("true → store the GERMAN translation (_uebersetzt) of a qualification doc, when that variant exists"),
      }),
      execute: async ({ candidateUserId, docKey, translated }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!pendingFile) return { error: "no_file" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        // The translation lives under a "<key>_de" catalog entry; use it only if it exists.
        const effKey: string = (translated && FILE_KEY_LABELS[`${docKey}_de`]) ? `${docKey}_de` : docKey;
        const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", candidateUserId).maybeSingle();
        let name = data ? nameOf(data as { first_name: string | null; last_name: string | null }) : "—";
        if (name === "—") {
          try {
            const { data: u } = await db.auth.admin.getUserById(candidateUserId);
            const fn = ((u?.user?.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim();
            name = fn || u?.user?.email || "this candidate";
          } catch { name = "this candidate"; }
        }
        const label = FILE_KEY_LABELS[effKey]?.[0] ?? effKey;
        return stagePending(scope, {
          toolName: "storeCandidateDocument",
          args: { candidateUserId, docKey: effKey, r2Key: pendingFile.r2Key, mime: pendingFile.mime, fileName: pendingFile.fileName, sha256: pendingFile.sha256 },
          candidateUserId,
          summary: `Store "${pendingFile.fileName}" as ${label} for ${name}`,
        });
      },
    }),
  };
}
