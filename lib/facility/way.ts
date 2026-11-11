/**
 * One nurse's whole way, as the portal shows it (founder 2026-11-11, premium mock approved: "less is more,
 * visuals, the outcome first, WANN as a countdown"). Pure: the same numbers for the facility list, her
 * page and her phone. Only stations with real data: Deutsch (B2 stage), Unterlagen + Anerkennung
 * (documents), Visum (embassy papers + the visa guide), Anreise (flight, pick-up, day 1) | Ankommen (first
 * weeks), Probezeit (six months). The flat runs beside the visa (find, lease, landlord's confirmation,
 * keys). Countdowns only from dates someone entered: visa handed in (+ 20 days, our experience 10 to 20),
 * flight, first working day, end of probation. No date → no countdown, just "x von y".
 */
import { VISA_STEPS } from "./visa";
import { MOVE_STEPS } from "./move";
import { STEPS } from "./steps";
import { SETTLE, probationEnd } from "./settle";
import { B2_STAGES, type B2Stage } from "@/lib/b2Journey";
import { MODULES, allModulesPassed, type LangInfo, type Marks } from "./track";

export type P = [number, number];
export type WayKey = "lang" | "papers" | "contract" | "recog" | "visa" | "trip" | "arrive" | "kp" | "stay";
export const WAY_ROAD: WayKey[] = ["lang", "papers", "contract", "recog", "visa", "trip", "arrive", "kp", "stay"];
export const WAY_ABROAD: WayKey[] = ["lang", "papers", "contract", "recog", "visa", "trip"];
export const WAY_GERMANY: WayKey[] = ["arrive", "kp", "stay"];
/** the chain that decides where she is now. Beside it, never blocking: Deutsch (a B1 nurse finishes B2 in
 * Germany), Vertrag and Kenntnisprüfung (open until someone marks them, then done). */
const CHAIN: WayKey[] = ["papers", "recog", "visa", "trip", "arrive", "stay"];
/** Bearbeitung / Anerkennung hidden for now (founder 2026-11-11: "Bearbeitung wollen wir nicht, bis jetzt") */
const SHOW_RECOG = false as boolean;

export type Who = "nurse" | "facility" | "both";
export type Tick = { id: string; who: Who; done: boolean };
export type Steps = Record<string, string>;

export type WayInput = {
  docs: { papers: P; bearbeitung: P; visum: P; pending?: number } | null;
  b2: { stage: B2Stage; failed: boolean } | null;
  steps: { visa: Steps; move: Steps; weeks: Steps; six: Steps };
  dates: { submitted: string; flight: string; start: string };
  /** her German in detail and her milestones (lib/facility/track.ts); absent = not known */
  lang?: LangInfo | null;
  marks?: Marks | null;
  /** YYYY-MM-DD */
  today: string;
};

export type Station = { key: WayKey; p: P; done: boolean };
export type Eta = { kind: "visa" | "flight" | "start" | "probation" | "exam" | "kp"; date: string; est: boolean };
export type Way = {
  stations: Station[];
  now: WayKey;
  /** the station before `now` that is complete (a small win), or null */
  win: WayKey | null;
  /** the flat, beside the visa */
  home: Tick[];
  /** the open steps of the station she is at (fx stations only; doc stations show tiles) */
  ticks: Tick[];
  /** the first open tick, if any */
  next: string | null;
  /** the big countdown for the header ("Erster Tag in 7 Wochen") */
  eta: Eta | null;
  /** the countdown that belongs to the station she is at */
  nowEta: Eta | null;
  /** every date still ahead, soonest first (B2 exam, Kenntnisprüfung, visa, flight, first day, probation) */
  upcoming: Eta[];
  /** she is in Germany: the way there folds to "geschafft" */
  landed: boolean;
};

const full = (p: P) => p[1] > 0 && p[0] >= p[1];
const HOME = MOVE_STEPS.filter((s) => s.group === "home").map((s) => s.id);
const TRIP = MOVE_STEPS.filter((s) => s.group === "trip").map((s) => s.id);
// who does it (not stored with the move steps: the facility arranges the flat and the welcome, she books her flight)
const MOVE_WHO: Record<string, Who> = { find: "facility", lease: "facility", wgb: "facility", keys: "facility", flight: "nurse", pickup: "facility", day1: "facility" };

const tick = (ids: string[], s: Steps, who: (id: string) => Who): Tick[] => ids.map((id) => ({ id, who: who(id), done: !!s[id] }));
const count = (t: Tick[]): P => [t.filter((x) => x.done).length, t.length];

const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
export function addDays(d: string, n: number): string {
  return new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400e3);
}

export function buildWay(i: WayInput): Way {
  const visaT = tick(VISA_STEPS.map((s) => s.id), i.steps.visa, (id) => VISA_STEPS.find((s) => s.id === id)!.who);
  const tripT = tick(TRIP, i.steps.move, (id) => MOVE_WHO[id] ?? "both");
  const homeT = tick(HOME, i.steps.move, (id) => MOVE_WHO[id] ?? "both");
  const weekT = tick(STEPS.map((s) => s.id), i.steps.weeks, () => "nurse");
  const sixT = tick(SETTLE.flatMap((b) => b.items.map((x) => x.id)), i.steps.six, () => "both");

  const b2pos = i.b2 ? (B2_STAGES.find((s) => s.key === i.b2!.stage)?.position ?? 0) : 0;
  const vis = count(visaT);
  const lg = i.lang ?? null;
  const mods = lg ? MODULES.filter((k) => lg.modules[k] === "passed").length : 0;
  const anyMod = !!lg && MODULES.some((k) => lg.modules[k]);
  const b2done = i.b2?.stage === "passed" || allModulesPassed(lg);
  const mk = i.marks ?? null;
  const P_: Record<WayKey, P | null> = {
    lang: b2done ? [4, 4] : anyMod ? [mods, 4] : i.b2 ? [b2pos, 4] : lg?.level || lg?.exam_date ? [0, 4] : null,
    papers: i.docs ? i.docs.papers : null,
    contract: [mk?.contract ? 1 : 0, 1],
    kp: [mk?.urkunde ? 2 : mk?.kp_result === "passed" ? 1 : 0, 2],
    recog: SHOW_RECOG && i.docs ? i.docs.bearbeitung : null,
    visa: i.docs ? [i.docs.visum[0] + vis[0], i.docs.visum[1] + vis[1]] : vis,
    trip: count(tripT),
    arrive: count(weekT),
    stay: count(sixT),
  };
  const stations: Station[] = WAY_ROAD.filter((k) => P_[k] && P_[k]![1] > 0).map((k) => ({ key: k, p: P_[k]!, done: full(P_[k]!) }));
  const chain = stations.filter((s) => CHAIN.includes(s.key));
  const nowSt = chain.find((s) => !s.done) ?? chain[chain.length - 1];
  const now: WayKey = nowSt?.key ?? "papers";
  const before = chain.slice(0, Math.max(0, chain.indexOf(nowSt!)));
  const win = before.length ? before[before.length - 1].key : (i.b2?.stage === "passed" ? "lang" : null);

  const ticks = now === "visa" ? visaT : now === "trip" ? tripT : now === "arrive" ? weekT : now === "stay" ? sixT : [];
  const next = ticks.find((t) => !t.done)?.id ?? null;

  // countdowns, from entered dates only
  const { submitted, flight, start } = i.dates;
  const t0 = i.today;
  const future = (d: string) => isDay(d) && daysBetween(t0, d) >= 0;
  const visaGot = !!i.steps.visa.got;
  const visaEta: Eta | null = isDay(submitted) && !visaGot && future(addDays(submitted, 20)) ? { kind: "visa", date: addDays(submitted, 20), est: true } : null;
  const flightEta: Eta | null = future(flight) ? { kind: "flight", date: flight, est: false } : null;
  const startEta: Eta | null = future(start) ? { kind: "start", date: start, est: false } : null;
  const probEnd = isDay(start) ? probationEnd(start) : "";
  const probEta: Eta | null = isDay(start) && !future(start) && future(probEnd) ? { kind: "probation", date: probEnd, est: false } : null;
  const eta = startEta ?? probEta ?? flightEta ?? visaEta;
  const nowEta = now === "visa" ? visaEta : now === "trip" ? (flightEta ?? startEta) : now === "arrive" ? (startEta ?? probEta) : now === "stay" ? probEta : null;
  const examEta: Eta | null = lg && !b2done && future(lg.exam_date) ? { kind: "exam", date: lg.exam_date, est: false } : null;
  const kpEta: Eta | null = mk && !mk.kp_result && !mk.urkunde && future(mk.kp_date) ? { kind: "kp", date: mk.kp_date, est: false } : null;
  const upcoming = [examEta, kpEta, visaEta, flightEta, startEta, probEta].filter((x): x is Eta => !!x).sort((a, b) => a.date.localeCompare(b.date));
  const landed = now === "arrive" || now === "stay";

  return { stations, now, win, home: homeT, ticks, next, eta, nowEta, upcoming, landed };
}

/** "in 12 Tagen" / "in 7 Wochen" / "in 4 Monaten" — big number + unit, for a countdown */
export function until(today: string, date: string, lang: "de" | "en" | "fr"): { n: string; unit: string; word: string } {
  const d = daysBetween(today, date);
  const L = {
    de: { today: "heute", tomorrow: "morgen", d: ["Tag", "Tagen", "Tage"], w: ["Woche", "Wochen", "Wochen"], m: ["Monat", "Monaten", "Monate"], in: "in" },
    en: { today: "today", tomorrow: "tomorrow", d: ["day", "days", "days"], w: ["week", "weeks", "weeks"], m: ["month", "months", "months"], in: "in" },
    fr: { today: "aujourd’hui", tomorrow: "demain", d: ["jour", "jours", "jours"], w: ["semaine", "semaines", "semaines"], m: ["mois", "mois", "mois"], in: "dans" },
  }[lang];
  if (d <= 0) return { n: "", unit: L.today, word: L.today };
  if (d === 1) return { n: "", unit: L.tomorrow, word: L.tomorrow };
  const [n, u] = d <= 21 ? [d, L.d] : d <= 120 ? [Math.round(d / 7), L.w] : [Math.round(d / 30.4), L.m];
  // de: "in 12 Tagen" (dative) for the sentence, "12 Tage" for the big number
  return { n: String(n), unit: n === 1 ? u[0] : u[2], word: `${L.in} ${n} ${n === 1 ? u[0] : u[1]}` };
}

/** "Mo · 4. Dez." */
export function shortDate(date: string, lang: "de" | "en" | "fr"): string {
  if (!isDay(date)) return "";
  const loc = lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB";
  const d = new Date(date + "T12:00:00Z");
  const wd = d.toLocaleDateString(loc, { weekday: "short", timeZone: "UTC" }).replace(/\.$/, "");
  const dm = d.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "UTC" });
  return `${wd} · ${dm}`;
}

/** short words, so a fifth grader gets it (station names, step names, countdown labels) */
type L3 = { de: string; en: string; fr: string };
export const WAY_NAME: Record<WayKey, L3> = {
  lang: { de: "Deutsch", en: "German", fr: "Allemand" },
  papers: { de: "Unterlagen", en: "Documents", fr: "Documents" },
  contract: { de: "Vertrag", en: "Contract", fr: "Contrat" },
  kp: { de: "Kenntnisprüfung", en: "Knowledge test", fr: "Examen de connaissances" },
  recog: { de: "Anerkennung", en: "Recognition", fr: "Reconnaissance" },
  visa: { de: "Visum", en: "Visa", fr: "Visa" },
  trip: { de: "Anreise", en: "Journey", fr: "Voyage" },
  arrive: { de: "Ankommen", en: "Arrival", fr: "Arrivée" },
  stay: { de: "Probezeit", en: "Probation", fr: "Période d’essai" },
};
export const WAY_WIN: Record<WayKey, L3> = {
  lang: { de: "B2 bestanden", en: "B2 passed", fr: "B2 réussi" },
  papers: { de: "Unterlagen komplett", en: "Documents complete", fr: "Documents complets" },
  contract: { de: "Vertrag unterschrieben", en: "Contract signed", fr: "Contrat signé" },
  kp: { de: "Berufsurkunde da", en: "Licence received", fr: "Diplôme reconnu" },
  recog: { de: "Anerkennung geschafft", en: "Recognition done", fr: "Reconnaissance obtenue" },
  visa: { de: "Visum da", en: "Visa granted", fr: "Visa obtenu" },
  trip: { de: "Gelandet", en: "Landed", fr: "Arrivée" },
  arrive: { de: "Angekommen", en: "Settled in", fr: "Installée" },
  stay: { de: "Probezeit geschafft", en: "Probation passed", fr: "Période d’essai réussie" },
};
export const STEP_NAME: Record<string, L3> = {
  vorab: { de: "Vorabzustimmung", en: "Pre-approval", fr: "Accord préalable" },
  docs: { de: "Visa-Mappe", en: "Visa folder", fr: "Dossier visa" },
  book: { de: "Termin buchen", en: "Book appointment", fr: "Prendre rendez-vous" },
  submit: { de: "Abgabe bei TLS", en: "Hand in at TLS", fr: "Dépôt chez TLS" },
  wait: { de: "Antwort abwarten", en: "Wait for answer", fr: "Attendre la réponse" },
  got: { de: "Visum da", en: "Visa granted", fr: "Visa obtenu" },
  find: { de: "Wohnung finden", en: "Find a flat", fr: "Trouver un logement" },
  lease: { de: "Mietvertrag", en: "Lease", fr: "Bail" },
  wgb: { de: "Bestätigung vom Vermieter", en: "Landlord’s confirmation", fr: "Attestation du logeur" },
  keys: { de: "Schlüssel", en: "Keys", fr: "Clés" },
  flight: { de: "Flug buchen", en: "Book flight", fr: "Réserver le vol" },
  pickup: { de: "Abholung", en: "Pick-up", fr: "Accueil" },
  day1: { de: "Erster Tag", en: "First day", fr: "Premier jour" },
  wohnung: { de: "Einziehen", en: "Move in", fr: "Emménager" },
  anmeldung: { de: "Anmelden", en: "Register", fr: "Déclarer le domicile" },
  konto: { de: "Konto", en: "Bank account", fr: "Compte bancaire" },
  kasse: { de: "Krankenkasse", en: "Health insurance", fr: "Assurance maladie" },
  steuer: { de: "Steuer-ID", en: "Tax ID", fr: "Numéro fiscal" },
  aufenthalt: { de: "Aufenthaltstitel", en: "Residence permit", fr: "Titre de séjour" },
  arzt: { de: "Hausarzt", en: "Family doctor", fr: "Médecin traitant" },
};
export const ETA_NAME: Record<Eta["kind"], L3> = {
  visa: { de: "Visum", en: "Visa", fr: "Visa" },
  flight: { de: "Flug", en: "Flight", fr: "Vol" },
  start: { de: "Erster Tag", en: "First day", fr: "Premier jour" },
  probation: { de: "Probezeit geschafft", en: "Probation done", fr: "Fin de l’essai" },
  exam: { de: "B2-Prüfung", en: "B2 exam", fr: "Examen B2" },
  kp: { de: "Kenntnisprüfung", en: "Knowledge test", fr: "Examen de connaissances" },
};
/** the settle items have no short name: their phase ("Monat 1") is the name */
export function stepName(id: string, lang: "de" | "en" | "fr"): string {
  if (STEP_NAME[id]) return STEP_NAME[id][lang];
  const b = SETTLE.find((x) => x.items.some((it) => it.id === id));
  return b ? b.when[lang] : id;
}
