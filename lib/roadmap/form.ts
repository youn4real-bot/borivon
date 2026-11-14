/**
 * The /fahrplan form, version 2 (founder spec 2026-11-08, fahrplan-form-spec.html).
 * The page sends short codes; this file cleans them and turns them into the
 * numbers the money model and the PDF use (score.ts RoadmapAnswers).
 *
 * Every question must change something in the Fahrplan:
 *   art · cost model + tips          bedarf · open posts → money
 *   leasing · stage                  erfahrung/grund · stage + the main hurdle
 *   haben · stage + checklist        start/datum · the personal deadline (timeline.ts)
 * (The German-level question was cut 2026-11-08: too technical for the reader.)
 *   land/standorte/plaetze/rolle/wer · cover line, size of the gap, admin view
 */
import type { L } from "./content";
import type { FacilityType, AgencyBand, ForeignHistory, Pain, Onboarding, RoadmapAnswers } from "./score";

const x = (de: string, en: string, fr: string): L => ({ de, en, fr });

export const ART = {
  care_home: x("Pflegeheim", "Care home", "Maison de retraite"),
  hospital: x("Krankenhaus / Klinik", "Hospital / clinic", "Hôpital / clinique"),
  home_care: x("Ambulanter Dienst", "Home care service", "Soins à domicile"),
  rehab: x("Reha", "Rehab", "Rééducation"),
  disability: x("Eingliederungshilfe", "Disability care", "Aide aux personnes handicapées"),
  other: x("Andere", "Other", "Autre"),
} as const;
export const ROLLE = {
  lead: x("Einrichtungsleitung", "Facility manager", "Direction d'établissement"),
  pdl: x("PDL", "Head of nursing", "Direction des soins"),
  ceo: x("Geschäftsführung", "Managing director", "Direction générale"),
  hr: x("Personal / HR", "HR", "RH"),
  other: x("Andere", "Other", "Autre"),
} as const;
export const LAND = {
  BW: "Baden-Württemberg", BY: "Bayern", BE: "Berlin", BB: "Brandenburg", HB: "Bremen", HH: "Hamburg", HE: "Hessen",
  MV: "Mecklenburg-Vorpommern", NI: "Niedersachsen", NW: "Nordrhein-Westfalen", RP: "Rheinland-Pfalz", SL: "Saarland",
  SN: "Sachsen", ST: "Sachsen-Anhalt", SH: "Schleswig-Holstein", TH: "Thüringen",
} as const;
export const STANDORTE = ["1", "2-5", "6-20", "21-100", "100+"] as const;
export const PLAETZE = ["<50", "50-100", "100-200", "200+"] as const;
export const BEDARF = ["1-5", "6-10", "11-25", "26-50", "51-100", "100+"] as const;
export const LEASING = ["0", "1-2", "3-5", "6+"] as const;
export const ERFAHRUNG = ["never", "failed", "more"] as const;
export const GRUND = {
  never_came: x("Sie kam nie an", "She never arrived", "Elle n'est jamais arrivée"),
  papers: x("Die Papiere dauerten zu lange", "The papers took too long", "Les papiers ont pris trop de temps"),
  german: x("Ihr Deutsch reichte nicht", "Her German wasn't enough", "Son allemand ne suffisait pas"),
  left: x("Sie ging nach der Ankunft", "She left after arriving", "Elle est partie après l'arrivée"),
  skills: x("Sie passte fachlich nicht", "Her skills didn't fit", "Ses compétences ne convenaient pas"),
  agency: x("Der Vermittler passte nicht zu uns", "The agency wasn't right for us", "L'agence ne nous convenait pas"),
  other: x("Etwas anderes", "Something else", "Autre chose"),
} as const;
export const START = ["asap", "6m", "12m", "date"] as const;
export const HABEN = {
  flat: x("Eine Wohnung", "A flat", "Un logement"),
  mentor: x("Eine feste Ansprechperson im Team", "A fixed contact in the team", "Une personne de référence"),
  offices: x("Hilfe bei Ämtern", "Help with offices", "Aide pour les démarches"),
  plan: x("Ein Einarbeitungsplan", "An onboarding plan", "Un plan d'intégration"),
  budget: x("Das Budget", "The budget", "Le budget"),
} as const;
export const WER = ["me", "me_board", "board"] as const;

export type FormV2 = {
  v: 2;
  art: keyof typeof ART;
  rolle: keyof typeof ROLLE;
  standorte: (typeof STANDORTE)[number];
  land: keyof typeof LAND | "";
  plaetze: (typeof PLAETZE)[number];
  bedarf: (typeof BEDARF)[number];
  leasing: (typeof LEASING)[number];
  erfahrung: (typeof ERFAHRUNG)[number];
  grund: (keyof typeof GRUND)[];
  start: (typeof START)[number];
  /** YYYY-MM-DD, only with start = "date" */
  datum: string;
  haben: (keyof typeof HABEN)[];
  wer: (typeof WER)[number];
  /** The exact number of missing nurses the visitor set in the tool on the home page (1–50). Only sent when they
   *  kept the matching need range; 0 / absent = not known, the range's average is used. */
  fehlen?: number;
};

const one = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(v as T) ? (v as T) : dflt);
const many = <T extends string>(v: unknown, list: readonly T[]): T[] => (Array.isArray(v) ? list.filter((k) => (v as unknown[]).includes(k)) : []);
const keys = <O extends object>(o: O) => Object.keys(o) as (keyof O & string)[];

/** True when the page sent the v2 form (it always sends v: 2). */
export function isFormV2(a: unknown): boolean {
  return !!a && typeof a === "object" && (a as { v?: unknown }).v === 2;
}

/** Defensive: whatever arrives, only known codes survive. */
export function normalizeForm(a: Record<string, unknown>): FormV2 {
  const start = one(a.start, START, "asap");
  const datum = typeof a.datum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.datum) && Number.isFinite(Date.parse(a.datum)) ? a.datum : "";
  const erfahrung = one(a.erfahrung, ERFAHRUNG, "never");
  return {
    v: 2,
    art: one(a.art, keys(ART), "care_home"),
    rolle: one(a.rolle, keys(ROLLE), "other"),
    standorte: one(a.standorte, STANDORTE, "1"),
    land: one(a.land, keys(LAND), "" as never) || "",
    plaetze: one(a.plaetze, PLAETZE, "50-100"),
    bedarf: one(a.bedarf, BEDARF, "1-5"),
    leasing: one(a.leasing, LEASING, "0"),
    erfahrung,
    grund: erfahrung === "failed" ? many(a.grund, keys(GRUND)) : [],
    start: start === "date" && !datum ? "asap" : start,
    datum: start === "date" ? datum : "",
    haben: many(a.haben, keys(HABEN)),
    wer: one(a.wer, WER, "me"),
    fehlen: typeof a.fehlen === "number" && Number.isInteger(a.fehlen) && a.fehlen >= 1 && a.fehlen <= 50 ? a.fehlen : 0,
  };
}

// ── form → money model ──────────────────────────────────────────────────────

const MID_BEDARF: Record<FormV2["bedarf"], number> = { "1-5": 3, "6-10": 8, "11-25": 18, "26-50": 38, "51-100": 75, "100+": 120 };
const MID_PLAETZE: Record<FormV2["plaetze"], number> = { "<50": 35, "50-100": 75, "100-200": 150, "200+": 280 };
/** Nurses (Fachkräfte) per place/bed/client, rough German averages. Only used to size the gap for the Stufe. */
const NURSES_PER_UNIT: Record<FacilityType, number> = { care_home: 0.2, hospital: 0.7, home_care: 0.2 };
const AGENCY: Record<FormV2["leasing"], AgencyBand> = { "0": "none", "1-2": "mid", "3-5": "high", "6+": "very_high" };

export function facilityTypeOf(f: FormV2): FacilityType {
  return f.art === "hospital" || f.art === "rehab" ? "hospital" : f.art === "home_care" ? "home_care" : "care_home";
}

/**
 * Posts open at the same time. The form asks the need over 12 months; spread
 * over the year, about half of it is open at any one time.
 */
export function openPostsOf(f: FormV2): number {
  if (f.fehlen && f.fehlen > 0) return f.fehlen; // their own number from the home tool
  return Math.max(1, Math.ceil(MID_BEDARF[f.bedarf] / 2));
}

/** The answers the money model and the PDF were built on. */
export function toModel(f: FormV2): RoadmapAnswers {
  const facilityType = facilityTypeOf(f);
  const onboarding: Onboarding[] = [];
  if (f.haben.includes("mentor")) onboarding.push("mentor");
  if (f.haben.includes("flat")) onboarding.push("housing");
  if (f.haben.includes("plan")) onboarding.push("plan");
  if (f.haben.includes("offices")) onboarding.push("checkins");
  const foreign: ForeignHistory = f.erfahrung === "failed" ? "tried_left" : f.erfahrung === "more" ? "some_stayed" : "never";
  const g = f.grund;
  const pain: Pain = g.includes("papers") ? "paperwork" : g.includes("german") ? "german" : g.includes("left") ? "leaving"
    : f.leasing !== "0" ? "agency" : "open_posts";
  return {
    facilityType,
    staff: Math.max(1, Math.round(MID_PLAETZE[f.plaetze] * NURSES_PER_UNIT[facilityType])),
    openPosts: openPostsOf(f),
    // Not asked any more: the PDF shows no "people who leave" line then.
    leftLastYear: 0,
    agency: AGENCY[f.leasing],
    foreign,
    onboarding,
    pain,
    usesAgency: f.leasing !== "0",
    scoreV2: formScore(f),
  };
}

/**
 * The Stufe from the v2 answers (0–100, higher = healthier; 82+ = 5 … under 30 = 1):
 *   the gap: open posts against the estimated nurses on staff (biggest weight)
 *   agency staff in the house · it went wrong before · nothing prepared · hired abroad and want more
 */
export function formScore(f: FormV2): number {
  const t = facilityTypeOf(f);
  const staff = Math.max(1, MID_PLAETZE[f.plaetze] * NURSES_PER_UNIT[t]);
  const gap = openPostsOf(f) / staff;
  let s = 100 - Math.min(70, gap * 250);
  s -= { "0": 0, "1-2": 8, "3-5": 16, "6+": 25 }[f.leasing];
  if (f.erfahrung === "failed") s -= 10;
  if (f.erfahrung === "more") s += 8;
  for (const k of ["flat", "mentor", "plan"] as const) if (!f.haben.includes(k)) s -= 3;
  return Math.round(Math.min(100, Math.max(0, s)));
}

/** Cover / email line: "Pflegeheim · Bayern". */
export function facilityLine(f: FormV2, lang: keyof L): string {
  return [ART[f.art][lang], f.land ? LAND[f.land] : ""].filter(Boolean).join(" · ");
}

/** For the founder (admin mail + lead view), always German. */
export function formSummaryDe(f: FormV2): [string, string][] {
  const START_DE = { asap: "So schnell wie möglich", "6m": "In ca. 6 Monaten", "12m": "In ca. 12 Monaten", date: f.datum };
  const ERF_DE = { never: "Nein, noch nie", failed: "Ja, aber es hat nicht geklappt", more: "Ja, und wir wollen mehr" };
  const WER_DE = { me: "Ich", me_board: "Ich mit Träger / GF", board: "Nur Träger / GF" };
  const rows: [string, string][] = [
    ["Einrichtung", ART[f.art].de],
    ["Position", ROLLE[f.rolle].de],
    ["Standorte", f.standorte],
    ["Bundesland", f.land ? LAND[f.land] : "–"],
    ["Größe", f.plaetze],
    ["Bedarf 12 Mon.", f.bedarf],
    ["Leihkräfte", f.leasing],
    ["Ausland", ERF_DE[f.erfahrung]],
  ];
  if (f.grund.length) rows.push(["Schiefgelaufen", f.grund.map((k) => GRUND[k].de).join(", ")]);
  rows.push(["Start", START_DE[f.start]],
    ["Vorbereitet", f.haben.length ? f.haben.map((k) => HABEN[k].de).join(", ") : "Noch nichts"], ["Entscheidet", WER_DE[f.wer]]);
  return rows;
}

export const BANDS: Record<FormV2["bedarf"], L> = {
  "1-5": x("1 bis 5", "1 to 5", "1 à 5"), "6-10": x("6 bis 10", "6 to 10", "6 à 10"), "11-25": x("11 bis 25", "11 to 25", "11 à 25"),
  "26-50": x("26 bis 50", "26 to 50", "26 à 50"), "51-100": x("51 bis 100", "51 to 100", "51 à 100"), "100+": x("über 100", "over 100", "plus de 100"),
};
/** The "how we count" line on the numbers page: where the open posts come from. */
export const BEDARF_LINE: Record<keyof L, (f: FormV2) => string> = {
  de: (f) => f.fehlen ? (f.fehlen === 1 ? "Ihre Angabe: 1 Pflegefachkraft fehlt Ihnen jetzt." : `Ihre Angabe: ${f.fehlen} Pflegefachkräfte fehlen Ihnen jetzt.`) : `Ihr Bedarf: ${BANDS[f.bedarf].de} Fachkräfte in 12 Monaten. Übers Jahr verteilt sind im Schnitt etwa ${openPostsOf(f)} Stellen gleichzeitig leer.`,
  en: (f) => f.fehlen ? (f.fehlen === 1 ? "Your figure: 1 nurse is missing right now." : `Your figure: ${f.fehlen} nurses are missing right now.`) : `Your need: ${BANDS[f.bedarf].en} nurses in 12 months. Spread over the year, about ${openPostsOf(f)} posts are empty at the same time.`,
  fr: (f) => f.fehlen ? (f.fehlen === 1 ? "Votre chiffre : il vous manque 1 infirmière aujourd'hui." : `Votre chiffre : il vous manque ${f.fehlen} infirmières aujourd'hui.`) : `Votre besoin : ${BANDS[f.bedarf].fr} infirmières en 12 mois. Sur l'année, environ ${openPostsOf(f)} postes sont vides en même temps.`,
};
