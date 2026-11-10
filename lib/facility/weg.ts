/** The stations of "Dein Weg nach Deutschland" (components/fx/WegBar.tsx), in the order the page reads. */
import type { Lang } from "./steps";

export type WegKey = "visa" | "move" | "weeks" | "six";
export const WEG_ORDER: WegKey[] = ["visa", "move", "weeks", "six"];
export const WEG_ANCHOR: Record<WegKey, string> = { visa: "weg-visum", move: "weg-anreise", weeks: "weg-wochen", six: "weg-monate" };

export const WEG_T: Record<Lang, Record<WegKey, string> & { now: string; done: string; of: string; aria: string }> = {
  de: { visa: "Visum", move: "Wohnung und Anreise", weeks: "Die ersten Wochen", six: "Die ersten sechs Monate", now: "Jetzt", done: "Erledigt", of: "{a} von {b}", aria: "Der Weg, Station für Station" },
  en: { visa: "Visa", move: "Flat and journey", weeks: "The first weeks", six: "The first six months", now: "Now", done: "Done", of: "{a} of {b}", aria: "The way, station by station" },
  fr: { visa: "Visa", move: "Logement et voyage", weeks: "Les premières semaines", six: "Les six premiers mois", now: "Maintenant", done: "Fait", of: "{a} sur {b}", aria: "Le chemin, étape par étape" },
};

/** the station to work on now: the first one not complete (the last one once all are) */
export function wegNow(prog: Partial<Record<WegKey, [number, number]>>): WegKey {
  return WEG_ORDER.find((k) => { const p = prog[k]; return !p || p[0] < p[1]; }) ?? "six";
}
