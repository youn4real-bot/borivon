/**
 * Shared bits for the Fahrplan lead's state machine, kept in leads.details.
 * Since 2026-11-07 (founder): one consent box + double opt-in for everything.
 *
 *   consent.givenAt/text/ip  the ticked box, word for word (proof, Art. 7(1) GDPR)
 *   consent.confirmedAt      the POST on the confirm page (double opt-in)
 *   delivery.sentAt          the PDF mail went out (only after confirmedAt)
 *   seq.step / lastSentAt    how many follow-ups went out
 *   unsubscribedAt           set by the unsubscribe link: stops everything
 */
import { FOLLOWUP_DAYS } from "./emails";

export type RoadmapDetails = {
  source?: string;
  lang?: string;
  salutation?: string;
  lastName?: string;
  facility?: string;
  result?: { level?: number; bottleneck?: string; openCostMonth?: number; totalYear?: number };
  consent?: { text?: string; givenAt?: string; ip?: string; confirmedAt?: string | null; confirmIp?: string };
  delivery?: { sentAt?: string | null; attempts?: number; lastAttemptAt?: string | null };
  seq?: { step?: number; lastSentAt?: string | null };
  unsubscribedAt?: string | null;
  /** last state written to the Resend list (daily job) */
  list?: { state?: "subscribed" | "unsubscribed"; at?: string };
  /** set when the retention wiped the personal data */
  anonymizedAt?: string;
  [k: string]: unknown;
};

export function parseDetails(v: unknown): RoadmapDetails {
  if (v && typeof v === "object") return v as RoadmapDetails;
  if (typeof v === "string") { try { const o = JSON.parse(v); return o && typeof o === "object" ? o : {}; } catch { return {}; } }
  return {};
}

const confirmed = (d: RoadmapDetails) => !!d.consent?.confirmedAt && Number.isFinite(Date.parse(String(d.consent.confirmedAt)));

// ── the PDF (after the confirm click) ────────────────────────────────────────
export const MAX_DELIVERY_ATTEMPTS = 3;
const RETRY_AFTER_MS = 30 * 60_000;

/** Confirmed, PDF not out yet, and worth another try now (the daily job). */
export function deliveryDue(d: RoadmapDetails, now: Date): boolean {
  if (d.anonymizedAt || d.unsubscribedAt || !confirmed(d) || d.delivery?.sentAt) return false;
  if (Number(d.delivery?.attempts ?? 0) >= MAX_DELIVERY_ATTEMPTS) return false;
  const last = d.delivery?.lastAttemptAt ? Date.parse(d.delivery.lastAttemptAt) : NaN;
  return !Number.isFinite(last) || now.getTime() - last >= RETRY_AFTER_MS;
}

/** Which follow-up (0-based) is due now, or null. Pure → tested. */
export function dueFollowup(d: RoadmapDetails, now: Date): number | null {
  if (d.unsubscribedAt || !confirmed(d) || !d.delivery?.sentAt) return null;
  const step = Math.max(0, Number(d.seq?.step ?? 0));
  if (step >= FOLLOWUP_DAYS.length) return null;
  const dueAt = Date.parse(String(d.consent!.confirmedAt)) + FOLLOWUP_DAYS[step] * 86_400_000;
  if (now.getTime() < dueAt) return null;
  // Never two in a row: at least a day since the last one, whatever happened.
  const last = d.seq?.lastSentAt ? Date.parse(d.seq.lastSentAt) : NaN;
  if (Number.isFinite(last) && now.getTime() - last < 20 * 3_600_000) return null;
  return step;
}

// ── the Resend email list (lib/roadmap/resendList.ts) ────────────────────────
export type ListState = "subscribed" | "unsubscribed";

/**
 * Where this lead SHOULD be on the list. Nobody is on it before the double
 * opt-in (null = leave the list alone); after it, subscribed until they
 * unsubscribe.
 */
export function wantedListState(d: RoadmapDetails): ListState | null {
  if (!confirmed(d)) return null;
  return d.unsubscribedAt ? "unsubscribed" : "subscribed";
}

/** True when the list does not (provably) match the lead yet: the daily job then syncs it. */
export function needsListSync(d: RoadmapDetails): boolean {
  if (d.anonymizedAt) return false;
  const want = wantedListState(d);
  return want !== null && d.list?.state !== want;
}

// ── retention ────────────────────────────────────────────────────────────────
/** Confirmed leads: like contact-form data (privacy policy §5), 12 months. */
export const RETENTION_DAYS = 365;
/** Never confirmed: no consent, so the request is wiped after 30 days. */
export const UNCONFIRMED_DAYS = 30;

/** Last time this lead did anything: submitted, confirmed, got a mail, unsubscribed. */
export function lastActivity(d: RoadmapDetails, createdAt: string): number {
  const ts = [createdAt, d.consent?.confirmedAt, d.delivery?.sentAt, d.seq?.lastSentAt, d.unsubscribedAt]
    .map((x) => (x ? Date.parse(String(x)) : NaN))
    .filter(Number.isFinite);
  return ts.length ? Math.max(...ts) : NaN;
}

/** Past its retention since the last activity, and not anonymized yet. */
export function isExpired(d: RoadmapDetails, createdAt: string, now: Date): boolean {
  if (d.anonymizedAt) return false;
  const last = lastActivity(d, createdAt);
  const days = confirmed(d) ? RETENTION_DAYS : UNCONFIRMED_DAYS;
  return Number.isFinite(last) && now.getTime() - last > days * 86_400_000;
}

/**
 * What stays after anonymizing: the numbers (level, answers) for statistics,
 * nothing that points to a person or a house (no name, mail, IP, consent text).
 */
export function anonymizedDetails(d: RoadmapDetails, now: Date): RoadmapDetails {
  return {
    source: d.source, lang: d.lang,
    answers: d.answers, result: d.result,
    anonymizedAt: now.toISOString(),
  };
}
