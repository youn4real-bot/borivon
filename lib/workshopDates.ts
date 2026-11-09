/**
 * The workshop dates in Morocco: ONE list for the emails and anything server-side that names a date.
 * The /workshop page carries the same dates as data attributes on its cards (content/pflege/workshop.html)
 * and drops past ones in the browser; tests/workshopDates.test.ts fails if the two ever disagree.
 *
 * Founder 2026-11-09: quarterly, always Saturday + Sunday. November 2026 is real and sold out.
 * 20 seats per date, 1.500 € per person, 2 days × 8 hours with the founder (was 10 × 3.000 €).
 * seatsLeft: null = open (no number shown), 0 = sold out.
 */
export type WorkshopDate = { start: string; end: string; seatsLeft: number | null };

export const WORKSHOP_DATES: WorkshopDate[] = [
  { start: "2026-11-28", end: "2026-11-29", seatsLeft: 0 },
  { start: "2027-02-06", end: "2027-02-07", seatsLeft: 18 },
  { start: "2027-05-22", end: "2027-05-23", seatsLeft: null },
  { start: "2027-08-28", end: "2027-08-29", seatsLeft: null },
];

/** Today's date in Germany as YYYY-MM-DD (the workshops are planned in German time). */
export function berlinToday(now: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Dates that are still bookable: not started yet and not sold out, soonest first. */
export function upcomingOpenDates(now: number = Date.now()): WorkshopDate[] {
  const today = berlinToday(now);
  return WORKSHOP_DATES.filter((d) => d.start > today && d.seatsLeft !== 0).sort((a, b) => a.start.localeCompare(b.start));
}

const MONTHS: Record<"de" | "en" | "fr", string[]> = {
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
};

/** "6.–7. Februar 2027" · "February 6–7, 2027" · "6–7 février 2027" */
export function dateRangeLabel(d: WorkshopDate, lang: "de" | "en" | "fr"): string {
  const [y, m, a] = d.start.split("-").map(Number);
  const b = Number(d.end.slice(8, 10));
  const month = MONTHS[lang][m - 1];
  if (lang === "de") return `${a}.–${b}. ${month} ${y}`;
  if (lang === "fr") return `${a}–${b} ${month} ${y}`;
  return `${month} ${a}–${b}, ${y}`;
}
