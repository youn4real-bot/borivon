/**
 * POST /api/portal/admin/cv-autofill?candidateId=<uuid>
 *
 * ADMIN-ONLY CV auto-fill. Takes the admin's current CV draft in the body, fills
 * the EMPTY, tedious German duty bullets (Tätigkeiten) — Gemini Flash drafts them,
 * with a deterministic nursing-catalog fallback so it works even if Flash is down —
 * plus the phone if Borivon already holds it. Returns the merged draft; the client
 * drops it into the editor (fully editable) and its normal autosave persists it.
 *
 * It NEVER saves on its own and NEVER invents hard facts (employers, dates,
 * institutions). Scope is the same LAW #25 gate as /api/portal/admin/cv-draft.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import { vertexModel, GEMINI_SAFETY } from "@/lib/vertexModel";
import { generateText } from "ai";
import {
  applyAutofill,
  entriesNeedingDuties,
  isNursingEntry,
  NURSING_DUTY_DEFAULTS,
  MAX_DUTY_WORDS,
  type DraftLike,
  type GeneratedDuties,
  type WorkEntryLike,
} from "@/lib/cvAutofill";

const MAX_DRAFT_BYTES = 500_000;
const AI_TIMEOUT_MS = 12_000;

/** Pull the first {...} JSON object out of a model reply (tolerates fences/prose). */
function extractJson(text: string): unknown {
  const raw = (text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/** Ask Flash for German duty bullets per entry index. Never throws → {} on any failure. */
async function generateDuties(
  draft: DraftLike,
  indexes: number[],
  specialty: string | null,
  years: number | null,
): Promise<GeneratedDuties> {
  if (indexes.length === 0) return {};
  const model = vertexModel("flash");
  if (!model) return {}; // no brain configured → deterministic fallback handles nursing

  const entries = Array.isArray(draft.workEntries) ? draft.workEntries : [];
  const jobs = indexes.map((i) => {
    const e = (entries[i] ?? {}) as WorkEntryLike;
    return {
      index: i,
      title: (e.title ?? "").slice(0, 120),
      employer: (e.employer ?? "").slice(0, 120),
      departments: Array.isArray(e.departments) ? e.departments.slice(0, 8) : [],
      nursing: isNursingEntry(e, i, specialty),
    };
  });

  const system = [
    "You write the German 'Tätigkeiten' (duty bullets) for a Moroccan nurse's German CV (Lebenslauf).",
    "For each job you are given, return 3 to 4 concise, professional German bullets describing typical duties for that role.",
    `Rules: German only; each bullet at most ${MAX_DUTY_WORDS} words; no trailing period; no numbering; do not invent employers, dates, patient names or places.`,
    "For NURSING jobs, prefer these exact standard German duties (copy the strings verbatim) and pick the ones that fit the departments given:",
    NURSING_DUTY_DEFAULTS.concat([
      "Wundversorgung und Verbandwechsel",
      "Injektionen und Infusionen",
      "Blutentnahme",
      "Unterstützung bei der Körperpflege",
      "Mobilisation der Patienten",
      "Begleitung der ärztlichen Visite",
      "Einhaltung von Hygienevorschriften",
      "Arbeit im Schichtdienst",
    ]).map((d) => `- ${d}`).join("\n"),
    "For non-nursing jobs, write suitable concise German bullets from the job title.",
    'Output ONLY a JSON object, no prose, no code fences: {"entries":[{"index":<n>,"taetigkeiten":["...","...","..."]}]}',
  ].join("\n");

  const prompt = JSON.stringify({
    specialty: specialty || undefined,
    yearsExperience: years ?? undefined,
    jobs,
  }).slice(0, 4000);

  try {
    const gen = generateText({
      model,
      system,
      prompt,
      temperature: 0.4,
      maxOutputTokens: 900,
      maxRetries: 1,
      providerOptions: { vertex: { safetySettings: GEMINI_SAFETY }, google: { safetySettings: GEMINI_SAFETY } },
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AI_TIMEOUT_MS));
    const result = await Promise.race([gen, timeout]);
    if (!result) return {};
    const obj = extractJson(result.text ?? "") as { entries?: { index?: number; taetigkeiten?: unknown }[] } | null;
    if (!obj || !Array.isArray(obj.entries)) return {};
    const out: GeneratedDuties = {};
    for (const row of obj.entries) {
      if (typeof row?.index !== "number" || !indexes.includes(row.index)) continue;
      if (Array.isArray(row.taetigkeiten)) out[row.index] = row.taetigkeiten as string[];
    }
    return out;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  if (!candidateId || !UUID_RE.test(candidateId))
    return NextResponse.json({ error: "Invalid candidateId" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, candidateId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rawBody = await req.text();
  if (rawBody.length > MAX_DRAFT_BYTES)
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const draft = (parsed as { draft?: unknown } | null)?.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft))
    return NextResponse.json({ error: "Invalid draft" }, { status: 400 });

  // What Borivon already knows (fail-open: a missing column just means less context).
  let phone: string | null = null;
  let specialty: string | null = null;
  let years: number | null = null;
  try {
    const db = getServiceSupabase();
    const { data } = await db
      .from("candidate_profiles")
      .select("phone, nursing_specialty, years_experience")
      .eq("user_id", candidateId)
      .maybeSingle();
    const row = data as { phone?: string | null; nursing_specialty?: string | null; years_experience?: number | null } | null;
    phone = row?.phone ?? null;
    specialty = row?.nursing_specialty ?? null;
    years = typeof row?.years_experience === "number" ? row.years_experience : null;
  } catch { /* fail-open — proceed with what we have */ }

  const draftObj = draft as DraftLike;
  const indexes = entriesNeedingDuties(draftObj, specialty);
  const generated = await generateDuties(draftObj, indexes, specialty, years);
  const { draft: merged, filled } = applyAutofill(draftObj, { phone, specialty }, generated);

  return NextResponse.json({ draft: merged, filled });
}
