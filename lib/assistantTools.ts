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
import { getServiceSupabase } from "@/lib/supabase";
import { canActOnCandidate } from "@/lib/admin-auth";
import { resolveFileKey } from "@/lib/fileKeys";
import { signDlToken } from "@/lib/dlToken";
import { computeBriefing } from "@/lib/briefing";
import { stagePending, executeLatestPending, cancelLatestPending } from "@/lib/assistantWrites";
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

/** Escape ilike wildcards so a name with %/_ can't act as a wildcard. */
const esc = (s: string): string => s.replace(/[\\%_]/g, (c) => "\\" + c);

export function buildAssistantTools(scope: AssistantScope) {
  const db = getServiceSupabase();
  const lockedOut = scope.visibleIds !== null && scope.visibleIds.length === 0;

  return {
    searchCandidates: tool({
      description:
        "Search candidates by name (first or last, partial is fine). Returns the candidates you are allowed to see, each with a candidateUserId you can pass to other tools. Use this to find a person before looking up their details or documents.",
      inputSchema: z.object({
        query: z.string().min(1).max(120).describe("name or partial name"),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      execute: async ({ query, limit }) => {
        if (lockedOut) return { candidates: [] };
        const q = esc(query);
        let qb = db
          .from("candidate_profiles")
          .select("user_id, first_name, last_name")
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
        if (scope.visibleIds !== null) qb = qb.in("user_id", scope.visibleIds);
        const { data, error } = await qb.limit(Math.min((limit ?? 10) * 3, 75));
        if (error) return { error: "search_failed" };
        const rows = ((data ?? []) as ProfileRow[])
          .filter((r) => scope.inScope(r.user_id))
          .slice(0, limit ?? 10)
          .map((r) => ({ candidateUserId: r.user_id, name: nameOf(r) }));
        return { candidates: rows };
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
        const rows = ((data ?? []) as ProfileRow[])
          .filter((r) => scope.inScope(r.user_id))
          .map((r) => ({ r, ms: parseDate(r.b2_exam_date) }))
          .filter((x): x is { r: ProfileRow; ms: number } => x.ms !== null && x.ms <= horizon)
          .sort((a, b) => a.ms - b.ms)
          .slice(0, limit ?? 20)
          .map((x) => ({
            candidateUserId: x.r.user_id,
            name: nameOf(x.r),
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
        return {
          candidate: {
            candidateUserId: r.user_id,
            name: nameOf(r),
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

    // ── Personal task memory (the admin's OWN reminders — not candidate data) ──
    saveReminder: tool({
      description:
        "Save a personal reminder/task for the admin (e.g. 'chase Youssef's passport', 'call the embassy Monday'). Use this whenever the admin tells you to remember something or notes a task to do later. Optionally tie it to a candidate and/or a due date.",
      inputSchema: z.object({
        text: z.string().min(1).max(500).describe("the task / thing to remember"),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ISO date YYYY-MM-DD if a deadline was mentioned"),
        candidateUserId: z.string().uuid().optional().describe("if the reminder is about a specific candidate"),
      }),
      execute: async ({ text, dueDate, candidateUserId }) => {
        if (candidateUserId && !(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data, error } = await db
          .from("assistant_reminders")
          .insert({ owner_user_id: scope.userId, text, due_date: dueDate ?? null, candidate_user_id: candidateUserId ?? null })
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
        "Save a DURABLE preference, term, or correction about how the admin likes to work — e.g. 'prefers short answers', 'always lead with passports', 'by batch they mean a monthly cohort', 'wants dates as DD.MM.YYYY'. Call this whenever the admin states a lasting preference, teaches you a term, or corrects you for the future, then briefly confirm. Do NOT use it for one-off requests, tasks (use saveReminder), or candidate data.",
      inputSchema: z.object({
        text: z.string().min(1).max(300),
        kind: z.enum(["preference", "fact", "term", "correction"]).default("preference"),
      }),
      execute: async ({ text, kind }) => {
        if (!scope.userId) return { error: "no_user" };
        const { error } = await db.from("assistant_memory").insert({ owner_user_id: scope.userId, text, kind });
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
        which: z.union([z.literal(1), z.literal(2)]).default(1),
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
        which: z.union([z.literal(1), z.literal(2)]).default(1),
        date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
      }),
      execute: async ({ candidateUserId, which, date }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
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

    setCandidateMilestone: tool({
      description:
        "STAGE a pipeline milestone change for a candidate ('X got their visa', 'X's flight is June 20', 'X signed the contract', 'X arrived'). Two-step: stage → admin confirms → confirmPendingWrite. field is one of: visa_granted/housing_done/contract_done/recognition_done/docs_approved/docs_ready/vorab_done/arrived_done (value true/false), visa_date/visa_appt_date/flight_date (value 'YYYY-MM-DD' or '' to clear), flight_info (value = text).",
      inputSchema: z.object({
        candidateUserId: z.string().uuid(),
        field: z.enum(["visa_granted", "housing_done", "contract_done", "recognition_done", "docs_approved", "docs_ready", "vorab_done", "arrived_done", "visa_date", "visa_appt_date", "flight_date", "flight_info"]),
        value: z.union([z.boolean(), z.string()]),
      }),
      execute: async ({ candidateUserId, field, value }) => {
        if (scope.role !== "admin") return { error: "admin_only" };
        if (!(await canActOnCandidate(scope.role, scope.email, candidateUserId))) return { error: "out_of_scope" };
        const { data } = await db.from("candidate_profiles").select("first_name, last_name").eq("user_id", candidateUserId).maybeSingle();
        const name = data ? nameOf(data as { first_name: string | null; last_name: string | null }) : "this candidate";
        const human = typeof value === "boolean" ? (value ? "yes" : "no") : (value || "cleared");
        return stagePending(scope, {
          toolName: "setCandidateMilestone",
          args: { candidateUserId, field, value },
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
  };
}
