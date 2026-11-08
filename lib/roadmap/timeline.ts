/**
 * The personal deadline (founder 2026-11-08: "the one thing that moves the needle").
 * From the start they want, work backwards: when must they begin, how many weeks are left.
 *
 * Step lengths in weeks. The office and visa steps are the legal targets of the
 * fast-track procedure (beschleunigtes Fachkräfteverfahren):
 *   office  · recognition decision "soll innerhalb von zwei Monaten" (§ 14a Abs. 3 BQFG, § 81a AufenthG)
 *   visa    · appointment within 3 weeks + decision "in der Regel innerhalb von drei Wochen" (§ 31a AufenthV)
 * Borivon runs EVERY placement through § 81a and recommends it to every employer (founder 2026-11-08).
 * The rest is our own planning value. FOUNDER: adjust find/papers/arrive to what you see in practice.
 */
import type { L } from "./content";
import type { FormV2 } from "./form";

const x = (de: string, en: string, fr: string): L => ({ de, en, fr });

// Internally we always use the fast track (§ 81a). The PDF never says so: founder 2026-11-08,
// "the moment you get technical, you lose them". Plain steps and dates only.
export const STEP_WEEKS = { find: 6, papers: 6, office: 8, visa: 8, arrive: 3 } as const;

export const STEP_NAME: Record<keyof typeof STEP_WEEKS, L> = {
  find: x("Pflegekraft finden", "Find the nurse", "Trouver l'infirmière"),
  papers: x("Papiere vorbereiten", "Prepare the papers", "Préparer les papiers"),
  office: x("Anerkennung", "Recognition", "Reconnaissance"),
  visa: x("Visum", "Visa", "Visa"),
  arrive: x("Anreise", "Travel", "Arrivée"),
};

export type TimelineStep = { key: keyof typeof STEP_WEEKS; weeks: number; from: Date; to: Date };
export type Timeline = {
  steps: TimelineStep[];
  totalWeeks: number;
  /** what they asked for, or null for "as soon as possible" */
  target: Date | null;
  /** the latest day to begin so the target holds (null for asap) */
  latestStart: Date | null;
  /** whole weeks from today to latestStart (negative = already late) */
  weeksLeft: number | null;
  /** first working day if they begin today */
  earliestFirstDay: Date;
  status: "asap" | "ok" | "tight" | "late";
};

const DAY = 86_400_000;
const addWeeks = (d: Date, w: number) => new Date(d.getTime() + w * 7 * DAY);
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function targetDate(f: Pick<FormV2, "start" | "datum">, today: Date): Date | null {
  const t = startOfDay(today);
  if (f.start === "6m") return addWeeks(t, 26);
  if (f.start === "12m") return addWeeks(t, 52);
  if (f.start === "date" && f.datum) return new Date(f.datum + "T00:00:00Z");
  return null;
}

export function buildTimeline(f: Pick<FormV2, "start" | "datum">, today: Date): Timeline {
  const t0 = startOfDay(today);
  const weeks = { ...STEP_WEEKS };
  const totalWeeks = Object.values(weeks).reduce((a, b) => a + b, 0);
  const target = targetDate(f, today);
  const latestStart = target ? addWeeks(target, -totalWeeks) : null;
  const weeksLeft = latestStart ? Math.floor((latestStart.getTime() - t0.getTime()) / (7 * DAY)) : null;
  // Draw the plan from the day they should begin: the latest start if it is still ahead, else today.
  let at = latestStart && latestStart > t0 ? latestStart : t0;
  const steps: TimelineStep[] = (Object.keys(weeks) as (keyof typeof STEP_WEEKS)[]).map((key) => {
    const from = at; at = addWeeks(at, weeks[key]);
    return { key, weeks: weeks[key], from, to: at };
  });
  const status: Timeline["status"] = weeksLeft === null ? "asap" : weeksLeft < 0 ? "late" : weeksLeft <= 4 ? "tight" : "ok";
  return { steps, totalWeeks, target, latestStart, weeksLeft, earliestFirstDay: addWeeks(t0, totalWeeks), status };
}

/** Page text. {date} {start} {weeks} {first} are filled in by the PDF. */
export const TL: Record<keyof L, {
  h: string; sub: string; ok: string; okBig: string; tight: string; late: string; lateBig: string; asap: string; asapBig: string;
  weeks: string; week: string; fast: string;
}> = {
  de: {
    h: "Ihr Zeitplan", sub: "Rückwärts gerechnet von Ihrem Wunschtermin.",
    ok: "Damit Ihre erste Fachkraft am {date} anfängt, müssen Sie spätestens am {start} starten.", okBig: "Noch {weeks} Wochen.",
    tight: "Das ist knapp. Jede Woche Warten schiebt den ersten Arbeitstag nach hinten.",
    late: "Für den {date} ist es zu knapp. Wenn Sie diese Woche starten, kann sie am {first} anfangen.", lateBig: "Frühestens: {first}",
    asap: "Wenn Sie diese Woche starten, kann Ihre erste Fachkraft am {first} anfangen.", asapBig: "Erster Arbeitstag: {first}",
    weeks: "Wochen", week: "Woche",
    fast: "Papiere, Anerkennung und Visum übernehmen wir. Sie bereiten nur den ersten Tag vor.",
  },
  en: {
    h: "Your timeline", sub: "Worked backwards from your start date.",
    ok: "For your first nurse to start on {date}, you must begin by {start} at the latest.", okBig: "{weeks} weeks left.",
    tight: "That is tight. Every week of waiting moves the first working day back.",
    late: "{date} is too soon. If you begin this week, she can start on {first}.", lateBig: "Earliest: {first}",
    asap: "If you begin this week, your first nurse can start on {first}.", asapBig: "First working day: {first}",
    weeks: "weeks", week: "week",
    fast: "We take care of the papers, recognition and visa. You only prepare the first day.",
  },
  fr: {
    h: "Votre calendrier", sub: "Calculé à rebours depuis votre date.",
    ok: "Pour que votre première infirmière commence le {date}, vous devez démarrer au plus tard le {start}.", okBig: "Plus que {weeks} semaines.",
    tight: "C'est serré. Chaque semaine d'attente repousse le premier jour.",
    late: "Le {date}, c'est trop tôt. Si vous démarrez cette semaine, elle peut commencer le {first}.", lateBig: "Au plus tôt : {first}",
    asap: "Si vous démarrez cette semaine, votre première infirmière peut commencer le {first}.", asapBig: "Premier jour : {first}",
    weeks: "semaines", week: "semaine",
    fast: "Papiers, reconnaissance et visa : on s'en occupe. Vous préparez seulement le premier jour.",
  },
};
