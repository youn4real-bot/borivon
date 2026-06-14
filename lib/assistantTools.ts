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
import { signDlToken } from "@/lib/dlToken";
import { UUID_RE } from "@/lib/uuid";
import { germanSummary } from "@/lib/b2Detail";
import { stripEmailFormatting } from "@/lib/emailFormat";
import { computeBriefing } from "@/lib/briefing";
import { stagePending, executeLatestPending, cancelLatestPending, MILESTONE_BOOL } from "@/lib/assistantWrites";
import { AUTOMATIONS, getAutomationFlags, setAutomation as persistAutomation } from "@/lib/automationSettings";
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
    let q = db.from("candidate_profiles").select("user_id, first_name, last_name");
    if (scope.visibleIds !== null) q = q.in("user_id", scope.visibleIds);
    const { data, error } = await q;
    if (error) return [];
    const profs = (data ?? []) as { user_id: string; first_name: string | null; last_name: string | null }[];
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
        "Get a summary for ONE candidate by their candidateUserId: name, B2 exam date, passport status and expiry. Returns { error: 'out_of_scope' } if you are not allowed to see them — do not guess in that case.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db
          .from("candidate_profiles")
          .select("user_id, first_name, last_name, b2_exam_date, passport_expiry, passport_status")
          .eq("user_id", candidateUserId)
          .maybeSingle();
        if (error) return { error: "load_failed" };
        if (!data) return { error: "not_found" };
        const r = data as ProfileRow;
        let name = nameOf(r);
        if (name === "—") {
          // Profile name empty → fall back to the account's registration name.
          try {
            const { data: u } = await db.auth.admin.getUserById(candidateUserId);
            const fn = ((u?.user?.user_metadata as Record<string, unknown> | undefined)?.full_name as string | undefined)?.trim();
            name = fn || u?.user?.email || "—";
          } catch { /* keep — */ }
        }
        return {
          candidate: {
            candidateUserId: r.user_id,
            name,
            b2ExamDate: r.b2_exam_date,
            passportExpiry: r.passport_expiry,
            passportStatus: r.passport_status,
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
          .filter((d) => !needle || `${d.name} ${d.fileName} ${d.kind}`.toLowerCase().includes(needle));
        return { documents };
      },
    }),

    getDocumentDownloadLink: tool({
      description:
        "Get a temporary (3-minute) download link for one document by its docId. Always tell the user the link expires in 3 minutes. Returns { error: 'out_of_scope' } if you are not allowed to access that candidate's document.",
      inputSchema: z.object({ docId: z.string().uuid() }),
      execute: async ({ docId }) => {
        const { data: doc, error } = await db
          .from("documents")
          .select("id, user_id, file_name, drive_file_id")
          .eq("id", docId)
          .maybeSingle();
        if (error) return { error: "load_failed" };
        if (!doc) return { error: "not_found" };
        const d = doc as { id: string; user_id: string; file_name: string | null; drive_file_id: string | null };
        if (!(await canActOnCandidate(scope.role, scope.email, d.user_id))) return { error: "out_of_scope" };
        // Token carries the ADMIN's id (not the candidate's). /api/portal/file
        // re-runs roleByUserId + canActOnCandidate, so scope is re-enforced at
        // serve time and the link grants no API authority on its own (lib/dlToken).
        const token = signDlToken(scope.userId, 180);
        const name = encodeURIComponent((d.file_name ?? "document").slice(0, 180));
        const idPart = d.drive_file_id
          ? `id=${encodeURIComponent(d.drive_file_id)}`
          : `docId=${encodeURIComponent(d.id)}`;
        const url = `/api/portal/file?${idPart}&dlt=${encodeURIComponent(token)}&dl=1&name=${name}`;
        return { url, expiresInSec: 180, fileName: d.file_name ?? "document" };
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
          const { data: docs } = await db
            .from("documents")
            .select("id, file_name, file_type, status, uploaded_at, drive_file_id, r2_key")
            .eq("user_id", cand.userId)
            .order("uploaded_at", { ascending: false });
          const cv = ((docs ?? []) as DocRow[]).find((d) => CV_KINDS.has(resolveFileKey(d.file_type)));
          if (!cv) { results.push({ query: raw, name: cand.name, status: "no_cv" }); continue; }
          const token = signDlToken(scope.userId, 180);
          const fname = encodeURIComponent((cv.file_name ?? `${cand.name} CV`).slice(0, 180));
          const idPart = cv.drive_file_id ? `id=${encodeURIComponent(cv.drive_file_id)}` : `docId=${encodeURIComponent(cv.id)}`;
          const url = `/api/portal/file?${idPart}&dlt=${encodeURIComponent(token)}&dl=1&name=${fname}`;
          results.push({ query: raw, name: cand.name, status: "ok", url, fileName: cv.file_name ?? `${cand.name} CV`, kind: resolveFileKey(cv.file_type) });
        }
        return { results };
      },
    }),

    // ── Personal task memory (the admin's OWN reminders — not candidate data) ──
    saveReminder: tool({
      description:
        "Save a personal reminder/task for the admin (e.g. 'chase Youssef's passport', 'call the embassy Monday'). Use this whenever the admin tells you to remember something or notes a task to do later. Optionally tie it to a candidate and/or a due date.",
      inputSchema: z.object({
        text: z.string().min(1).max(500).describe("the task / thing to remember"),
        dueDate: z.string().optional().describe("ISO date YYYY-MM-DD if a deadline was mentioned"),
        candidateUserId: z.string().uuid().optional().describe("if the reminder is about a specific candidate"),
      }),
      execute: async ({ text, dueDate, candidateUserId }) => {
        if (candidateUserId && !(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const due = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null; // ignore non-ISO the model might emit
        const { data, error } = await db
          .from("assistant_reminders")
          .insert({ owner_user_id: scope.userId, text, due_date: due, candidate_user_id: candidateUserId ?? null })
          .select("id")
          .maybeSingle();
        if (error) return { error: "save_failed" };
        return { saved: true, reminderId: (data as { id: string } | null)?.id ?? null };
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
        let qb = db
          .from("assistant_reminders")
          .select("id, text, due_date, candidate_user_id, done, created_at")
          .eq("owner_user_id", scope.userId);
        if (!includeDone) qb = qb.eq("done", false);
        const { data, error } = await qb;
        if (error) return { error: "load_failed" };
        type R = { id: string; text: string; due_date: string | null; candidate_user_id: string | null; done: boolean; created_at: string };
        let rows = (data ?? []) as R[];
        const now = Date.now();
        if (dueWithinDays != null) {
          const horizon = now + dueWithinDays * DAY;
          rows = rows.filter((r) => { const ms = parseDate(r.due_date); return ms !== null && ms <= horizon; });
        }
        rows.sort((a, b) => {
          const ma = parseDate(a.due_date), mb = parseDate(b.due_date);
          if (ma === null && mb === null) return 0;
          if (ma === null) return 1;
          if (mb === null) return -1;
          return ma - mb;
        });
        return {
          reminders: rows.map((r) => ({
            reminderId: r.id,
            text: r.text,
            dueDate: r.due_date,
            daysUntil: r.due_date && parseDate(r.due_date) !== null ? Math.round((parseDate(r.due_date)! - now) / DAY) : null,
            candidateUserId: r.candidate_user_id,
            done: r.done,
          })),
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

    getTodayBriefing: tool({
      description:
        "Get the prioritized 'what needs you today' briefing — documents pending review, passports expiring, B2 exams coming up, and the admin's due reminders. Use when the admin asks what to do today, what's important, what's pending, or for a daily summary.",
      inputSchema: z.object({}),
      execute: async () => {
        const { text, count } = await computeBriefing(scope.userId);
        return { briefing: text, actionableCount: count };
      },
    }),

    // ── Memory: how the admin likes to work (learned, applied every chat) ──
    rememberAboutMe: tool({
      description:
        "Save DURABLE info so you never have to be told it again: (a) a rule about HOW you should WORK — 'prefers short answers', 'always lead with passports', 'wants dates as DD.MM.YYYY', 'for B2 of named people use getB2Status, never getB2Overview' (kind preference/term/correction); or (b) one of the admin's recurring EXTERNAL CONTACTS — a recruiter / employer / partner they email, stored as 'Name = email' e.g. 'Anna Gombert = a.gombert@calmaroi.de' (kind 'contact'), so next time they say 'email Anna' or 'CC Omar' you already have the address. Call it whenever the admin states a lasting preference, teaches a term, corrects you for the future, OR gives you a contact's name+email to keep — then confirm briefly. Do NOT store: one-off tasks (use saveReminder); a CANDIDATE's transient status (e.g. 'Hajar is on leave until June', 'Ali failed B2') — that's about a candidate, not durable; or anything tied to a one-time date/deadline.",
      inputSchema: z.object({
        text: z.string().min(1).max(300),
        kind: z.enum(["preference", "fact", "term", "correction", "contact"]).default("preference"),
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
      description: "List everything you currently remember about the admin (their preferences/terms/facts). Use when they ask 'what do you know about me?' or 'what do you remember'.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await db
          .from("assistant_memory")
          .select("id, kind, text")
          .eq("owner_user_id", scope.userId)
          .order("created_at", { ascending: true });
        if (error) return { error: "load_failed" };
        return { memory: ((data ?? []) as { id: string; kind: string; text: string }[]).map((r) => ({ memoryId: r.id, kind: r.kind, text: r.text })) };
      },
    }),

    forgetMemory: tool({
      description: "Delete one remembered item by its memoryId (get ids from recallMemory). Use when the admin says 'forget that', 'that's wrong', or 'stop doing that'.",
      inputSchema: z.object({ memoryId: z.string().uuid() }),
      execute: async ({ memoryId }) => {
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
        "STAGE setting or clearing a candidate's interview date (which = 1 or 2; date 'YYYY-MM-DD', or '' to clear). Two-step like setInterviewResult — stage, the admin confirms, then confirmPendingWrite.",
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
        "Turn a proactive automation ON or OFF — immediate, no confirmation needed. key is one of: daily_briefing (the 6am 'what needs you today'), weekly_report (Monday business report), signup_ping (instant ping when a candidate signs up), auto_chase (morning stuck-candidate surface), inbox_reminder (morning unanswered-email reminder). enabled true = on, false = off. e.g. 'turn off the weekly report' → setAutomation('weekly_report', false); 'stop the email reminders' → setAutomation('inbox_reminder', false).",
      inputSchema: z.object({
        key: z.enum(["daily_briefing", "weekly_report", "signup_ping", "auto_chase", "inbox_reminder"]),
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
        "STAGE a pipeline milestone change for a candidate ('X got their visa', 'X's flight is June 20', 'X signed the contract', 'X arrived'). Two-step: stage → admin confirms → confirmPendingWrite. field is one of — yes/no flags (value 'true'/'false'): visa_granted, housing_done, contract_done, recognition_done, docs_approved, docs_ready, vorab_done, arrived_done, interview1_held, interview2_held, interview1_date_confirmed, interview2_date_confirmed, interview1_result_date_confirmed, interview2_result_date_confirmed, visa_appt_date_confirmed, flight_date_confirmed; date fields (value 'YYYY-MM-DD' or '' to clear): visa_date, visa_appt_date, flight_date, interview1_result_date, interview2_result_date; text fields: flight_info, interview_link, interview_type, interview_notes. (For interview pass/fail use setInterviewResult; for interview dates use setInterviewDate. Stage LOCK/UNLOCK is NOT available here — that stays on the website.)",
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
        "STAGE a B2 German-exam status change. 'passed B2' → stage 'passed'; 'failed B2' → failed:true. stage is one of: studying, expected_date, exam_booked, awaiting_results, passed. examDate 'YYYY-MM-DD' or '' to clear. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "List homepage/funnel LEADS — prospective candidates captured from the website or added via createLead (they show in the admin Leads page; not login accounts). Supreme-admin only. Newest first. Optional kind filter (e.g. 'person').",
      inputSchema: z.object({ kind: z.string().max(40).optional(), limit: z.number().int().min(1).max(200).default(50) }),
      execute: async ({ kind, limit }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        let q = db.from("leads").select("id, kind, name, email, phone, message, details, created_at").order("created_at", { ascending: false }).limit(limit);
        if (kind) q = q.eq("kind", kind);
        const { data, error } = await q;
        if (error) return { error: (error as { code?: string }).code === "PGRST205" ? "leads_not_set_up" : "load_failed" };
        return { leads: data ?? [] };
      },
    }),

    getCandidatePhone: tool({
      description:
        "Get a candidate's phone number (for a WhatsApp / call reminder) by candidateUserId. Read-only. Returns the number + a ready wa.me link.",
      inputSchema: z.object({ candidateUserId: z.string().uuid() }),
      execute: async ({ candidateUserId }) => {
        if (lockedOut) return { error: "out_of_scope" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data } = await db.from("candidate_profiles").select("phone").eq("user_id", candidateUserId).maybeSingle();
        const phone = (data as { phone?: string | null } | null)?.phone ?? null;
        const name = await displayName(candidateUserId);
        return { name, phone, wa: phone ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}` : null };
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
        "List message conversations (candidate ↔ Borivon) — each thread's candidate name, last-message preview, who sent it last, time, and unread count (candidate messages you haven't read). Read-only, newest activity first. For one thread's full messages use getCandidateThread; to reply use sendCandidateMessage.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(40) }),
      execute: async ({ limit }) => {
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
        const threads = new Map<string, { threadUserId: string; lastBody: string; lastSender: string; lastAt: string; hasAttachment: boolean; unread: number }>();
        for (const r of rows) { // newest-first → first row per thread is the latest message
          let t = threads.get(r.thread_user_id);
          if (!t) { t = { threadUserId: r.thread_user_id, lastBody: r.body ?? "", lastSender: r.sender_role, lastAt: r.created_at, hasAttachment: r.has_attachment === true, unread: 0 }; threads.set(r.thread_user_id, t); }
          if (r.sender_role === "candidate" && !r.read_by_admin) t.unread++;
        }
        const names = await resolveAuthNames([...threads.keys()]);
        const conversations = [...threads.values()]
          .sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
          .slice(0, limit)
          .map((t) => ({ candidateUserId: t.threadUserId, name: names[t.threadUserId]?.name ?? t.threadUserId, lastBody: (t.lastBody || "").slice(0, 140), lastSender: t.lastSender, lastAt: t.lastAt, hasAttachment: t.hasAttachment, unread: t.unread }));
        return { conversations };
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
        "STAGE assigning a candidate to an EMPLOYER (their target hospital/clinic). Sets candidate_profiles.employer_id — this drives the recipient on their visa cover letter AND (with the agency branding flag) which agency logo their CV carries. employerId = an id from listEmployers, or '' to CLEAR. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE creating a NEW employer (hospital/clinic) or updating an existing one. CREATE: give name + address (the postal address, one line per line break). UPDATE: give id + the fields to change. slug optional (a-z 0-9 _ -). agencyId = the agency org id this employer belongs to (from listOrganizations), or '' to clear. active=false RETIRES it (no hard delete). Supreme-admin only. Two-step: stage → admin confirms → confirmPendingWrite. After creating, use assignEmployer to place a candidate there.",
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
        "STAGE linking (or unlinking) a candidate to an ORGANIZATION (partner agency/employer with portal access — gives that org's people dossier access to the candidate). op 'link' (status 'approved' default, or 'pending') or 'unlink'. orgId from listOrganizations. Placement is SILENT (no candidate notification). Supreme-admin only. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE approving or rejecting a pending candidate→org link request (from listOrgRequests). decision 'approve' grants the org's people dossier access to that candidate; 'reject' marks it rejected (kept for audit, never hard-deleted). Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE accepting or skipping a suggested match (matchId from listSuggestedMatches). action 'accepted' silently links the candidate to that org (approved, no candidate notification — exactly like the website); 'skipped' dismisses the suggestion. Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE adding, editing, or closing an organization's open requirement (a hiring need). op 'add' (needs orgId from listOrganizations + any of specialty/slots/location/startDate/notes), 'edit' (needs requirementId from listOrgNeeds + the fields to change), or 'close' (needs requirementId — sets it inactive, audit-kept). Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE creating a NEW partner organization or renaming/editing one. op 'create' (needs name; optionally notes + a custom inviteCode, else one is generated) or 'edit' (needs orgId + any of name/notes/inviteCode). Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite. (Deleting an org cascades to candidate links and stays a website-only action.)",
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
        "STAGE setting an organization's branding footer text and/or vaccine requirement. orgId from listOrganizations. footerText = the footer line on that org's CVs/PDFs (or '' to clear). masern / varizell = required dose counts (0-5; drives the candidate Impfung track; both 0 = no vaccine requirement). Logo upload stays a website-only action (needs a file). Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE sending a candidate a Bearbeitung/Visum slot request — the action that turns the slot ORANGE (waiting on the candidate to sign/fill it) and drops a bell notification in their portal. slotId from listSlots. By default it figures out whether the candidate needs to sign and/or fill from the slot's own flags; you may override with needsSign/needsFill. Two-step: stage → admin confirms → confirmPendingWrite. (Uploading the slot's PDF template + drawing signature zones stays a website-only action.)",
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
        }));
        return { count: requests.length, requests };
      },
    }),

    reviewSignRequest: tool({
      description:
        "STAGE accepting or rejecting a candidate-SIGNED sign-request (signRequestId from listSignRequests). Only a request the candidate has already signed can be reviewed. 'reject' NEEDS a feedback reason (LAW #20) — the candidate is notified either way. Two-step: stage → admin confirms → confirmPendingWrite. (Creating a new sign-request from a PDF stays a website-only action.)",
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
        "STAGE creating or removing a Borivon HQ SUB-ADMIN. op 'create' (needs email; optional name + label) adds a sub-admin who can see ALL candidates (LAW #25). op 'remove' (needs email) deletes them and all their candidate assignments. Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite. (To onboard them yourself, use inviteSubAdmin for a self-serve link instead.)",
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
        "STAGE assigning (or unassigning) a candidate to a SUB-ADMIN so that sub-admin handles them. op 'assign' or 'unassign'; subAdminEmail from listStaff + candidateUserId from searchCandidates. Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE granting or revoking a candidate's blue VERIFIED tick (manually_verified). Grant makes them show as verified everywhere regardless of document status, and sends them a one-time 'verified' notification + email. verified true to grant, false to revoke. Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE adding, changing the role of, or removing an ORGANIZATION MEMBER (a person who logs in scoped to one partner org — sees ONLY that org's candidates). orgId from listOrganizations. op 'add' (email + role member/owner, optional name/label — creates their org-scoped sub-admin login if new), 'setRole' (email + role), or 'remove' (email — removes them from the org but keeps their account). Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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

    createCalendarEvent: tool({
      description:
        "STAGE creating a community CALENDAR event. title + startsAt (ISO date-time) required; optional endsAt, description, location, linkUrl (http/https), vipOnly (premium-only), repeatWeekly (1-52 → that many weekly copies). The event is PUBLIC (shown to everyone, or all premium if vipOnly). Image upload + tagging specific attendees stay website-only. Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE deleting a community CALENDAR event by eventId (from listCalendarEvents). Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite.",
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

    toggleStageLock: tool({
      description:
        "STAGE locking or UNLOCKING a candidate's pipeline STAGE (LAW #31 — supreme admin only; you operating it via the bot IS that power). stage one of 'bearbeitung' (the recognition/Bearbeitung stage), 'visum' (the embassy/Visum stage), 'integration', or 'start'. unlocked=true opens the stage for the candidate, false locks it. Two-step: stage → admin confirms → confirmPendingWrite. e.g. 'unlock the Visum stage for Hajar' → toggleStageLock(candidateUserId, 'visum', true); 'lock Bearbeitung for Ali' → toggleStageLock(candidateUserId, 'bearbeitung', false).",
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
        "STAGE permanently DELETING a partner ORGANIZATION by orgId (get it from listOrganizations). This CASCADES: it removes the org's members and unlinks every candidate tied to it (the candidates' own accounts are NOT deleted). Supreme-only, irreversible. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "Set a partner ORGANIZATION's logo from a PHOTO/IMAGE the admin ATTACHED to this message (PNG/JPEG/WebP/GIF, up to ~300KB). orgId from listOrganizations. That logo brands the org's candidates' CVs (agency branding) + their footer. Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite. Only call this when the admin actually ATTACHED an image AND named an org (otherwise an attached file is a candidate document → storeCandidateDocument).",
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
        "STAGE permanently DELETING a candidate's ENTIRE account + ALL their data — documents, pipeline, profile, messages, sign-requests, feed activity — and their login. IRREVERSIBLE. Supreme-only. Use ONLY when the admin clearly says to delete/remove a person's account (not for 'archive' or 'hide'). If unsure who they mean, searchCandidates first. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE setting a candidate's ACADEMY (German-school) CEFR LEVEL — 'A1', 'A2', 'B1' or 'B2' — in their active cohort. Climbing UP awards the one-time level-up points + pings the student. The candidate must already be enrolled in a cohort (else not_enrolled — enrol them on the website first). Supreme-only. Two-step: stage → admin confirms → confirmPendingWrite. e.g. 'promote Hajar to B2 in the school' → setAcademyLevel(candidateUserId, 'B2'). (Marking attendance + class bonus + building quizzes stay on the live-class teacher screen.)",
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
        "STAGE creating/editing/closing an employer intake BATCH. op 'create' (name required, e.g. 'UKSH — Q3 2026'; optional employerId from listEmployers, seats default 10, targetStart/targetEnd as YYYY-MM-DD, notes), 'edit' (batchId + any field), or 'close' (batchId — stops it counting as an open gap to fill). Supreme-only, confirm-first. e.g. 'open a UKSH batch for Q3, 10 seats' → manageBatch(op 'create', name 'UKSH — Q3 2026', seats 10).",
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
        "STAGE setting a candidate's FUNNEL STAGE and/or their BATCH. stage one of funneling / screening / interview1 / waiting_2nd / interview2 / passed / departed ('waiting_2nd' = passed the 1st interview and waiting for the 2nd date — the DROP-OUT danger zone the daily tasks watch). batchId from listBatches (or '' to unassign). At least one of stage/batchId required. Supreme-only, confirm-first. e.g. 'mark Hajar waiting for her 2nd interview' → setFunnelStage(candidateUserId, stage 'waiting_2nd'); 'put Ali in the UKSH Q3 batch' → setFunnelStage(candidateUserId, batchId …).",
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
        "List candidates who may need a NUDGE — their latest uploaded document was rejected ≥3 days ago and not re-submitted, or their pipeline hasn't moved in 3+ weeks. Read-only; returns each name + the reason(s). To nudge them, use nudgeStuckCandidates (all at once, confirm-first) or message one with sendCandidateMessage / sendFollowUpNudge. This is the same list the daily auto-chase push surfaces.",
      inputSchema: z.object({}),
      execute: async () => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { computeStuckCandidates } = await import("@/lib/autoChase");
        const { candidates, count } = await computeStuckCandidates();
        return { count, candidates };
      },
    }),

    nudgeStuckCandidates: tool({
      description:
        "STAGE a gentle follow-up nudge (a 'Borivon' bell reminder, never auto-sent) to ALL currently-stuck candidates (the listStuckCandidates set). Optional short custom message. Two-step: stage → show the count + names → admin confirms → confirmPendingWrite. (For one candidate, use sendFollowUpNudge or sendCandidateMessage.)",
      inputSchema: z.object({ message: z.string().max(200).optional() }),
      execute: async ({ message }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        const { computeStuckCandidates } = await import("@/lib/autoChase");
        const { candidates } = await computeStuckCandidates();
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
        "STAGE updating YOUR agency/employer contact profile (fills section C of German employer forms). Pass only the fields to change: firma (company name), strasse, hausnummer, plz, ort, kontaktperson, telefon, email, telefax, betriebsnummer. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE a candidate's Anerkennung (German diploma-recognition) stage. stage is one of: not_started, submitted (Antrag sent), in_review, deficit (Defizitbescheid), exam_or_course (Kenntnisprüfung/Anpassungslehrgang), recognized (full Approbation). Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE a candidate's nurse-profile facts (the structured data German hospitals filter on). Pass ONLY the fields to change. specialty ∈ general/intensive/geriatric/surgical/pediatric/emergency/anesthesia/psychiatric/obstetrics/oncology/cardiology/dialysis (or '' to clear). yearsExperience = whole number 0–60 as a string (or '' to clear). workplace = current/last workplace (or '' to clear). availableFrom = 'YYYY-MM-DD' (or '' to clear). Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE a gentle follow-up nudge into a candidate's notification bell (shown as coming from 'Borivon', never you) — use when they've gone quiet or missed a step. Optional short message. De-duped: refreshes an existing unread nudge rather than stacking. Two-step: stage → admin confirms → confirmPendingWrite. (To send an actual chat message or email, use sendCandidateMessage instead.)",
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
        "STAGE a change to a candidate's JOURNEY checklist. op: 'add' a task (text required; owner = who it's tagged to — 'candidate' = a task the candidate sees & does (DEFAULT), 'borivon' = internal Borivon task, 'organization' = the partner org's task); 'toggle' done/undone (id + done); 'rename' a custom task (id + text); 'delete' a custom task (id); 'setDue' a deadline (id + dueDate 'YYYY-MM-DD' or '' to clear); 'setBlocked' (id + blocked true/false + optional reason). Preset milestones can be toggled/dated/blocked but NOT renamed or deleted. Item ids show on the candidate's dashboard journey list. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE approving / rejecting / re-pending a candidate's uploaded DOCUMENT by its docId. status: 'approved' | 'rejected' | 'pending'. A rejection MUST include a non-empty feedback reason (shown to the candidate). Approve/reject fires the candidate's notification + email automatically (same as the website). Get the docId from listCandidateDocuments. NOTE: to approve/reject the passport DATA (extracted fields), use setPassportDataStatus instead — this is for the uploaded file's status. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE approving / rejecting / re-pending a candidate's passport DATA (the extracted fields: name, dob, passport no, etc. — NOT the scan PDF, which is reviewDocument). status: 'approved' | 'rejected' | 'pending'. Rejecting REQUIRES feedback, WIPES the extracted OCR fields, and notifies the candidate to re-submit. (LAW #38: this only flips the data's status — it can NEVER tick the human passport confirmation checkboxes.) Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE editing ONE passport/identity/contact field on a candidate's profile. candidate_profiles is the SINGLE SOURCE OF TRUTH (LAW #37) — the edit auto-propagates into their CV draft and everywhere their name shows. field is one of: first_name, last_name, dob, sex, nationality, passport_no, passport_expiry, city_of_birth, country_of_birth, issuing_authority, issue_date, address_street, address_number, address_postal, city_of_residence, country_of_residence, marital_status, children_ages. Dates accept 'YYYY-MM-DD' or 'DD.MM.YYYY'. value = the new value ('' clears it). To APPROVE/REJECT the passport data, use setPassportDataStatus. Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE rotating a stored document by a multiple of 90° (deltaRotation: 90, 180, 270, or -90). Persists the rotation. Passport scans rotate too (metadata-only — the bytes are never altered). Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE editing a CV-only field on a candidate's German CV draft. field ∈ driverLicense ('B' for a B licence, or '' for none), hobbies (free text), email, phone. value = the new value ('' clears it). For NAME / birth date / address / nationality / marital status, use editCandidateProfileField instead — those are the single source of truth and propagate into the CV automatically. The candidate must already have a CV draft (returns no_cv_yet otherwise). Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE generating the candidate's German CV PDF from their CV data and PUBLISHING it as their official 'Lebenslauf' document (it appears on their dashboard as approved/green and becomes attachable/sendable). It uses the candidate's current CV-branding setting — set it first with setCvBrandingMode if the admin wants agency/no branding. Requires the candidate to have CV data (returns no_cv_data otherwise). Use this when the admin says 'generate/make X's CV', or before emailing a CV for a candidate who has none on file yet. Two-step: stage → admin confirms → confirmPendingWrite. After it's published you can attach it via sendExternalEmail or deliver it via getDocumentDownloadLink.",
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
        "STAGE the branding used on a candidate's ADMIN-generated CV. mode: 'agency' = their employer's agency logo + footer (e.g. the Calmaroi branding); 'borivon' = plain Borivon; 'none' = no logo or footer at all. (Branding only applies when the CV is generated on the admin side — a candidate's own download is always plain Borivon.) Two-step: stage → admin confirms → confirmPendingWrite.",
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
        "STAGE an outbound EMAIL to an EXTERNAL person (an employer, recruiter, hospital contact — NOT a candidate; for candidates use sendCandidateMessage). e.g. 'send Hajar and Ali's CVs to anna.gombert@klinikum.de'. Provide to (ONE primary recipient's email), an optional toName, an optional cc (comma-separated extra recipients to copy — e.g. 'email Anna and CC Omar' → to=anna@…, cc='omar@…'), a subject, and a body (you write a clean, professional message). To attach candidate CVs, pass their FULL NAMES (comma-separated, exactly as you'd give them to getCvLinks) in attachCandidateNames — e.g. 'Ismail Louali, Samira Irsani, Hajar El Kairaa, Lahcen Labzioui'. The bot resolves each name to that person's latest CV and attaches it. ALWAYS use names (attachCandidateNames) for CVs — do NOT try to pass ids you don't have. To attach specific documents by id, use attachDocIds. It sends from youness.taoufiq@borivon.com.",
      inputSchema: z.object({
        to: z.string().min(3).max(254).describe("the ONE primary recipient's email address"),
        toName: z.string().max(120).optional().describe("the recipient's name, if known"),
        cc: z.string().max(1000).optional().describe("comma-separated additional recipients to CC (copy), e.g. 'omar@x.com, sara@x.com'"),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(8000).describe("the email body — write it professionally"),
        attachCandidateNames: z.string().optional().describe("comma-separated candidate FULL NAMES whose latest CV to attach — e.g. 'Ismail Louali, Samira Irsani'. This is the reliable way; names always resolve."),
        attachCandidateIds: z.string().optional().describe("(legacy) comma-separated candidate names OR candidateUserIds whose latest CV to attach — resolved the same way as attachCandidateNames"),
        attachDocIds: z.string().optional().describe("comma-separated document ids to attach"),
      }),
      execute: async ({ to, toName, cc, subject, body, attachCandidateNames, attachCandidateIds, attachDocIds }) => {
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
          ].filter(Boolean).join(" + ") || "none";
        // Strip any markdown the model added so the preview AND the sent email
        // are plain text — no relying on it to "remember" the no-stars rule.
        const cleanBody = stripEmailFormatting(body);
        const cleanSubject = stripEmailFormatting(subject);
        const args: Record<string, unknown> = { to: email, subject: cleanSubject, body: cleanBody };
        if (toName !== undefined) args.toName = toName;
        if (ccList.length) args.cc = ccList.join(",");
        if (candIds.length) args.attachCandidateIds = candIds.join(","); // RESOLVED real ids, not the raw input
        if (attachDocIds !== undefined) args.attachDocIds = attachDocIds;
        return stagePending(scope, {
          toolName: "sendExternalEmail",
          args,
          candidateUserId: null,
          summary: `📧 To: ${toName ? `${toName} <${email}>` : email}${ccList.length ? `\nCC: ${ccList.join(", ")}` : ""}\nSubject: ${cleanSubject}\nAttachments: ${attachDesc}\n\n${cleanBody.slice(0, 600)}${cleanBody.length > 600 ? "…" : ""}`,
        });
      },
    }),

    sendCandidateMessage: tool({
      description:
        "STAGE a message to a candidate — e.g. 'tell X to re-upload their CV in French', 'message X their interview is Monday 10:00', 'email X to send their passport scan'. channel: 'chat' = post into their portal chat as 'Borivon Support' (in-app, default); 'email' = send it as an email; 'both'. Two-step: this STAGES it + returns a summary — show it and ask the admin to confirm; ONLY when they confirm in a SEPARATE message do you call confirmPendingWrite (cancelPendingWrite on no). NEVER confirm in the same message you staged.",
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
        "STAGE creating a new LEAD / prospective-candidate record in Borivon — e.g. 'add Sara Alami, +212600112233, as a June 2027 candidate'. Captures the name + optional phone/email/note + an optional cohort label (like 'June 2027'). Two-step: stage → admin confirms → confirmPendingWrite. This creates a LEAD (it shows up in the admin Leads page); it does NOT create a candidate login account.",
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
        "STAGE storing the FILE the admin just attached to their Telegram message (a photo or document) into a candidate's documents. ONLY works when a file was actually attached — returns no_file otherwise. Steps: identify the candidate (searchCandidates / listAllCandidates), then call this with their candidateUserId and the docKey. docKey: 'id' = passport (Reisepass), 'cv_de' = CV (Lebenslauf), 'langcert' = B2 certificate, 'diploma' = diploma, 'workcert' = work permit, 'impfung' = vaccination record, or 'other' = Sonstiges (default — use when unsure). Two-step: stage → admin confirms in a SEPARATE message → confirmPendingWrite. The file lands in the candidate's portal as a pending document for review.",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        docKey: z.enum(["id", "cv_de", "langcert", "diploma", "workcert", "impfung", "other"]).default("other"),
      }),
      execute: async ({ candidateUserId, docKey }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!pendingFile) return { error: "no_file" };
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
        const label = FILE_KEY_LABELS[docKey]?.[0] ?? docKey;
        return stagePending(scope, {
          toolName: "storeCandidateDocument",
          args: { candidateUserId, docKey, r2Key: pendingFile.r2Key, mime: pendingFile.mime, fileName: pendingFile.fileName, sha256: pendingFile.sha256 },
          candidateUserId,
          summary: `Store "${pendingFile.fileName}" as ${label} for ${name}`,
        });
      },
    }),
  };
}
