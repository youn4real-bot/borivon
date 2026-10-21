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
