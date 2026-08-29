/**
 * ADVANCED FILTERS — a deterministic, Booking.com-style faceted filter over the
 * scoped candidate set. NO AI: the founder ticks facets, code returns the real
 * candidates. Multi-select within a group is OR; across groups is AND. Each option
 * carries a LIVE COUNT (how many you'd get with it, given the other groups) — the
 * Booking.com hallmark.
 *
 * Pure over SearchableCandidate[] (from assembleSearchableCandidates → already
 * org-scoped, LAW #25), so the whole catalog + counting is unit-testable with no DB.
 */
import { b2StageColor, b2StageLabel } from "@/lib/b2Journey";
import { specialtyLabel, NURSE_SPECIALTIES } from "@/lib/nurseSpecialties";
import { funnelLabel, FUNNEL_STAGES } from "@/lib/batchBoard";
import { norm, hasFullB2Cert, type SearchableCandidate, type SearchHit } from "@/lib/candidateSearch";
import { nationalityKey, countryLabel } from "@/lib/nationality";

const DAY = 86_400_000;
const RESULT_LIMIT = 150;

function L(lang: string, en: string, fr: string, de: string): string {
  return lang === "fr" ? fr : lang === "de" ? de : en;
}
const interviewWithin = (c: SearchableCandidate, now: number, n: number) =>
  [c.interview1Ms, c.interview2Ms].some((m) => m != null && m >= now - DAY && m <= now + n * DAY);

type Pred = (c: SearchableCandidate, now: number) => boolean;
type OptDef = { key: string; label: (lang: string) => string; test: Pred };
type GroupDef = { key: string; label: (lang: string) => string; options: OptDef[] };

// ─── Fixed facet catalog ──────────────────────────────────────────────────────
const FIXED_GROUPS: GroupDef[] = [
  {
    key: "b2", label: (l) => L(l, "B2 German", "B2 allemand", "B2 Deutsch"),
    options: [
      // Certificate / result (from the cv_draft German panel — the real source).
      { key: "full_cert", label: (l) => L(l, "Has full certificate", "Certificat complet", "Vollständiges Zertifikat"), test: (c) => hasFullB2Cert(c) },
      { key: "cert_got", label: (l) => L(l, "Certificate in hand", "Certificat en main", "Zertifikat erhalten"), test: (c) => c.b2CertStatus === "got" },
      { key: "cert_waiting", label: (l) => L(l, "Certificate awaited", "Certificat en attente", "Zertifikat ausstehend"), test: (c) => c.b2CertStatus === "waiting" },
      { key: "partial", label: (l) => L(l, "Partial pass (retaking)", "Réussite partielle (reprise)", "Teilbestanden (Wiederholung)"), test: (c) => c.b2Result === "partial" || (c.b2Failed && !hasFullB2Cert(c)) },
      { key: "awaiting", label: (l) => L(l, "Awaiting results", "Résultats en attente", "Ergebnisse ausstehend"), test: (c) => c.b2Result === "waiting" || c.b2Stage === "awaiting_results" },
      { key: "failed", label: (l) => L(l, "Failed (retaking)", "Échoué (reprise)", "Nicht bestanden (Wdh.)"), test: (c) => c.b2Result === "failed" || c.b2Failed === true },
      // Upcoming exam.
      { key: "scheduled", label: (l) => L(l, "Exam scheduled", "Examen prévu", "Prüfung angesetzt"), test: (c) => c.b2Planned },
      { key: "exam_soon", label: (l) => L(l, "Exam within ~6 weeks", "Examen sous ~6 sem.", "Prüfung in ~6 Wochen"), test: (c, now) => c.b2PlannedMs != null && c.b2PlannedMs >= now - 31 * DAY && c.b2PlannedMs <= now + 45 * DAY },
      // German level reached.
      { key: "level_b2", label: (l) => L(l, "Reached level B2", "Niveau B2 atteint", "Niveau B2 erreicht"), test: (c) => c.germanLevel === "B2" },
      { key: "level_b1", label: (l) => L(l, "Reached level B1", "Niveau B1 atteint", "Niveau B1 erreicht"), test: (c) => c.germanLevel === "B1" },
      // Exam body.
      { key: "telc", label: () => "telc", test: (c) => c.b2ExamType === "telc" },
      { key: "goethe", label: () => "Goethe", test: (c) => c.b2ExamType === "goethe" },
      { key: "oesd", label: () => "ÖSD", test: (c) => c.b2ExamType === "oesd" },
    ],
  },
  {
    key: "docs", label: (l) => L(l, "Documents", "Documents", "Dokumente"),
    options: [
      { key: "none", label: (l) => L(l, "Nothing uploaded yet", "Rien de téléversé", "Noch nichts hochgeladen"), test: (c) => c.docTotal === 0 },
      { key: "missing", label: (l) => L(l, "Missing required docs", "Documents requis manquants", "Pflichtdokumente fehlen"), test: (c) => c.missingRequired > 0 },
      { key: "pending", label: (l) => L(l, "Waiting for review", "En attente de revue", "Wartet auf Prüfung"), test: (c) => c.pendingDocCount > 0 },
      { key: "rejected", label: (l) => L(l, "Has rejected docs", "Documents rejetés", "Abgelehnte Dokumente"), test: (c) => c.rejectedDocs > 0 },
      { key: "complete", label: (l) => L(l, "All required complete", "Tous les requis complets", "Alle Pflichtdok. vollständig"), test: (c) => c.checklistPct === 100 },
    ],
  },
  {
    key: "passport", label: (l) => L(l, "Passport", "Passeport", "Reisepass"),
    options: [
      { key: "none", label: (l) => L(l, "None on file", "Aucun au dossier", "Keiner hinterlegt"), test: (c) => c.passportExpiryMs == null && !c.passportStatus },
      { key: "expired", label: (l) => L(l, "Expired", "Expiré", "Abgelaufen"), test: (c, now) => c.passportExpiryMs != null && c.passportExpiryMs < now },
      { key: "expiring", label: (l) => L(l, "Expiring ≤6 months", "Expire ≤6 mois", "Läuft ≤6 Monate ab"), test: (c, now) => c.passportExpiryMs != null && c.passportExpiryMs >= now && c.passportExpiryMs <= now + 180 * DAY },
      { key: "valid", label: (l) => L(l, "Valid > 6 months", "Valide > 6 mois", "Gültig > 6 Monate"), test: (c, now) => c.passportExpiryMs != null && c.passportExpiryMs > now + 180 * DAY },
      { key: "pending", label: (l) => L(l, "Pending review", "En attente de revue", "Prüfung ausstehend"), test: (c) => norm(c.passportStatus) === "pending" },
      { key: "approved", label: (l) => L(l, "Approved", "Approuvé", "Genehmigt"), test: (c) => norm(c.passportStatus) === "approved" },
      { key: "rejected", label: (l) => L(l, "Rejected", "Rejeté", "Abgelehnt"), test: (c) => norm(c.passportStatus) === "rejected" },
    ],
  },
  {
    key: "stage", label: (l) => L(l, "Pipeline stage", "Étape du pipeline", "Pipeline-Phase"),
    options: FUNNEL_STAGES.map((s) => ({ key: s.key, label: () => funnelLabel(s.key), test: (c: SearchableCandidate) => c.funnelStage === s.key })),
  },
  {
    key: "dates", label: (l) => L(l, "Coming up", "À venir", "Bald fällig"),
    options: [
      { key: "interview_7d", label: (l) => L(l, "Interview ≤7 days", "Entretien ≤7 jours", "Gespräch ≤7 Tage"), test: (c, now) => interviewWithin(c, now, 7) },
      { key: "interview_30d", label: (l) => L(l, "Interview ≤30 days", "Entretien ≤30 jours", "Gespräch ≤30 Tage"), test: (c, now) => interviewWithin(c, now, 30) },
      { key: "visa_30d", label: (l) => L(l, "Visa appt ≤30 days", "RDV visa ≤30 jours", "Visumtermin ≤30 Tage"), test: (c, now) => c.visaApptMs != null && c.visaApptMs >= now - DAY && c.visaApptMs <= now + 30 * DAY },
      { key: "flight", label: (l) => L(l, "Flight booked", "Vol réservé", "Flug gebucht"), test: (c, now) => c.flightMs != null && c.flightMs >= now - DAY },
    ],
  },
  {
    key: "specialty", label: (l) => L(l, "Specialty", "Spécialité", "Fachbereich"),
    options: NURSE_SPECIALTIES.map((s) => ({ key: s.key, label: (l: string) => specialtyLabel(s.key, l), test: (c: SearchableCandidate) => c.specialty === s.key })),
  },
  {
    key: "experience", label: (l) => L(l, "Experience", "Expérience", "Erfahrung"),
    options: [
      { key: "exp_0", label: (l) => L(l, "< 1 year / none", "< 1 an / aucune", "< 1 Jahr / keine"), test: (c) => c.yearsExperience == null || c.yearsExperience < 1 },
      { key: "exp_1_2", label: () => "1–2", test: (c) => c.yearsExperience != null && c.yearsExperience >= 1 && c.yearsExperience <= 2 },
      { key: "exp_3_4", label: () => "3–4", test: (c) => c.yearsExperience != null && c.yearsExperience >= 3 && c.yearsExperience <= 4 },
      { key: "exp_5_9", label: () => "5–9", test: (c) => c.yearsExperience != null && c.yearsExperience >= 5 && c.yearsExperience <= 9 },
      { key: "exp_10", label: () => "10+", test: (c) => c.yearsExperience != null && c.yearsExperience >= 10 },
    ],
  },
  {
    key: "workplace", label: (l) => L(l, "Workplace", "Lieu de travail", "Arbeitsplatz"),
    options: [
      { key: "altenheim", label: (l) => L(l, "Nursing home", "Maison de retraite", "Altenheim"), test: (c) => norm(c.workplacePref) === "altenheim" },
      { key: "klinik", label: (l) => L(l, "Clinic", "Clinique", "Klinik"), test: (c) => norm(c.workplacePref) === "klinik" },
      { key: "either", label: (l) => L(l, "Either", "Les deux", "Egal"), test: (c) => norm(c.workplacePref) === "either" },
    ],
  },
  {
    key: "sex", label: (l) => L(l, "Sex", "Sexe", "Geschlecht"),
    options: [
      { key: "f", label: (l) => L(l, "Female", "Femme", "Weiblich"), test: (c) => norm(c.sex).charAt(0) === "f" },
      { key: "m", label: (l) => L(l, "Male", "Homme", "Männlich"), test: (c) => norm(c.sex).charAt(0) === "m" },
    ],
  },
  {
    key: "flags", label: (l) => L(l, "Status", "Statut", "Status"),
    options: [
      { key: "placement_ready", label: (l) => L(l, "Placement ready", "Prêt au placement", "Vermittlungsbereit"), test: (c) => c.placementReady },
      { key: "verified", label: (l) => L(l, "Verified", "Vérifié", "Verifiziert"), test: (c) => c.verified },
      { key: "has_employer", label: (l) => L(l, "Has employer", "Avec employeur", "Mit Arbeitgeber"), test: (c) => c.hasEmployer },
    ],
  },
  {
    key: "activity", label: (l) => L(l, "Activity", "Activité", "Aktivität"),
    options: [
      { key: "cold", label: (l) => L(l, "Going cold (waiting, quiet)", "Se refroidit", "Wird kalt"), test: (c, now) => c.funnelStage === "waiting_2nd" && (c.lastSignInMs == null || c.lastSignInMs <= now - 14 * DAY) && (c.lastTouchMs == null || c.lastTouchMs <= now - 14 * DAY) },
      { key: "new_14d", label: (l) => L(l, "New (≤14 days)", "Nouveau (≤14 jours)", "Neu (≤14 Tage)"), test: (c, now) => c.createdAtMs != null && c.createdAtMs >= now - 14 * DAY },
      { key: "inactive_30d", label: (l) => L(l, "Inactive ≥30 days", "Inactif ≥30 jours", "Inaktiv ≥30 Tage"), test: (c, now) => c.lastSignInMs == null || c.lastSignInMs <= now - 30 * DAY },
    ],
  },
];

// ─── Dynamic (data-driven) groups ─────────────────────────────────────────────
// High-cardinality free-text fields become checkbox lists built from the actual
// values present, most-common first, capped.
function dynamicGroup(key: string, label: (lang: string) => string, get: (c: SearchableCandidate) => string | null, candidates: SearchableCandidate[], cap = 40): GroupDef {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const v = (get(c) ?? "").toString().trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const options: OptDef[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([v]) => ({ key: v, label: () => v, test: (c: SearchableCandidate) => norm(get(c)) === norm(v) }));
  return { key, label, options };
}

/** Nationality group — merges spelling/language variants into one country and
 *  labels it as the country name in the UI language (Morocco / Maroc / Marokko). */
function nationalityGroup(candidates: SearchableCandidate[], lang: string, cap = 40): GroupDef {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const key = nationalityKey(c.nationality);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const options: OptDef[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([key]) => ({ key, label: (l: string) => countryLabel(key, l), test: (c: SearchableCandidate) => nationalityKey(c.nationality) === key }));
  return { key: "nationality", label: (l) => L(l, "Nationality", "Nationalité", "Staatsangeh."), options };
}

// ─── Output types ─────────────────────────────────────────────────────────────
export type FacetOptionOut = { key: string; label: string; count: number; selected: boolean };
export type FacetGroupOut = { key: string; label: string; options: FacetOptionOut[] };
export type FacetSelection = Record<string, string[]>;
export type FacetResult = { groups: FacetGroupOut[]; results: SearchHit[]; total: number; shown: number };

/** Short, localized B2 status for a result card — reads the REAL cv_draft signal,
 *  never the dead b2_stage. "" when there's no German data. */
function b2Chip(c: SearchableCandidate, lang: string): string {
  const lvl = c.germanLevel && c.germanLevel !== "B2" ? `${c.germanLevel} ` : "";
  if (hasFullB2Cert(c)) return `${c.germanLevel ?? "B2"} ✓`;
  if (c.b2Result === "partial") return `${lvl}${L(lang, "B2 partial", "B2 partiel", "B2 teilbestanden")}`;
  if (c.b2Result === "waiting") return `${lvl}${L(lang, "B2 awaiting", "B2 en attente", "B2 wartet")}`;
  if (c.b2Result === "failed") return `${lvl}${L(lang, "B2 retaking", "B2 reprise", "B2 Wdh.")}`;
  if (c.b2Planned) return L(lang, "B2 exam set", "examen B2 prévu", "B2-Prüfung geplant");
  return c.germanLevel ?? "";
}

function toHit(c: SearchableCandidate, lang: string): SearchHit {
  const bits: string[] = [];
  if (c.specialty) bits.push(specialtyLabel(c.specialty, lang));
  const city = c.cityOfResidence || c.cityOfBirth;
  if (city) bits.push(city);
  const b2 = b2Chip(c, lang);
  bits.push(b2 || (c.funnelStage ? funnelLabel(c.funnelStage) : b2StageLabel(c.b2Stage, lang)));
  return {
    uid: c.uid, name: c.name, email: c.email, photo: c.photo, why: "",
    sub: bits.filter(Boolean).slice(0, 3).join(" · "),
    stageColor: b2StageColor(c.b2Stage), pendingDocs: c.pendingDocCount,
  };
}

/**
 * Build the full facet catalog (with live counts) AND the filtered candidate list
 * for the given selection. Counts on each option reflect what you'd get WITH that
 * option, holding the OTHER groups' selections fixed (Booking.com behaviour).
 */
export function buildFacets(candidates: SearchableCandidate[], selected: FacetSelection, now: number, lang = "en"): FacetResult {
  const groups: GroupDef[] = [
    ...FIXED_GROUPS,
    nationalityGroup(candidates, lang),
    dynamicGroup("cityRes", (l) => L(l, "City of residence", "Ville de résidence", "Wohnort"), (c) => c.cityOfResidence, candidates),
    dynamicGroup("cityBirth", (l) => L(l, "City of birth", "Ville de naissance", "Geburtsort"), (c) => c.cityOfBirth, candidates),
    dynamicGroup("marital", (l) => L(l, "Marital status", "État civil", "Familienstand"), (c) => c.maritalStatus, candidates),
    dynamicGroup("org", (l) => L(l, "Agency / org", "Agence / org", "Agentur / Org"), (c) => (c.orgNames[0] ?? null), candidates),
  ];

  // Flat predicate lookup: predOf[groupKey][optKey].
  const predOf: Record<string, Record<string, Pred>> = {};
  for (const g of groups) {
    predOf[g.key] = {};
    for (const o of g.options) predOf[g.key][o.key] = o.test;
  }
  // Only groups that actually have a selection constrain anything.
  const activeGroupKeys = Object.keys(selected).filter((gk) => (selected[gk]?.length ?? 0) > 0 && predOf[gk]);

  // Per candidate: which active groups does it FAIL (selected, but no selected option matches)?
  const failedOf = new Map<SearchableCandidate, Set<string>>();
  for (const c of candidates) {
    const failed = new Set<string>();
    for (const gk of activeGroupKeys) {
      const opts = selected[gk];
      const ok = opts.some((okKey) => predOf[gk][okKey]?.(c, now));
      if (!ok) failed.add(gk);
    }
    failedOf.set(c, failed);
  }

  // Results: candidates that fail no active group.
  const matched = candidates.filter((c) => (failedOf.get(c)?.size ?? 0) === 0);

  // Counts: option O of group G counts a candidate that passes every OTHER active
  // group (fails nothing, or fails only G) AND matches O.
  const groupsOut: FacetGroupOut[] = groups.map((g) => {
    const sel = new Set(selected[g.key] ?? []);
    const options: FacetOptionOut[] = g.options.map((o) => {
      let count = 0;
      for (const c of candidates) {
        const failed = failedOf.get(c)!;
        const passesOthers = failed.size === 0 || (failed.size === 1 && failed.has(g.key));
        if (passesOthers && o.test(c, now)) count++;
      }
      return { key: o.key, label: o.label(lang), count, selected: sel.has(o.key) };
    }).filter((o) => o.count > 0 || o.selected); // hide options nothing matches (keep selected ones visible)
    return { key: g.key, label: g.label(lang), options };
  }).filter((g) => g.options.length > 0);

  const sorted = [...matched].sort((a, b) => (b.lastSignInMs ?? 0) - (a.lastSignInMs ?? 0) || a.name.localeCompare(b.name));
  return {
    groups: groupsOut,
    results: sorted.slice(0, RESULT_LIMIT).map((c) => toHit(c, lang)),
    total: matched.length,
    shown: Math.min(matched.length, RESULT_LIMIT),
  };
}

/** Sanitize an untrusted selection: keep only string arrays of reasonable size. */
export function sanitizeSelection(raw: unknown): FacetSelection {
  if (!raw || typeof raw !== "object") return {};
  const out: FacetSelection = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length > 40) continue;
    if (!Array.isArray(v)) continue;
    const opts = v.filter((x): x is string => typeof x === "string" && x.length <= 80).slice(0, 60);
    if (opts.length) out[k] = opts;
  }
  return out;
}
