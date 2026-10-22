/**
 * What the founder sees for a Fahrplan lead in /portal/admin/leads: the
 * answers and the result as short chips, so he knows the house's numbers
 * before he calls. Pure + client-safe (no pdf-lib): the leads page is a client
 * component.
 *
 * Why it exists: a roadmap lead keeps nested objects in `details` (answers,
 * result, consent, seq), and the generic chip list rendered every value as a
 * React child, which would have crashed the leads page on the first real lead.
 */
import { LEVELS, BOTTLENECK, pick, type Lang } from "./content";
import type { Level, RoadmapResult } from "./score";

type L3 = Record<Lang, string>;
const TYPE: Record<string, L3> = {
  hospital: { de: "Krankenhaus", en: "Hospital", fr: "Hôpital" },
  care_home: { de: "Pflegeheim", en: "Care home", fr: "Maison de retraite" },
  home_care: { de: "Ambulanter Dienst", en: "Home care", fr: "Soins à domicile" },
  rehab: { de: "Reha-Klinik", en: "Rehab clinic", fr: "Rééducation" },
  other: { de: "Andere", en: "Other", fr: "Autre" },
};
const AGENCY: Record<string, L3> = {
  none: { de: "keine", en: "none", fr: "aucune" },
  low: { de: "unter 100 Std.", en: "under 100 h", fr: "moins de 100 h" },
  mid: { de: "100–500 Std.", en: "100–500 h", fr: "100–500 h" },
  high: { de: "500–1.500 Std.", en: "500–1,500 h", fr: "500–1 500 h" },
  very_high: { de: "über 1.500 Std.", en: "over 1,500 h", fr: "plus de 1 500 h" },
};
const FOREIGN: Record<string, L3> = {
  never: { de: "noch nie", en: "never", fr: "jamais" },
  tried_left: { de: "ja, sind gegangen", en: "yes, they left", fr: "oui, reparties" },
  some_stayed: { de: "ja, einige blieben", en: "yes, some stayed", fr: "oui, certaines restées" },
  most_stayed: { de: "ja, die meisten blieben", en: "yes, most stayed", fr: "oui, la plupart restées" },
};
const ONB: Record<string, L3> = {
  mentor: { de: "Patin", en: "mentor", fr: "marraine" },
  german: { de: "Deutsch", en: "German", fr: "allemand" },
  housing: { de: "Wohnung", en: "housing", fr: "logement" },
  plan: { de: "Plan", en: "plan", fr: "plan" },
  checkins: { de: "Gespräche", en: "check-ins", fr: "entretiens" },
};
const PAIN: Record<string, L3> = {
  open_posts: { de: "Stellen bleiben leer", en: "posts stay empty", fr: "postes vides" },
  leaving: { de: "Leute gehen wieder", en: "nurses leave", fr: "elles repartent" },
  agency: { de: "Leihkräfte zu teuer", en: "agency too costly", fr: "intérim trop cher" },
  paperwork: { de: "Papiere dauern", en: "paperwork", fr: "papiers" },
  german: { de: "Deutsch reicht nicht", en: "German not enough", fr: "allemand insuffisant" },
};
const LBL: Record<string, L3> = {
  level: { de: "Stufe", en: "Level", fr: "Niveau" },
  loss: { de: "Verlust/Jahr", en: "Loss/year", fr: "Perte/an" },
  house: { de: "Haus", en: "Facility", fr: "Établissement" },
  staff: { de: "Personal", en: "Staff", fr: "Personnel" },
  open: { de: "offen", en: "open", fr: "vides" },
  left: { de: "gegangen", en: "left", fr: "partis" },
  agency: { de: "Leihkräfte", en: "Agency", fr: "Intérim" },
  foreign: { de: "Ausland", en: "Abroad", fr: "Étranger" },
  onb: { de: "Einarbeitung", en: "Onboarding", fr: "Intégration" },
  nothing: { de: "nichts", en: "nothing", fr: "rien" },
  pain: { de: "Schmerz", en: "Pain", fr: "Douleur" },
  neck: { de: "Engpass", en: "Bottleneck", fr: "Blocage" },
  tips: { de: "Tipps", en: "Tips", fr: "Conseils" },
  no: { de: "nein", en: "no", fr: "non" },
  waiting: { de: "ja, nicht bestätigt", en: "yes, not confirmed", fr: "oui, non confirmé" },
  confirmed: { de: "bestätigt", en: "confirmed", fr: "confirmé" },
  unsub: { de: "abgemeldet", en: "unsubscribed", fr: "désinscrit" },
  mails: { de: "Mails", en: "emails", fr: "e-mails" },
  source: { de: "Quelle", en: "Source", fr: "Source" },
  role: { de: "Rolle", en: "Role", fr: "Rôle" },
  lang: { de: "Sprache", en: "Language", fr: "Langue" },
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** details may arrive as an object (decoded) or as the raw JSON text from D1. */
const root = (v: unknown): Record<string, unknown> => { if (typeof v === "string") { try { return obj(JSON.parse(v)); } catch { return {}; } } return obj(v); };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function euro(n: number, lang: Lang): string {
  const v = Math.round(n);
  if (lang === "en") return "€" + v.toLocaleString("en-GB");
  return v.toLocaleString(lang === "de" ? "de-DE" : "fr-FR").replace(/[  ]/g, " ") + " €";
}

export type Chip = { k: string; v: string };

/** Chips for one roadmap lead. Never throws on odd or partial `details`. */
export function roadmapLeadChips(details: unknown, lang: Lang): Chip[] {
  const d = root(details);
  const a = obj(d.answers);
  const r = obj(d.result);
  const c = obj(d.consent);
  const seq = obj(d.seq);
  const t = (key: string) => pick(LBL[key], lang);
  const out: Chip[] = [];
  const lvl = num(r.level);
  if (lvl && lvl >= 1 && lvl <= 5) out.push({ k: t("level"), v: `${lvl} · ${pick(LEVELS[lvl as Level].name, lang)}` });
  const total = num(r.totalYear);
  if (total !== null) out.push({ k: t("loss"), v: euro(total, lang) });
  const neck = str(r.bottleneck) as RoadmapResult["bottleneck"];
  if (BOTTLENECK[neck]) out.push({ k: t("neck"), v: pick(BOTTLENECK[neck].t, lang).replace(/^[^:]*:\s*/, "") });
  if (TYPE[str(a.facilityType)]) out.push({ k: t("house"), v: pick(TYPE[str(a.facilityType)], lang) });
  const staff = num(a.staff), open = num(a.openPosts), left = num(a.leftLastYear);
  if (staff !== null) out.push({ k: t("staff"), v: `${staff} · ${open ?? 0} ${t("open")} · ${left ?? 0} ${t("left")}` });
  if (AGENCY[str(a.agency)]) out.push({ k: t("agency"), v: pick(AGENCY[str(a.agency)], lang) });
  if (FOREIGN[str(a.foreign)]) out.push({ k: t("foreign"), v: pick(FOREIGN[str(a.foreign)], lang) });
  if (Array.isArray(a.onboarding)) {
    const items = (a.onboarding as unknown[]).map((x) => ONB[str(x)]).filter(Boolean).map((x) => pick(x, lang));
    out.push({ k: t("onb"), v: items.length ? items.join(", ") : t("nothing") });
  }
  if (PAIN[str(a.pain)]) out.push({ k: t("pain"), v: pick(PAIN[str(a.pain)], lang) });
  const sent = num(seq.step) ?? 0;
  const tips = str(d.unsubscribedAt) ? t("unsub")
    : c.tipsAsked !== true ? t("no")
    : str(c.confirmedAt) ? `${t("confirmed")} · ${sent}/4 ${t("mails")}`
    : t("waiting");
  out.push({ k: t("tips"), v: tips });
  if (str(d.heardFrom)) out.push({ k: t("source"), v: str(d.heardFrom) });
  if (str(d.role)) out.push({ k: t("role"), v: str(d.role) });
  if (str(d.lang)) out.push({ k: t("lang"), v: str(d.lang).toUpperCase() });
  return out;
}

/** Generic leads: only plain values become chips (objects would crash React). */
export function plainDetailChips(details: unknown): Chip[] {
  return Object.entries(root(details))
    .filter(([, v]) => (typeof v === "string" && v.trim() !== "") || typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => ({ k, v: String(v) }));
}
