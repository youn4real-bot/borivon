/**
 * NATURAL-LANGUAGE CANDIDATE SEARCH — the deterministic core.
 *
 * The founder types plain language ("candidates who got the B2 certificate in the
 * last year", "who has an interview scheduled next week") and gets REAL candidates
 * back — never invented ones. The guarantee comes from a strict split:
 *
 *   words ──▶ [ AI or keyword parser ] ──▶ CandidateQuery (a flat filter) ──▶
 *   [ compileCandidateQuery ] ──▶ matched rows from the real, already-scoped set.
 *
 * The AI's ONLY job is to fill the filter. It never sees candidate data and never
 * produces a candidate — so it cannot hallucinate a person. Every row returned came
 * out of `compileCandidateQuery` running over the actual assembled candidate set.
 *
 * This module is PURE (no I/O). The assembler (lib/candidateSearchData.ts) does the
 * scoped DB reads; the AI translator (lib/candidateSearchAI.ts) fills the filter;
 * the route (app/api/portal/admin/search) wires them. Kept pure so the whole
 * matching contract is unit-testable without a database or a model — see
 * tests/candidateSearch.test.ts.
 */

import { B2_STAGE_BY_KEY, b2StageColor, b2StageLabel, normalizeB2Stage, type B2Stage } from "@/lib/b2Journey";
import { specialtyLabel } from "@/lib/nurseSpecialties";
import { funnelLabel } from "@/lib/batchBoard";

const DAY = 86_400_000;

export const SEARCH_LIMIT_DEFAULT = 60;
export const SEARCH_LIMIT_MAX = 200;

/** A three-language string helper used throughout the module. */
type Lang = "en" | "fr" | "de";
function L(lang: string, en: string, fr: string, de: string): string {
  return lang === "fr" ? fr : lang === "de" ? de : en;
}

/** Localized label for a passport-status token (pending/approved/rejected). */
function passportStatusLabel(status: string | null | undefined, lang: string): string {
  const s = String(status ?? "").toLowerCase();
  if (s === "pending") return L(lang, "pending", "en attente", "ausstehend");
  if (s === "approved") return L(lang, "approved", "approuvé", "genehmigt");
  if (s === "rejected") return L(lang, "rejected", "rejeté", "abgelehnt");
  return status ? String(status) : "—";
}

/** Localized label for a workplace preference (altenheim/klinik/either). */
function workplacePrefLabel(pref: string, lang: string): string {
  const p = pref.toLowerCase();
  if (p === "altenheim") return L(lang, "nursing home", "maison de retraite", "Altenheim");
  if (p === "klinik") return L(lang, "clinic", "clinique", "Klinik");
  if (p === "either") return L(lang, "either", "les deux", "egal");
  return pref;
}

// ─── The assembled candidate record the compiler runs over ────────────────────
// Built once per request by lib/candidateSearchData.ts from the real (already
// org-scoped) candidate set. Dates are epoch-ms so comparisons are trivial; null
// means "unknown", which never matches a positive filter.
export type SearchableCandidate = {
  uid: string;
  name: string;
  email: string;
  photo: string | null;
  createdAtMs: number | null;   // signup time (auth.users.created_at)
  lastSignInMs: number | null;  // last login (activity / inactivity radar)

  // candidate_profiles
  b2Stage: B2Stage;             // normalized rail stage
  b2Failed: boolean;
  nationality: string | null;
  cityOfBirth: string | null;
  cityOfResidence: string | null;
  sex: string | null;
  maritalStatus: string | null;
  specialty: string | null;     // stable key (lib/nurseSpecialties)
  yearsExperience: number | null;
  workplacePref: string | null;
  placementReady: boolean;
  verified: boolean;
  passportStatus: string | null;
  passportExpiryMs: number | null;
  availableFromMs: number | null;
  hasEmployer: boolean;
  orgNames: string[];

  // candidate_status (admin-only B2 truth — the real "has the certificate" signal)
  b2Complete: boolean | null;
  b2CertDateMs: number | null;
  b2ExamMs: number | null;      // soonest planned B2 exam (profile or status)

  // candidate_pipeline
  funnelStage: string | null;
  interview1Ms: number | null;
  interview2Ms: number | null;
  interview1Status: string | null;
  interview2Status: string | null;
  visaApptMs: number | null;
  flightMs: number | null;
  lastTouchMs: number | null;

  // documents summary
  pendingDocCount: number;
  hasApprovedB2Cert: boolean;
};

// ─── The flat filter the parser produces ──────────────────────────────────────
// Deliberately flat (no unions / nesting / regex) so it survives Gemini structured
// output and is trivial to validate in code (see sanitizeQuery). Every field is
// optional and AND-combined; an absent field imposes no constraint.
export type CandidateQuery = {
  text?: string;                       // free-text over name / email / specialty / city / nationality

  // B2 language
  b2Certified?: boolean;               // holds the B2 certificate (status.b2_complete OR rail=passed OR approved cert doc)
  b2CertifiedWithinDays?: number;      // certificate obtained within the last N days
  b2Stage?: string;                    // exact rail stage key
  b2Failed?: boolean;                  // failed B2 at least once
  b2ExamWithinDays?: number;           // planned B2 exam within the next N days

  // interviews
  interviewWithinDays?: number;        // an interview date within the next N days
  hasUpcomingInterview?: boolean;      // any interview date in the future
  interviewPassed?: boolean;           // passed at least one interview

  // funnel / pipeline
  funnelStage?: string;                // exact funnel stage key
  visaWithinDays?: number;             // visa appointment within the next N days

  // nurse profile
  specialty?: string;                  // specialty key
  minYearsExperience?: number;
  workplacePref?: string;              // altenheim | klinik | either
  availableWithinDays?: number;        // available_from within the next N days

  // identity / location
  nationality?: string;                // substring
  cityOfBirth?: string;                // substring
  cityOfResidence?: string;            // substring
  sex?: string;                        // m | f
  maritalStatus?: string;              // substring

  // passport
  passportStatus?: string;             // approved | pending | rejected
  passportPending?: boolean;           // passport awaiting review
  passportExpiringWithinDays?: number; // passport expiry within the next N days
  passportExpired?: boolean;           // passport already expired (expiry in the past)

  // flags
  placementReady?: boolean;
  verified?: boolean;
  hasEmployer?: boolean;
  orgName?: string;                    // substring against linked org names

  // activity
  signedUpWithinDays?: number;         // registered within the last N days
  inactiveForDays?: number;            // no login for >= N days (or never logged in)

  // presentation
  sortBy?: string;                     // recent | name | b2CertDate | interview | signup | experience
  limit?: number;
};

/** One result row handed to the UI. Everything the card needs, already localized. */
export type SearchHit = {
  uid: string;
  name: string;
  email: string;
  photo: string | null;
  why: string;        // localized "why this candidate matched"
  sub: string;        // localized secondary line (specialty · city · stage)
  stageColor: string; // B2 rail ring colour for a status dot
  pendingDocs: number;
};

// ─── Normalisation ────────────────────────────────────────────────────────────
// Accent- + case-insensitive so "Casablanca" matches "casablanca" and "Gériatrie"
// matches "geriatrie". NFD + combining-marks strip is the standard fold.
export function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// ─── Query sanitisation ───────────────────────────────────────────────────────
// The ONE validation gate. Whatever the parser (AI or keyword) hands us, this
// coerces each known field to the right type, clamps ranges, and DROPS everything
// unknown. Nothing downstream trusts raw parser output — this is the boundary
// (LAW-grade: the model can ask for anything; only what survives here is applied).
function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1) return true;
  if (v === "false" || v === 0) return false;
  return undefined;
}
function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, 200) : undefined;
}
/** Clamp a "within N days" window to a sane, non-negative range. */
function days(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return Math.max(0, Math.min(Math.round(n), 3650));
}

export function sanitizeQuery(raw: unknown): CandidateQuery {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const q: CandidateQuery = {};

  const text = str(r.text); if (text) q.text = text;

  const b2c = bool(r.b2Certified); if (b2c !== undefined) q.b2Certified = b2c;
  const b2cw = days(r.b2CertifiedWithinDays); if (b2cw !== undefined) q.b2CertifiedWithinDays = b2cw;
  const b2s = str(r.b2Stage); if (b2s && b2s in B2_STAGE_BY_KEY) q.b2Stage = b2s;
  const b2f = bool(r.b2Failed); if (b2f !== undefined) q.b2Failed = b2f;
  const b2ew = days(r.b2ExamWithinDays); if (b2ew !== undefined) q.b2ExamWithinDays = b2ew;

  const iw = days(r.interviewWithinDays); if (iw !== undefined) q.interviewWithinDays = iw;
  const hui = bool(r.hasUpcomingInterview); if (hui !== undefined) q.hasUpcomingInterview = hui;
  const ip = bool(r.interviewPassed); if (ip !== undefined) q.interviewPassed = ip;

  const fs = str(r.funnelStage); if (fs) q.funnelStage = fs;
  const vw = days(r.visaWithinDays); if (vw !== undefined) q.visaWithinDays = vw;

  const sp = str(r.specialty); if (sp) q.specialty = sp;
  const mye = num(r.minYearsExperience); if (mye !== undefined) q.minYearsExperience = Math.max(0, Math.min(Math.round(mye), 60));
  const wp = str(r.workplacePref); if (wp) q.workplacePref = wp.toLowerCase();
  const aw = days(r.availableWithinDays); if (aw !== undefined) q.availableWithinDays = aw;

  const nat = str(r.nationality); if (nat) q.nationality = nat;
  const cob = str(r.cityOfBirth); if (cob) q.cityOfBirth = cob;
  const cor = str(r.cityOfResidence); if (cor) q.cityOfResidence = cor;
  const sex = str(r.sex); if (sex) { const s = sex.toLowerCase()[0]; if (s === "m" || s === "f") q.sex = s; }
  const mar = str(r.maritalStatus); if (mar) q.maritalStatus = mar;

  const ps = str(r.passportStatus); if (ps) q.passportStatus = ps.toLowerCase();
  const pp = bool(r.passportPending); if (pp !== undefined) q.passportPending = pp;
  const pew = days(r.passportExpiringWithinDays); if (pew !== undefined) q.passportExpiringWithinDays = pew;
  const pexp = bool(r.passportExpired); if (pexp !== undefined) q.passportExpired = pexp;

  const pr = bool(r.placementReady); if (pr !== undefined) q.placementReady = pr;
  const ver = bool(r.verified); if (ver !== undefined) q.verified = ver;
  const he = bool(r.hasEmployer); if (he !== undefined) q.hasEmployer = he;
  const org = str(r.orgName); if (org) q.orgName = org;

  const suw = days(r.signedUpWithinDays); if (suw !== undefined) q.signedUpWithinDays = suw;
  const inact = days(r.inactiveForDays); if (inact !== undefined) q.inactiveForDays = inact;

  const sortBy = str(r.sortBy); if (sortBy) q.sortBy = sortBy;
  const limit = num(r.limit); if (limit !== undefined) q.limit = Math.max(1, Math.min(Math.round(limit), SEARCH_LIMIT_MAX));

  return q;
}

/** True when the filter imposes no constraint at all (→ "show everyone"). */
export function isEmptyQuery(q: CandidateQuery): boolean {
  return Object.keys(q).filter((k) => k !== "sortBy" && k !== "limit").length === 0;
}

/**
 * Pull a JSON object out of a model reply. Tolerates ```json fences and leading
 * prose by scanning for the first balanced { … } block. Pure (lives here, not in
 * the AI module, so tests can exercise it without loading the model SDK).
 */
export function extractFilterJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const direct = tryParseObject(s);
  if (direct) return direct;
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return tryParseObject(s.slice(start, i + 1)); }
  }
  return null;
}
function tryParseObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ─── Keyword fallback parser ──────────────────────────────────────────────────
// Runs when the AI is unreachable/unconfigured OR returns nothing usable, so the
// bar NEVER dies. Best-effort, EN/FR/DE. It intentionally covers the common shapes
// the founder actually types; anything it can't classify falls through to a
// free-text name match, which still returns real people.
export function keywordParseQuery(text: string): CandidateQuery {
  const t = norm(text);
  if (!t) return {};
  const q: CandidateQuery = {};
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  // A time window AND its direction. Future-only facets (interview / exam / visa)
  // must NOT accept a PAST phrase — else "interviews last week" would silently
  // return UPCOMING interviews. Past facets (cert / signup) must not accept a
  // pure-future phrase. "this week/year" is neutral (accepted by both).
  const detectWindow = (): { days: number; dir: "past" | "future" | "neutral" } | undefined => {
    const past = has("last year", "past year", "last month", "past month", "last week", "past week", "derniere annee", "an dernier", "dernier mois", "derniere semaine", "letztes jahr", "letzten monat", "letzte woche", "letzten 12", " ago", "il y a", "vor ");
    const future = has("next week", "next month", "coming month", "upcoming", "prochaine semaine", "semaine prochaine", "prochain mois", "mois prochain", "nachste woche", "naechste woche", "nachsten monat", "naechsten monat", "tomorrow", "demain", "morgen", "a venir", "anstehend", "in the next", "dans les");
    let days: number | undefined;
    const m = t.match(/(\d+)\s*(day|jour|tag)/);
    if (m) days = Math.max(1, Math.min(parseInt(m[1], 10), 3650));
    else if (has("year", "annee", "jahr", "12 month", "twelve month", "12 monat")) days = 365;
    else if (has("month", "mois", "monat", "30 day", "30 tage")) days = 30;
    else if (has("week", "semaine", "woche", "7 day", "7 tage")) days = 7;
    else if (has("tomorrow", "demain", "morgen")) days = 2;
    else if (has("today", "aujourd", "heute")) days = 1;
    if (days === undefined) return undefined;
    return { days, dir: past && !future ? "past" : future && !past ? "future" : "neutral" };
  };
  const pastWindow = () => { const w = detectWindow(); return w && w.dir !== "future" ? w.days : undefined; };
  const futureWindow = () => { const w = detectWindow(); return w && w.dir !== "past" ? w.days : undefined; };

  const b2Context = has("b2", "certificate", "certified", "certificat", "certifie", "zertifikat", "zertifiziert", "sprachzert", "language cert", "diploma allemand", "german level", "niveau allemand");
  const interviewContext = has("interview", "entretien", "gesprach", "gespraech", "vorstellung");
  const examContext = has("exam", "examen", "prufung", "pruefung");
  const visaContext = has("visa", "visum");

  // B2 certificate — include the PARTICIPLE forms (certified / certifié →
  // "certifie" / zertifiziert), which is how the founder and the example chips
  // actually phrase it. NO bare "have": too common a verb, it was silently forcing
  // the certified filter on any B2-context query that happened to contain it.
  if (b2Context && has("certificate", "certified", "certificat", "certifie", "zertifikat", "zertifiziert", "sprachzert", "passed", "reussi", "bestanden", "got ", "obtained", "obtenu", "erhalten", "have the", "hat den")) {
    q.b2Certified = true;
    const w = pastWindow(); if (w) q.b2CertifiedWithinDays = w;
  } else if (has("passed b2", "b2 passed", "b2 reussi", "b2 bestanden")) {
    q.b2Certified = true;
  }
  if (has("failed b2", "b2 failed", "b2 echoue", "b2 nicht bestanden", "durchgefallen")) q.b2Failed = true;
  if (examContext && b2Context) { const w = futureWindow(); if (w) q.b2ExamWithinDays = w; }

  // Interviews (a future-only window)
  if (interviewContext) {
    if (has("passed", "reussi", "bestanden", "succeed")) q.interviewPassed = true;
    const w = futureWindow();
    if (w) q.interviewWithinDays = w;
    else if (has("scheduled", "upcoming", "coming", "prevu", "geplant", "a venir", "anstehend")) q.hasUpcomingInterview = true;
  }

  // Visa (a future-only window)
  if (visaContext) {
    const w = futureWindow();
    if (w) q.visaWithinDays = w;
    else if (has("waiting", "attente", "wartet", "warten")) q.funnelStage = "passed";
  }

  // Nurse profile — experience "N years"
  const exp = t.match(/(\d+)\s*\+?\s*(year|yr|an|jahr)/);
  if (exp) q.minYearsExperience = Math.max(0, Math.min(parseInt(exp[1], 10), 60));

  // Specialty keywords → stable key
  const specMap: [string[], string][] = [
    [["icu", "intensive", "soins intensifs", "intensiv"], "intensive"],
    [["geriatr", "elderly", "altenpflege", "alten"], "geriatric"],
    [["surg", "operating", "chirurg", "op ", "bloc"], "surgical"],
    [["pediatr", "children", "kinder"], "pediatric"],
    [["emergency", "urgence", "notaufnahme", "notfall"], "emergency"],
    [["anesth", "anasth"], "anesthesia"],
    [["psychiatr", "psych"], "psychiatric"],
    [["obstetr", "midwife", "sage-femme", "geburt", "hebamme"], "obstetrics"],
    [["oncolog", "cancer", "onkolog"], "oncology"],
    [["cardiolog", "cardiac", "herz"], "cardiology"],
    [["dialysis", "nephro", "dialyse"], "dialysis"],
  ];
  for (const [words, key] of specMap) { if (has(...words)) { q.specialty = key; break; } }

  // Nationality (this pool is overwhelmingly Moroccan; still generic)
  if (has("moroccan", "marocain", "marokkan", "morocco", "maroc", "marokko")) q.nationality = "maroc";

  // Passport review
  if (has("passport", "reisepass", "passeport")) {
    // "expired"/"abgelaufen" = PAST (already lapsed); "expiring"/"ablauf" = a future
    // window — kept distinct so a compliance query for lapsed passports isn't
    // silently converted into "expiring soon".
    if (has("expired", "abgelaufen")) q.passportExpired = true;
    else if (has("expir", "expire", "ablauf")) { const w = futureWindow(); q.passportExpiringWithinDays = w ?? 180; }
    if (has("pending", "review", "waiting", "stuck", "attente", "revoir", "prufung", "warten", "offen")) q.passportPending = true;
    else if (has("rejected", "rejete", "abgelehnt")) q.passportStatus = "rejected";
    else if (has("approved", "approuve", "genehmigt", "bestatigt")) q.passportStatus = "approved";
  }

  // Flags
  if (has("placement ready", "ready for placement", "vermittlungsbereit", "pret au placement", "pret", "ready to place")) q.placementReady = true;
  if (has("verified", "verifie", "verifiziert")) q.verified = true;
  if (has("has employer", "employer assigned", "assigned to", "arbeitgeber", "employeur")) q.hasEmployer = true;

  // Funnel stage keywords (only when not already set by the visa branch)
  if (!q.funnelStage) {
    if (has("waiting for 2nd", "waiting second", "2nd interview wait", "attente 2e", "warten auf zweit")) q.funnelStage = "waiting_2nd";
    else if (has("screening")) q.funnelStage = "screening";
    else if (has("departed", "left for germany", "parti", "abgereist")) q.funnelStage = "departed";
  }

  // Activity
  if (has("inactive", "cold", "quiet", "not logged", "inactif", "inaktiv", "nicht eingeloggt", "abwesend")) q.inactiveForDays = 7;
  if (!examContext && !b2Context && !interviewContext && has("new", "recent", "just signed", "just registered", "nouveau", "neu", "kurzlich")) {
    q.signedUpWithinDays = pastWindow() ?? 14;
    q.sortBy = "recent";
  }

  // If nothing structured was detected, treat the whole thing as a name/keyword
  // search — still grounded, still real people.
  if (isEmptyQuery(q)) {
    const cleaned = text.trim();
    if (cleaned && cleaned.length <= 80) q.text = cleaned;
  }
  return q;
}

// ─── The compiler — pure, deterministic matching ──────────────────────────────
type ActiveReason = { key: string; label: string };

/** Build the localized "why matched" + secondary line for one hit. */
function reasonsFor(c: SearchableCandidate, q: CandidateQuery, lang: string, nowMs: number): string {
  const parts: string[] = [];
  const iso = (ms: number | null) => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10));
  if (q.b2Certified || q.b2CertifiedWithinDays !== undefined) {
    parts.push(c.b2CertDateMs ? `${L(lang, "B2 cert", "B2 cert.", "B2-Zert.")} ${iso(c.b2CertDateMs)}` : L(lang, "B2 certified", "B2 certifié", "B2 zertifiziert"));
  }
  if (q.b2Stage) parts.push(b2StageLabel(c.b2Stage, lang));
  if (q.b2Failed) parts.push(L(lang, "failed B2 once", "a échoué B2", "B2 nicht bestanden"));
  if (q.b2ExamWithinDays !== undefined && c.b2ExamMs) parts.push(`${L(lang, "B2 exam", "examen B2", "B2-Prüfung")} ${iso(c.b2ExamMs)}`);
  if (q.interviewWithinDays !== undefined || q.hasUpcomingInterview) {
    const soon = [c.interview1Ms, c.interview2Ms].filter((m): m is number => m != null && m >= nowMs - DAY).sort((a, b) => a - b)[0];
    if (soon) parts.push(`${L(lang, "interview", "entretien", "Gespräch")} ${iso(soon)}`);
  }
  if (q.interviewPassed) parts.push(L(lang, "interview passed", "entretien réussi", "Gespräch bestanden"));
  if (q.funnelStage) parts.push(funnelLabel(c.funnelStage));
  if (q.visaWithinDays !== undefined && c.visaApptMs) parts.push(`${L(lang, "visa appt", "RDV visa", "Visumtermin")} ${iso(c.visaApptMs)}`);
  if (q.specialty && c.specialty) parts.push(specialtyLabel(c.specialty, lang));
  if (q.minYearsExperience !== undefined && c.yearsExperience != null) parts.push(`${c.yearsExperience} ${L(lang, "yrs exp", "ans exp", "J. Erf.")}`);
  if (q.availableWithinDays !== undefined && c.availableFromMs) parts.push(`${L(lang, "available", "disponible", "verfügbar")} ${iso(c.availableFromMs)}`);
  if (q.passportPending || q.passportStatus) parts.push(`${L(lang, "passport", "passeport", "Pass")}: ${passportStatusLabel(c.passportStatus, lang)}`);
  if (q.passportExpired && c.passportExpiryMs) parts.push(`${L(lang, "passport expired", "passeport expiré", "Pass abgelaufen")} ${iso(c.passportExpiryMs)}`);
  if (q.passportExpiringWithinDays !== undefined && c.passportExpiryMs) parts.push(`${L(lang, "passport exp", "passeport exp", "Pass läuft ab")} ${iso(c.passportExpiryMs)}`);
  if (q.placementReady) parts.push(L(lang, "placement ready", "prêt au placement", "vermittlungsbereit"));
  if (q.verified) parts.push(L(lang, "verified", "vérifié", "verifiziert"));
  if (q.hasEmployer) parts.push(L(lang, "has employer", "employeur assigné", "Arbeitgeber"));
  if (q.orgName && c.orgNames.length) parts.push(c.orgNames.join(", "));
  if (q.signedUpWithinDays !== undefined && c.createdAtMs) parts.push(`${L(lang, "joined", "inscrit", "beigetreten")} ${iso(c.createdAtMs)}`);
  if (q.inactiveForDays !== undefined) parts.push(c.lastSignInMs ? `${L(lang, "last seen", "vu", "zuletzt")} ${iso(c.lastSignInMs)}` : L(lang, "never logged in", "jamais connecté", "nie eingeloggt"));
  if (q.nationality && c.nationality) parts.push(c.nationality);
  if ((q.cityOfResidence || q.cityOfBirth) && (c.cityOfResidence || c.cityOfBirth)) parts.push((c.cityOfResidence || c.cityOfBirth) as string);
  return parts.filter(Boolean).slice(0, 4).join(" · ");
}

/** Secondary descriptor line, shown even when the query didn't ask about it. */
function subLine(c: SearchableCandidate, lang: string): string {
  const bits: string[] = [];
  if (c.specialty) bits.push(specialtyLabel(c.specialty, lang));
  if (c.cityOfResidence || c.cityOfBirth) bits.push((c.cityOfResidence || c.cityOfBirth) as string);
  if (c.funnelStage) bits.push(funnelLabel(c.funnelStage));
  else bits.push(b2StageLabel(c.b2Stage, lang));
  return bits.filter(Boolean).slice(0, 3).join(" · ");
}

/** Does candidate c satisfy EVERY constraint present in q? */
function matches(c: SearchableCandidate, q: CandidateQuery, nowMs: number): boolean {
  const within = (ms: number | null, n: number) => ms != null && ms >= nowMs - DAY && ms <= nowMs + n * DAY;
  const pastWithin = (ms: number | null, n: number) => ms != null && ms <= nowMs + DAY && ms >= nowMs - n * DAY;

  if (q.text) {
    const hay = norm([c.name, c.email, c.nationality, c.cityOfBirth, c.cityOfResidence, c.specialty ? specialtyLabel(c.specialty, "en") : "", c.specialty ? specialtyLabel(c.specialty, "de") : "", c.specialty ? specialtyLabel(c.specialty, "fr") : "", ...c.orgNames].join(" "));
    // Match if ALL whitespace-separated terms appear (so "hajar icu" narrows).
    const terms = norm(q.text).split(/\s+/).filter(Boolean);
    if (!terms.every((term) => hay.includes(term))) return false;
  }

  if (q.b2Certified !== undefined) {
    const certified = c.b2Complete === true || c.b2Stage === "passed" || c.hasApprovedB2Cert;
    if (certified !== q.b2Certified) return false;
  }
  if (q.b2CertifiedWithinDays !== undefined) {
    const certified = c.b2Complete === true || c.b2Stage === "passed" || c.hasApprovedB2Cert;
    if (!certified) return false;
    // Needs a known cert date inside the past window (can't prove "within" without one).
    if (!pastWithin(c.b2CertDateMs, q.b2CertifiedWithinDays)) return false;
  }
  if (q.b2Stage && c.b2Stage !== q.b2Stage) return false;
  if (q.b2Failed !== undefined && c.b2Failed !== q.b2Failed) return false;
  if (q.b2ExamWithinDays !== undefined && !within(c.b2ExamMs, q.b2ExamWithinDays)) return false;

  if (q.interviewWithinDays !== undefined) {
    if (!within(c.interview1Ms, q.interviewWithinDays) && !within(c.interview2Ms, q.interviewWithinDays)) return false;
  }
  if (q.hasUpcomingInterview !== undefined) {
    const upcoming = (c.interview1Ms != null && c.interview1Ms >= nowMs - DAY) || (c.interview2Ms != null && c.interview2Ms >= nowMs - DAY);
    if (upcoming !== q.hasUpcomingInterview) return false;
  }
  if (q.interviewPassed !== undefined) {
    const passed = c.interview1Status === "passed" || c.interview2Status === "passed";
    if (passed !== q.interviewPassed) return false;
  }

  if (q.funnelStage && c.funnelStage !== q.funnelStage) return false;
  if (q.visaWithinDays !== undefined && !within(c.visaApptMs, q.visaWithinDays)) return false;

  if (q.specialty && c.specialty !== q.specialty) return false;
  if (q.minYearsExperience !== undefined && !(c.yearsExperience != null && c.yearsExperience >= q.minYearsExperience)) return false;
  if (q.workplacePref && norm(c.workplacePref) !== norm(q.workplacePref)) return false;
  // Availability is a "ready-by" test, NOT a future-only window: someone already
  // available (available_from in the past) is the MOST placeable and must match.
  if (q.availableWithinDays !== undefined && !(c.availableFromMs != null && c.availableFromMs <= nowMs + q.availableWithinDays * DAY)) return false;

  if (q.nationality && !norm(c.nationality).includes(norm(q.nationality))) return false;
  if (q.cityOfBirth && !norm(c.cityOfBirth).includes(norm(q.cityOfBirth))) return false;
  if (q.cityOfResidence && !norm(c.cityOfResidence).includes(norm(q.cityOfResidence))) return false;
  if (q.sex && norm(c.sex).charAt(0) !== q.sex) return false;
  if (q.maritalStatus && !norm(c.maritalStatus).includes(norm(q.maritalStatus))) return false;

  if (q.passportStatus && norm(c.passportStatus) !== norm(q.passportStatus)) return false;
  if (q.passportPending !== undefined) {
    const pending = norm(c.passportStatus) === "pending";
    if (pending !== q.passportPending) return false;
  }
  if (q.passportExpired !== undefined) {
    const expired = c.passportExpiryMs != null && c.passportExpiryMs < nowMs;
    if (expired !== q.passportExpired) return false;
  }
  if (q.passportExpiringWithinDays !== undefined && !within(c.passportExpiryMs, q.passportExpiringWithinDays)) return false;

  if (q.placementReady !== undefined && c.placementReady !== q.placementReady) return false;
  if (q.verified !== undefined && c.verified !== q.verified) return false;
  if (q.hasEmployer !== undefined && c.hasEmployer !== q.hasEmployer) return false;
  if (q.orgName && !c.orgNames.some((o) => norm(o).includes(norm(q.orgName as string)))) return false;

  if (q.signedUpWithinDays !== undefined && !pastWithin(c.createdAtMs, q.signedUpWithinDays)) return false;
  if (q.inactiveForDays !== undefined) {
    const inactive = c.lastSignInMs == null || c.lastSignInMs <= nowMs - q.inactiveForDays * DAY;
    if (!inactive) return false;
  }

  return true;
}

/** Pick a sensible default sort based on which filters are present. */
function sortHits(list: SearchableCandidate[], q: CandidateQuery, nowMs: number): SearchableCandidate[] {
  const byName = (a: SearchableCandidate, b: SearchableCandidate) => a.name.localeCompare(b.name);
  const soonest = (c: SearchableCandidate) => [c.interview1Ms, c.interview2Ms].filter((m): m is number => m != null && m >= nowMs - DAY).sort((a, b) => a - b)[0] ?? Infinity;
  const sortBy = q.sortBy
    ?? (q.interviewWithinDays !== undefined || q.hasUpcomingInterview ? "interview"
      : q.b2CertifiedWithinDays !== undefined ? "b2CertDate"
      : q.signedUpWithinDays !== undefined ? "signup"
      : q.minYearsExperience !== undefined ? "experience"
      : "recent");
  const arr = [...list];
  switch (sortBy) {
    case "name": arr.sort(byName); break;
    case "interview": arr.sort((a, b) => soonest(a) - soonest(b) || byName(a, b)); break;
    case "b2CertDate": arr.sort((a, b) => (b.b2CertDateMs ?? 0) - (a.b2CertDateMs ?? 0) || byName(a, b)); break;
    case "signup": arr.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0) || byName(a, b)); break;
    case "experience": arr.sort((a, b) => (b.yearsExperience ?? -1) - (a.yearsExperience ?? -1) || byName(a, b)); break;
    case "recent":
    default: arr.sort((a, b) => (b.lastSignInMs ?? 0) - (a.lastSignInMs ?? 0) || (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0) || byName(a, b)); break;
  }
  return arr;
}

/**
 * Run a filter over the assembled, already-scoped candidate set. Pure and
 * deterministic: the only rows it can return are rows that were passed in, so a
 * result is ALWAYS a real, in-scope candidate. An empty filter returns everyone
 * (sorted by activity) — "show me everyone" is a valid ask, and it's far better to
 * surface the whole list than to answer a fumbled query with a scary "0 results".
 */
export function compileCandidateQuery(
  q: CandidateQuery,
  candidates: SearchableCandidate[],
  nowMs: number,
  lang: string = "en",
): { hits: SearchHit[]; matched: number; total: number } {
  const empty = isEmptyQuery(q);
  const matchedRows = empty ? candidates.slice() : candidates.filter((c) => matches(c, q, nowMs));
  const sorted = sortHits(matchedRows, q, nowMs);
  const limit = Math.max(1, Math.min(q.limit ?? SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX));
  const hits: SearchHit[] = sorted.slice(0, limit).map((c) => ({
    uid: c.uid,
    name: c.name,
    email: c.email,
    photo: c.photo,
    why: empty ? "" : reasonsFor(c, q, lang, nowMs),
    sub: subLine(c, lang),
    stageColor: b2StageColor(c.b2Stage),
    pendingDocs: c.pendingDocCount,
  }));
  return { hits, matched: matchedRows.length, total: candidates.length };
}

// ─── Human-readable echo of the parsed filter ─────────────────────────────────
// Shown as chips under the bar so the founder can SEE what the AI understood — the
// trust surface. If a chip is wrong he knows to rephrase, instead of doubting the
// results. Localized to the request language.
export function describeQuery(q: CandidateQuery, lang: string): string[] {
  const chips: string[] = [];
  const win = (n: number) => (n === 365 ? L(lang, "last year", "l'an dernier", "letztes Jahr")
    : n === 30 ? L(lang, "last 30 days", "30 derniers jours", "letzte 30 Tage")
    : n === 7 ? L(lang, "last 7 days", "7 derniers jours", "letzte 7 Tage")
    : L(lang, `last ${n} days`, `${n} derniers jours`, `letzte ${n} Tage`));
  const next = (n: number) => (n === 30 ? L(lang, "next 30 days", "30 prochains jours", "nächste 30 Tage")
    : n === 7 ? L(lang, "next 7 days", "7 prochains jours", "nächste 7 Tage")
    : n <= 2 ? L(lang, "next 2 days", "2 prochains jours", "nächste 2 Tage")
    : L(lang, `next ${n} days`, `${n} prochains jours`, `nächste ${n} Tage`));

  if (q.text) chips.push(`"${q.text}"`);
  if (q.b2Certified) chips.push(q.b2CertifiedWithinDays !== undefined ? `${L(lang, "B2 certified", "B2 certifié", "B2 zertifiziert")} (${win(q.b2CertifiedWithinDays)})` : L(lang, "B2 certified", "B2 certifié", "B2 zertifiziert"));
  else if (q.b2CertifiedWithinDays !== undefined) chips.push(`${L(lang, "B2 certified", "B2 certifié", "B2 zertifiziert")} (${win(q.b2CertifiedWithinDays)})`);
  if (q.b2Certified === false) chips.push(L(lang, "not B2 certified", "pas B2 certifié", "nicht B2 zertifiziert"));
  if (q.b2Stage) chips.push(b2StageLabel(q.b2Stage as B2Stage, lang));
  if (q.b2Failed) chips.push(L(lang, "failed B2 once", "a échoué B2", "B2 nicht bestanden"));
  if (q.b2ExamWithinDays !== undefined) chips.push(`${L(lang, "B2 exam", "examen B2", "B2-Prüfung")} · ${next(q.b2ExamWithinDays)}`);
  if (q.interviewWithinDays !== undefined) chips.push(`${L(lang, "interview", "entretien", "Gespräch")} · ${next(q.interviewWithinDays)}`);
  if (q.hasUpcomingInterview) chips.push(L(lang, "upcoming interview", "entretien à venir", "anstehendes Gespräch"));
  if (q.interviewPassed) chips.push(L(lang, "interview passed", "entretien réussi", "Gespräch bestanden"));
  if (q.funnelStage) chips.push(funnelLabel(q.funnelStage));
  if (q.visaWithinDays !== undefined) chips.push(`${L(lang, "visa appt", "RDV visa", "Visumtermin")} · ${next(q.visaWithinDays)}`);
  if (q.specialty) chips.push(specialtyLabel(q.specialty, lang));
  if (q.minYearsExperience !== undefined) chips.push(`≥ ${q.minYearsExperience} ${L(lang, "yrs exp", "ans exp", "J. Erf.")}`);
  if (q.workplacePref) chips.push(workplacePrefLabel(q.workplacePref, lang));
  if (q.availableWithinDays !== undefined) chips.push(`${L(lang, "available", "disponible", "verfügbar")} · ${next(q.availableWithinDays)}`);
  if (q.nationality) chips.push(q.nationality);
  if (q.cityOfBirth) chips.push(`${L(lang, "born in", "né à", "geb. in")} ${q.cityOfBirth}`);
  if (q.cityOfResidence) chips.push(`${L(lang, "lives in", "habite", "wohnt in")} ${q.cityOfResidence}`);
  if (q.sex) chips.push(q.sex === "f" ? L(lang, "female", "femme", "weiblich") : L(lang, "male", "homme", "männlich"));
  if (q.maritalStatus) chips.push(q.maritalStatus);
  if (q.passportPending) chips.push(L(lang, "passport pending", "passeport en attente", "Pass ausstehend"));
  if (q.passportStatus) chips.push(`${L(lang, "passport", "passeport", "Pass")}: ${passportStatusLabel(q.passportStatus, lang)}`);
  if (q.passportExpired) chips.push(L(lang, "passport expired", "passeport expiré", "Pass abgelaufen"));
  if (q.passportExpiringWithinDays !== undefined) chips.push(`${L(lang, "passport expiring", "passeport expire", "Pass läuft ab")} · ${next(q.passportExpiringWithinDays)}`);
  if (q.placementReady) chips.push(L(lang, "placement ready", "prêt au placement", "vermittlungsbereit"));
  if (q.verified) chips.push(L(lang, "verified", "vérifié", "verifiziert"));
  if (q.hasEmployer) chips.push(L(lang, "has employer", "avec employeur", "mit Arbeitgeber"));
  if (q.orgName) chips.push(q.orgName);
  if (q.signedUpWithinDays !== undefined) chips.push(`${L(lang, "joined", "inscrit", "beigetreten")} · ${win(q.signedUpWithinDays)}`);
  if (q.inactiveForDays !== undefined) chips.push(`${L(lang, "inactive", "inactif", "inaktiv")} ≥ ${q.inactiveForDays}${L(lang, "d", "j", "T")}`);
  return chips;
}
