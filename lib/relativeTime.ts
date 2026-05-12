import {
  formatDistanceToNow,
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  format,
  isToday,
  isYesterday,
} from "date-fns";
import { fr, de, enUS } from "date-fns/locale";

type Lang = "fr" | "de" | "en";
const LOCALES = { fr, de, en: enUS } as const;

const JUST_NOW: Record<Lang, string> = { fr: "à l'instant", de: "gerade eben", en: "just now" };
const TODAY: Record<Lang, string> = { fr: "Aujourd'hui", de: "Heute", en: "Today" };
const YESTERDAY: Record<Lang, string> = { fr: "Hier", de: "Gestern", en: "Yesterday" };

function loc(lang: string) { return LOCALES[(lang as Lang)] ?? LOCALES.en; }
function L(map: Record<Lang, string>, lang: string) { return map[(lang as Lang)] ?? map.en; }
function toDate(v: string | Date): Date { return typeof v === "string" ? new Date(v) : v; }

/** Verbose relative time with suffix: "5 minutes ago", "il y a 5 minutes", "vor 5 Minuten". */
export function relativeTime(iso: string | Date, lang: string): string {
  const d = toDate(iso);
  if (Date.now() - d.getTime() < 60_000) return L(JUST_NOW, lang);
  return formatDistanceToNow(d, { addSuffix: true, locale: loc(lang) });
}

/** Compact relative time for tight UI: "just now" / "5m" / "5h" / "5d" / "15 Oct". */
export function relativeTimeShort(iso: string | Date, lang: string): string {
  const d = toDate(iso);
  const now = Date.now();
  if (now - d.getTime() < 60_000) return L(JUST_NOW, lang);
  const mins = differenceInMinutes(now, d);
  if (mins < 60) return `${mins}m`;
  const hrs = differenceInHours(now, d);
  if (hrs < 24) return `${hrs}h`;
  const days = differenceInDays(now, d);
  if (days < 7) return `${days}d`;
  return format(d, "d MMM", { locale: loc(lang) });
}

/** Day separator label: "Today" / "Yesterday" / "Mon, 15 Jan" (or with year). */
export function dayLabel(iso: string | Date, lang: string): string {
  const d = toDate(iso);
  if (isToday(d)) return L(TODAY, lang);
  if (isYesterday(d)) return L(YESTERDAY, lang);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return format(d, sameYear ? "EEE, d MMM" : "EEE, d MMM yyyy", { locale: loc(lang) });
}

/** Clock time "HH:mm". */
export function clockTime(iso: string | Date): string {
  return format(toDate(iso), "HH:mm");
}
