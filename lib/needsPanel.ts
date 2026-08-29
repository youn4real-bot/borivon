/**
 * "NEEDS YOU" — the proactive triage the founder asked for: stop searching and
 * guessing; the portal computes what needs attention and shows it the moment he
 * opens the dashboard.
 *
 * Pure + deterministic: it runs over the already-scoped candidate set
 * (assembleSearchableCandidates → SearchableCandidate[]), so every item is a real,
 * in-scope candidate (LAW #25) and the whole thing is unit-testable without a DB.
 * Each group is a distinct ACTION lens; a candidate can legitimately appear in more
 * than one (e.g. pending review AND going cold).
 */
import type { SearchableCandidate } from "@/lib/candidateSearch";

const DAY = 86_400_000;
const GROUP_CAP = 25;

// Windows.
const PASSPORT_SOON_DAYS = 180;
const B2_EXAM_SOON_DAYS = 30;
const DATE_SOON_DAYS = 14;
const COLD_QUIET_DAYS = 14;
const NEWSTUCK_MIN_AGE_DAYS = 3;
const NEWSTUCK_QUIET_DAYS = 7;

// Funnel stages where a candidate is WAITING (the drop-out danger zone). Mirrors
// lib/batchBoard FUNNEL_STAGES.waiting — kept local so this stays a pure module.
const WAITING_STAGES = new Set(["waiting_2nd"]);

export type NeedTone = "red" | "orange" | "gold" | "blue" | "neutral";
export type NeedItem = { uid: string; name: string; detail: string };
export type NeedGroup = { key: string; label: string; tone: NeedTone; items: NeedItem[]; overflow: number };
export type NeedsResult = { groups: NeedGroup[]; total: number };

type Lang = string;
function L(lang: Lang, en: string, fr: string, de: string): string {
  return lang === "fr" ? fr : lang === "de" ? de : en;
}
const iso = (ms: number | null) => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10));
const daysAgo = (ms: number, now: number) => Math.max(0, Math.round((now - ms) / DAY));

type Row = { uid: string; name: string; detail: string; sort: number };

/**
 * Compute the attention groups from a scoped candidate set. `sort` on each row is
 * ascending = more urgent first (earlier date / more pending / quieter).
 */
export function computeNeeds(candidates: SearchableCandidate[], nowMs: number, lang: Lang = "en"): NeedsResult {
  const review: Row[] = [];
  const passport: Row[] = [];
  const dates: Row[] = [];
  const b2: Row[] = [];
  const cold: Row[] = [];
  const newstuck: Row[] = [];

  for (const c of candidates) {
    // 1. Documents waiting for the admin's review.
    if (c.pendingDocCount > 0) {
      review.push({ uid: c.uid, name: c.name, sort: -c.pendingDocCount, detail: L(lang, `${c.pendingDocCount} to review`, `${c.pendingDocCount} à vérifier`, `${c.pendingDocCount} zu prüfen`) });
    }
    // 2. Passport expired (past) or expiring within the window.
    if (c.passportExpiryMs != null) {
      if (c.passportExpiryMs < nowMs) {
        passport.push({ uid: c.uid, name: c.name, sort: c.passportExpiryMs, detail: `${L(lang, "expired", "expiré", "abgelaufen")} ${iso(c.passportExpiryMs)}` });
      } else if (c.passportExpiryMs <= nowMs + PASSPORT_SOON_DAYS * DAY) {
        passport.push({ uid: c.uid, name: c.name, sort: c.passportExpiryMs, detail: `${L(lang, "expires", "expire", "läuft ab")} ${iso(c.passportExpiryMs)}` });
      }
    }
    // 3. Interview / visa within the near window.
    const soon = [
      { ms: c.interview1Ms, kind: L(lang, "interview", "entretien", "Gespräch") },
      { ms: c.interview2Ms, kind: L(lang, "interview", "entretien", "Gespräch") },
      { ms: c.visaApptMs, kind: L(lang, "visa", "visa", "Visum") },
    ].filter((d): d is { ms: number; kind: string } => d.ms != null && d.ms >= nowMs - DAY && d.ms <= nowMs + DATE_SOON_DAYS * DAY)
      .sort((a, b) => a.ms - b.ms)[0];
    if (soon) dates.push({ uid: c.uid, name: c.name, sort: soon.ms, detail: `${soon.kind} ${iso(soon.ms)}` });
    // 4. B2: sat the exam and awaiting results (follow up), or an exam scheduled
    // soon — read from the real cv_draft German panel, not the dead b2_stage.
    if (c.b2Result === "waiting" || c.b2Stage === "awaiting_results") {
      b2.push({ uid: c.uid, name: c.name, sort: Number.MIN_SAFE_INTEGER, detail: L(lang, "awaiting B2 results", "résultats B2 attendus", "B2-Ergebnisse ausstehend") });
    } else {
      const examMs = c.b2ExamMs ?? c.b2PlannedMs;
      if (examMs != null && examMs >= nowMs - 31 * DAY && examMs <= nowMs + B2_EXAM_SOON_DAYS * DAY) {
        b2.push({ uid: c.uid, name: c.name, sort: examMs, detail: `${L(lang, "B2 exam", "examen B2", "B2-Prüfung")} ${iso(examMs)}` });
      }
    }
    // 5. Going cold — waiting between interviews, no login/touch in the window.
    if (c.funnelStage && WAITING_STAGES.has(c.funnelStage)) {
      const quietLogin = c.lastSignInMs == null || c.lastSignInMs <= nowMs - COLD_QUIET_DAYS * DAY;
      const notTouched = c.lastTouchMs == null || c.lastTouchMs <= nowMs - COLD_QUIET_DAYS * DAY;
      if (quietLogin && notTouched) {
        const d = c.lastSignInMs == null ? Number.MAX_SAFE_INTEGER : daysAgo(c.lastSignInMs, nowMs);
        cold.push({
          uid: c.uid, name: c.name, sort: -d,
          detail: c.lastSignInMs == null
            ? L(lang, "never logged in", "jamais connecté", "nie eingeloggt")
            : L(lang, `quiet ${d}d`, `silence ${d}j`, `still ${d}T`),
        });
      }
    }
    // 6. Signed up but never got going — old account, no stage, nothing pending.
    if (
      c.createdAtMs != null && c.createdAtMs <= nowMs - NEWSTUCK_MIN_AGE_DAYS * DAY &&
      (!c.funnelStage || c.funnelStage === "funneling") &&
      c.pendingDocCount === 0 && !c.hasApprovedB2Cert &&
      (c.lastSignInMs == null || c.lastSignInMs <= nowMs - NEWSTUCK_QUIET_DAYS * DAY)
    ) {
      const d = daysAgo(c.createdAtMs, nowMs);
      newstuck.push({ uid: c.uid, name: c.name, sort: -d, detail: L(lang, `joined ${d}d ago`, `inscrit il y a ${d}j`, `vor ${d}T beigetreten`) });
    }
  }

  const mk = (key: string, label: string, tone: NeedTone, rows: Row[]): NeedGroup => {
    rows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    return {
      key, label, tone,
      items: rows.slice(0, GROUP_CAP).map(({ uid, name, detail }) => ({ uid, name, detail })),
      overflow: Math.max(0, rows.length - GROUP_CAP),
    };
  };

  const groups: NeedGroup[] = [];
  if (review.length) groups.push(mk("review", L(lang, "Waiting for your review", "En attente de votre revue", "Wartet auf Ihre Prüfung"), "orange", review));
  if (passport.length) groups.push(mk("passport", L(lang, "Passport expired / expiring", "Passeport expiré / bientôt", "Pass abgelaufen / bald"), "red", passport));
  if (dates.length) groups.push(mk("dates", L(lang, "Interview / visa coming up", "Entretien / visa à venir", "Gespräch / Visum bald"), "blue", dates));
  if (b2.length) groups.push(mk("b2", L(lang, "B2 exam due / results", "Examen B2 / résultats", "B2-Prüfung / Ergebnisse"), "gold", b2));
  if (cold.length) groups.push(mk("cold", L(lang, "Going cold — re-engage", "Se refroidit — relancer", "Wird kalt — nachfassen"), "orange", cold));
  if (newstuck.length) groups.push(mk("newstuck", L(lang, "Signed up, never got going", "Inscrit, jamais démarré", "Angemeldet, nie gestartet"), "neutral", newstuck));

  const total = groups.reduce((n, g) => n + g.items.length + g.overflow, 0);
  return { groups, total };
}
