/**
 * Shared bits for the Fahrplan lead's state machine, kept in leads.details:
 *   consent.confirmedAt   set by the confirm link (double opt-in)
 *   seq.step / lastSentAt how many follow-ups went out
 *   unsubscribedAt        set by the unsubscribe link — stops everything
 */
import { FOLLOWUP_DAYS } from "./emails";

export type RoadmapDetails = {
  source?: string;
  lang?: string;
  firstName?: string;
  facility?: string;
  result?: { level?: number; bottleneck?: string; openCostMonth?: number; totalYear?: number };
  consent?: { tipsAsked?: boolean; confirmedAt?: string | null };
  seq?: { step?: number; lastSentAt?: string | null };
  unsubscribedAt?: string | null;
  /** last state written to the Resend list (daily job) */
  list?: { state?: "subscribed" | "unsubscribed"; at?: string };
  /** set when the 12-month retention wiped the personal data */
  anonymizedAt?: string;
  [k: string]: unknown;
};

export function parseDetails(v: unknown): RoadmapDetails {
  if (v && typeof v === "object") return v as RoadmapDetails;
  if (typeof v === "string") { try { const o = JSON.parse(v); return o && typeof o === "object" ? o : {}; } catch { return {}; } }
  return {};
}

/** Which follow-up (0-based) is due now, or null. Pure → tested. */
export function dueFollowup(d: RoadmapDetails, now: Date): number | null {
  if (d.unsubscribedAt) return null;
  if (!d.consent?.tipsAsked || !d.consent?.confirmedAt) return null;
  const step = Math.max(0, Number(d.seq?.step ?? 0));
  if (step >= FOLLOWUP_DAYS.length) return null;
  const confirmed = Date.parse(d.consent.confirmedAt);
  if (!Number.isFinite(confirmed)) return null;
  const dueAt = confirmed + FOLLOWUP_DAYS[step] * 86_400_000;
  if (now.getTime() < dueAt) return null;
  // Never two in a row: at least a day since the last one, whatever happened.
  const last = d.seq?.lastSentAt ? Date.parse(d.seq.lastSentAt) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < 20 * 3_600_000) return null;
  return step;
}

// ── the Resend email list (lib/roadmap/resendList.ts) ────────────────────────
export type ListState = "subscribed" | "unsubscribed";

/** Where this lead SHOULD be on the list: subscribed only after the double opt-in. */
export function wantedListState(d: RoadmapDetails): ListState {
  return d.consent?.tipsAsked && d.consent?.confirmedAt && !d.unsubscribedAt ? "subscribed" : "unsubscribed";
}

/** True when the list does not (provably) match the lead yet: the daily job then syncs it. */
export function needsListSync(d: RoadmapDetails): boolean {
  if (d.anonymizedAt) return false;
  const list = d.list as { state?: string } | undefined;
  return list?.state !== wantedListState(d);
}

// ── retention (privacy policy section 11: like contact-form data, 12 months) ─
export const RETENTION_DAYS = 365;

/** Last time this lead did anything: submitted, confirmed, got a mail, unsubscribed. */
export function lastActivity(d: RoadmapDetails, createdAt: string): number {
  const ts = [createdAt, d.consent?.confirmedAt, d.seq?.lastSentAt, d.unsubscribedAt]
    .map((x) => (x ? Date.parse(String(x)) : NaN))
    .filter(Number.isFinite);
  return ts.length ? Math.max(...ts) : NaN;
}

/** Older than RETENTION_DAYS since the last activity, and not anonymized yet. */
export function isExpired(d: RoadmapDetails, createdAt: string, now: Date): boolean {
  if (d.anonymizedAt) return false;
  const last = lastActivity(d, createdAt);
  return Number.isFinite(last) && now.getTime() - last > RETENTION_DAYS * 86_400_000;
}

/**
 * What stays after anonymizing: the numbers (level, answers) for statistics,
 * nothing that points to a person or a house.
 */
export function anonymizedDetails(d: RoadmapDetails, now: Date): RoadmapDetails {
  return {
    source: d.source, lang: d.lang,
    answers: d.answers, result: d.result,
    anonymizedAt: now.toISOString(),
  };
}
