/**
 * Automatic document reminders — WHO gets one, WHAT it lists, and WHEN.
 *
 * The chase list only helps a person send messages by hand. Most chasing is the
 * same two sentences every time — "your diploma was refused, please send a new
 * one" / "we still need your transcript" — so the portal sends those itself, in
 * the candidate's own language, and the team keeps its time for the cases that
 * need a human.
 *
 * Pure decision core (no IO) so every rule is unit-tested; lib/docRemindersRun
 * does the loading and sending.
 *
 * The rules are deliberately conservative. A reminder that arrives too often, or
 * nags someone who is waiting on US, costs more trust than it earns:
 *   • only people actually in the process — in a batch, at a site, or with an
 *     agency (the founder chases the intake, not the roster; checked by the
 *     caller). The first dry run without this would have mailed 57 people,
 *     mostly months-old leads, ~700 missing items between them.
 *   • never someone who has not started (no live document) — that is a lead
 *   • never someone who uploaded in the last few days — she is working on it
 *   • never for a document that is waiting for OUR review
 *   • never for an optional document (Sonstiges, Berufserfahrung, Praktikum)
 *   • a refused document only after a few days' grace (she got the rejection
 *     email the moment it happened)
 *   • a missing paper only once she has gone quiet for a week
 *   • at most one email a week, and at most three in any two months
 */
import { computeChecklist, ALWAYS_OPTIONAL, type DocLike } from "@/lib/candidateChecklist";
import { COUNTED_IN_VISUM } from "@/lib/journeyProgress";
import { FILE_KEY_LABELS, resolveFileKey, translateDocLabel } from "@/lib/fileKeys";

const DAY = 86_400_000;

export const REMINDER_RULES = {
  /** A refused document is left alone this long — the rejection email just went out. */
  REJECT_GRACE_DAYS: 3,
  /** Any upload this recent means she is actively working on it. */
  ACTIVE_DAYS: 3,
  /** Missing papers are only mentioned once nothing has been uploaded for this long. */
  QUIET_DAYS: 7,
  /** Minimum gap between two reminders to the same person. */
  MIN_GAP_DAYS: 7,
  /** At most this many reminders ... */
  MAX_IN_WINDOW: 3,
  /** ... inside this window. */
  WINDOW_DAYS: 60,
  /** Longest list an email carries; the rest collapse into "+N more". */
  MAX_ITEMS_SHOWN: 6,
} as const;

export type ReminderDoc = {
  id?: string | null;
  file_type: string | null;
  status: string | null;
  uploaded_at: string | null;
  superseded_at?: string | null;
};

export type ReminderItem = {
  kind: "rejected" | "missing";
  /** Catalog fileKey, or the raw file_type for slot / custom documents. */
  key: string;
};

export type ReminderSkip =
  | "arrived" | "not_started" | "active" | "nothing_outstanding" | "too_soon" | "cap";

export type ReminderPlan =
  | { send: true; items: ReminderItem[] }
  | { send: false; skip: ReminderSkip; items: ReminderItem[] };

/**
 * Made INSIDE the portal (CV builder / cover-letter builder), not uploaded. A
 * reminder saying "please upload your CV" would send her looking for a file she
 * was never meant to have — the dashboard's builder gate already walks her
 * through these.
 */
const BUILT_IN_PORTAL = new Set(["cv_de", "letter", "cv_visa", "letter_visa"]);

/** Keys that are never worth a reminder, whatever an org override says. */
function neverChase(key: string): boolean {
  const base = key.endsWith("_de") ? key.slice(0, -3) : key;
  return base === "other" || ALWAYS_OPTIONAL.has(base) || BUILT_IN_PORTAL.has(key);
}

/**
 * Live = not archived. Besides `superseded_at` (LAW #33), an older archive path
 * renamed the row's file_type to "… (Archiv)" — found in the live data on the
 * first dry run, where it showed up as a refused document to re-send.
 */
function isLive(d: ReminderDoc): boolean {
  return !d.superseded_at && !/\(Archiv\)\s*$/i.test(d.file_type ?? "");
}

/**
 * What is still outstanding, ignoring timing.
 *
 * `rejectedAt` maps a document id to the moment it was refused (from the
 * candidate's own notification row). Documents carry no review timestamp, so
 * without it the upload time stands in — which only ever makes the grace
 * period LONGER, never shorter.
 */
export function outstandingItems(
  docs: ReminderDoc[],
  opts: {
    requiredKeys?: readonly string[] | null;
    rejectedAt?: ReadonlyMap<string, number>;
    now: number;
    includeMissing: boolean;
  },
): ReminderItem[] {
  const live = docs.filter(isLive);
  const out: ReminderItem[] = [];
  const seen = new Set<string>();

  // Anything approved or waiting for review settles its key: a refused copy
  // sitting next to a newer one is history, not a job for her.
  const settled = new Set<string>();
  for (const d of live) {
    if (d.status === "approved" || d.status === "pending" || d.status == null) {
      settled.add(resolveFileKey(d.file_type) || String(d.file_type ?? ""));
    }
  }

  // 1 — Refused and not replaced, past the grace period.
  for (const d of live) {
    if (d.status !== "rejected") continue;
    const key = resolveFileKey(d.file_type) || String(d.file_type ?? "");
    if (!key || settled.has(key) || neverChase(key) || seen.has(key)) continue;
    const at = (d.id && opts.rejectedAt?.get(d.id)) || Date.parse(d.uploaded_at ?? "");
    if (!Number.isFinite(at) || opts.now - at < REMINDER_RULES.REJECT_GRACE_DAYS * DAY) continue;
    seen.add(key);
    out.push({ kind: "rejected", key });
  }

  // 2 — Required papers with nothing uploaded at all. The original and the
  //     German translation are separate uploads, so each is its own line.
  if (opts.includeMissing) {
    const chk = computeChecklist(live as DocLike[], {
      requiredKeys: opts.requiredKeys ?? null,
      excludeKeys: COUNTED_IN_VISUM,
    });
    const override = opts.requiredKeys?.length ? new Set(opts.requiredKeys) : null;
    for (const it of chk.items) {
      if (neverChase(it.key) || (COUNTED_IN_VISUM as readonly string[]).includes(it.key)) continue;
      // The B2 certificate only exists once she has PASSED the exam — most are
      // still studying. Asking for it would be asking for the impossible. (A
      // REFUSED certificate is still chased above: that one she can re-send.)
      if (it.key === "langcert") continue;
      const required = override ? override.has(it.key) : !it.optional;
      if (!required) continue;
      if (it.original === "missing" && !seen.has(it.key)) {
        seen.add(it.key);
        out.push({ kind: "missing", key: it.key });
      }
      const tKey = `${it.key}_de`;
      if (it.translation === "missing" && !seen.has(tKey)) {
        seen.add(tKey);
        out.push({ kind: "missing", key: tKey });
      }
    }
  }
  return out;
}

/** Decide whether this candidate gets a reminder today, and what it says. */
export function planReminder(inp: {
  docs: ReminderDoc[];
  requiredKeys?: readonly string[] | null;
  rejectedAt?: ReadonlyMap<string, number>;
  /** When earlier reminders went out (ms). */
  sentAts: number[];
  arrived: boolean;
  now: number;
}): ReminderPlan {
  const { now } = inp;
  if (inp.arrived) return { send: false, skip: "arrived", items: [] };

  const live = inp.docs.filter(isLive);
  if (live.length === 0) return { send: false, skip: "not_started", items: [] };

  const lastUpload = Math.max(...live.map((d) => Date.parse(d.uploaded_at ?? "")).filter(Number.isFinite));
  if (Number.isFinite(lastUpload) && now - lastUpload < REMINDER_RULES.ACTIVE_DAYS * DAY) {
    return { send: false, skip: "active", items: [] };
  }

  const quiet = !Number.isFinite(lastUpload) || now - lastUpload >= REMINDER_RULES.QUIET_DAYS * DAY;
  const items = outstandingItems(inp.docs, {
    requiredKeys: inp.requiredKeys,
    rejectedAt: inp.rejectedAt,
    now,
    includeMissing: quiet,
  });
  if (items.length === 0) return { send: false, skip: "nothing_outstanding", items };

  const lastSent = inp.sentAts.length ? Math.max(...inp.sentAts) : null;
  if (lastSent != null && now - lastSent < REMINDER_RULES.MIN_GAP_DAYS * DAY) {
    return { send: false, skip: "too_soon", items };
  }
  const inWindow = inp.sentAts.filter((t) => now - t < REMINDER_RULES.WINDOW_DAYS * DAY).length;
  if (inWindow >= REMINDER_RULES.MAX_IN_WINDOW) return { send: false, skip: "cap", items };

  // Refused documents first — those are the ones she can fix in a minute.
  items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "rejected" ? -1 : 1));
  return { send: true, items };
}

/**
 * The name a candidate will recognise, in her language. Slot documents are
 * stored under the slot's id, so their label comes from `slotLabels`.
 */
export function reminderLabel(
  key: string,
  lang: "fr" | "en" | "de",
  slotLabels?: ReadonlyMap<string, string>,
): string {
  const slot = slotLabels?.get(key);
  if (slot) return slot;
  const base = FILE_KEY_LABELS[key]?.[0];
  return base ? translateDocLabel(base, lang) : key;
}
