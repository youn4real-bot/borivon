/**
 * Pflege-Fahrplan — the free roadmap for hospitals and care homes (founder,
 * 2026-10-21: "build such a thing for these nurses … a free thing which is
 * actually valuable", modelled on acquisition.com/roadmap).
 *
 * A facility answers a few questions; this turns the answers into
 *   • a Stufe (level 1–5) on the staffing ladder, and
 *   • its own money numbers: what the open posts and the nurses who left cost.
 * Pure on purpose: the page, the PDF, the emails and the tests all use it.
 *
 * The money model is the same as the calculator on borivon.com (one open post =
 * agency/overtime hours + empty beds), so the PDF never contradicts the site.
 */

export type FacilityType = "hospital" | "care_home" | "home_care" | "rehab" | "other";
export type AgencyBand = "none" | "low" | "mid" | "high" | "very_high";
export type ForeignHistory = "never" | "tried_left" | "some_stayed" | "most_stayed";
export type Pain = "open_posts" | "leaving" | "agency" | "paperwork" | "german";
export type Onboarding = "mentor" | "german" | "housing" | "plan" | "checkins";

export type RoadmapAnswers = {
  facilityType: FacilityType;
  /** Nurses (Pflegefachkräfte) working there now. */
  staff: number;
  /** Nurse posts open right now. */
  openPosts: number;
  /** Nurses who left in the last 12 months. */
  leftLastYear: number;
  agency: AgencyBand;
  foreign: ForeignHistory;
  /** What new nurses get in their first 90 days. */
  onboarding: Onboarding[];
  pain: Pain;
};

export type Level = 1 | 2 | 3 | 4 | 5;

export type RoadmapResult = {
  level: Level;
  /** 0–100, higher = healthier. Shown as a thin bar, never as a grade. */
  score: number;
  vacancyRate: number;   // open / (staff + open)
  turnoverRate: number;  // left / staff
  /** € per month the open posts cost right now. */
  openCostMonth: number;
  openCostYear: number;
  /** € per year the nurses who left cost (replacement + gap + onboarding). */
  turnoverCostYear: number;
  /** Everything together, per year. */
  totalYear: number;
  /** € per month ONE nurse who stays brings back (= one open post closed). */
  perNurseMonth: number;
  /** The one thing holding this house back most — drives the plan. */
  bottleneck: "fill" | "keep" | "agency" | "process" | "language";
};

// Same per-post model as the borivon.com calculator.
export const AGENCY_HOURS_PER_POST = 160;
export const AGENCY_RATE = 55;
export const EMPTY_BEDS_PER_POST = 3;
export const REVENUE_PER_BED = 3200;
export const COST_PER_OPEN_POST_MONTH =
  AGENCY_HOURS_PER_POST * AGENCY_RATE + EMPTY_BEDS_PER_POST * REVENUE_PER_BED; // 18.400 €

/**
 * What one nurse leaving costs, built from parts the facility can check:
 * three months covered by agency staff (no bed revenue counted, to stay
 * conservative), onboarding hours that are lost, and finding the next one.
 */
export const DEPARTURE_GAP_MONTHS = 3;
export const ONBOARDING_HOURS = 120;
export const ONBOARDING_RATE = 45;
export const REPLACEMENT_COST = 8000;
export const COST_PER_DEPARTURE =
  DEPARTURE_GAP_MONTHS * AGENCY_HOURS_PER_POST * AGENCY_RATE +
  ONBOARDING_HOURS * ONBOARDING_RATE +
  REPLACEMENT_COST; // 39.800 €

const AGENCY_PENALTY: Record<AgencyBand, number> = { none: 0, low: 6, mid: 14, high: 22, very_high: 30 };
const FOREIGN_POINTS: Record<ForeignHistory, number> = { never: 0, tried_left: -6, some_stayed: 4, most_stayed: 10 };

const clampInt = (n: unknown, lo: number, hi: number): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
};

/** Defensive: whatever the form sends, the numbers stay sane. */
export function normalizeAnswers(a: Partial<RoadmapAnswers>): RoadmapAnswers {
  const types: FacilityType[] = ["hospital", "care_home", "home_care", "rehab", "other"];
  const bands: AgencyBand[] = ["none", "low", "mid", "high", "very_high"];
  const hist: ForeignHistory[] = ["never", "tried_left", "some_stayed", "most_stayed"];
  const pains: Pain[] = ["open_posts", "leaving", "agency", "paperwork", "german"];
  const onb: Onboarding[] = ["mentor", "german", "housing", "plan", "checkins"];
  return {
    facilityType: types.includes(a.facilityType as FacilityType) ? (a.facilityType as FacilityType) : "other",
    staff: clampInt(a.staff, 1, 5000),
    openPosts: clampInt(a.openPosts, 0, 1000),
    leftLastYear: clampInt(a.leftLastYear, 0, 2000),
    agency: bands.includes(a.agency as AgencyBand) ? (a.agency as AgencyBand) : "none",
    foreign: hist.includes(a.foreign as ForeignHistory) ? (a.foreign as ForeignHistory) : "never",
    onboarding: Array.isArray(a.onboarding) ? onb.filter((o) => (a.onboarding as string[]).includes(o)) : [],
    pain: pains.includes(a.pain as Pain) ? (a.pain as Pain) : "open_posts",
  };
}

export function scoreRoadmap(input: Partial<RoadmapAnswers>): RoadmapResult {
  const a = normalizeAnswers(input);
  const vacancyRate = a.openPosts / (a.staff + a.openPosts);
  const turnoverRate = a.leftLastYear / a.staff;

  // Start at 100 and take off for what hurts. Each part is capped so one bad
  // number cannot hide everything else.
  let score = 100;
  score -= Math.min(40, vacancyRate * 220);        // 10 % open ≈ -22
  score -= Math.min(30, turnoverRate * 120);       // 15 % leaving ≈ -18
  score -= AGENCY_PENALTY[a.agency];
  score += FOREIGN_POINTS[a.foreign];
  score += a.onboarding.length * 2;                // a real first-90-days plan helps
  score = Math.round(Math.min(100, Math.max(0, score)));

  const level: Level = score >= 82 ? 5 : score >= 66 ? 4 : score >= 48 ? 3 : score >= 30 ? 2 : 1;

  const openCostMonth = a.openPosts * COST_PER_OPEN_POST_MONTH;
  const openCostYear = openCostMonth * 12;
  const turnoverCostYear = a.leftLastYear * COST_PER_DEPARTURE;

  // Biggest lever first: what the numbers say, then what they told us hurts.
  const fillWeight = vacancyRate * 220;
  const keepWeight = turnoverRate * 120 + (a.foreign === "tried_left" ? 10 : 0);
  const agencyWeight = AGENCY_PENALTY[a.agency];
  let bottleneck: RoadmapResult["bottleneck"] =
    keepWeight >= fillWeight && keepWeight >= agencyWeight ? "keep"
    : agencyWeight > fillWeight ? "agency" : "fill";
  if (Math.max(fillWeight, keepWeight, agencyWeight) < 8) {
    bottleneck = a.pain === "paperwork" ? "process" : a.pain === "german" ? "language" : a.pain === "leaving" ? "keep" : a.pain === "agency" ? "agency" : "fill";
  }

  return {
    level, score, vacancyRate, turnoverRate,
    openCostMonth, openCostYear, turnoverCostYear,
    totalYear: openCostYear + turnoverCostYear,
    perNurseMonth: COST_PER_OPEN_POST_MONTH,
    bottleneck,
  };
}
