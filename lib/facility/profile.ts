/**
 * Her profile card facts, read from her CV builder (candidate_profiles.cv_draft) — founder 2026-11-12,
 * "Profil" sample 1: "So sehen die Einrichtungen Sie". Pure: no I/O, so it is unit-testable.
 */
export type ProfileFacts = {
  city: string;
  german: string;      // "B2" … from fx_lang, else her CV's Deutsch line, else ""
  months: number;      // nursing work, gaps excluded
  depts: string[];     // up to 3, most recent first
};

type MY = { month?: string; year?: string } | null | undefined;
type Work = { isGap?: boolean; title?: string; departments?: unknown; start?: MY; end?: MY };
type Draft = { city?: string; workEntries?: unknown; langs?: unknown } | null | undefined;

const ym = (v: MY): number | null => {
  const y = Number(v?.year), m = Number(v?.month || 1);
  return Number.isFinite(y) && y > 1950 && y < 2100 ? y * 12 + (Number.isFinite(m) && m >= 1 && m <= 12 ? m - 1 : 0) : null;
};

/** "EL HAJEB" → "El Hajeb" (CVs often arrive in capitals); mixed case is left alone */
const niceCase = (s: string) => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s);

export function profileFacts(draft: Draft, langLevel: string, today = new Date()): ProfileFacts {
  const work = (Array.isArray(draft?.workEntries) ? draft!.workEntries : []) as Work[];
  const jobs = work.filter((w) => !w.isGap);
  // experience for an employer = real work: internships during training are not counted (they still teach departments)
  const INTERN = /praktik|\bintern(ship)?\b|stagiaire|\bstage\b/i;
  const paid = jobs.filter((w) => !INTERN.test(String(w.title ?? "")));
  const now = today.getFullYear() * 12 + today.getMonth();
  // months of work, overlapping jobs counted once
  const spans = paid.map((w) => [ym(w.start), w.end ? ym(w.end) : now] as const)
    .filter((s): s is readonly [number, number] => s[0] !== null && s[1] !== null && s[1] >= s[0])
    .sort((a, b) => a[0] - b[0]);
  let months = 0, curS = -1, curE = -1;
  for (const [s, e] of spans) {
    if (s > curE) { if (curE >= 0) months += curE - curS + 1; curS = s; curE = e; } else curE = Math.max(curE, e);
  }
  if (curE >= 0) months += curE - curS + 1;
  const recent = [...jobs].sort((a, b) => (ym(b.start) ?? 0) - (ym(a.start) ?? 0));
  const depts: string[] = [];
  // short chips only: one department per chip (CVs sometimes list several in one line), nothing long
  for (const w of recent) for (const d of Array.isArray(w.departments) ? w.departments : []) {
    for (const part of String(d ?? "").split(/[,;/]|\s\(/)) {
      const t = part.replace(/\)$/, "").trim();
      if (t && t.length <= 28 && !depts.includes(t) && depts.length < 3) depts.push(t);
    }
  }
  const langs = (Array.isArray(draft?.langs) ? draft!.langs : []) as { name?: string; level?: string }[];
  const cvGerman = langs.find((l) => /^deutsch|^german|^allemand/i.test(String(l.name ?? "")))?.level ?? "";
  const lvl = (langLevel || cvGerman || "").toUpperCase().match(/[ABC][12]/)?.[0] ?? "";
  return {
    city: niceCase(String(draft?.city ?? "").trim()),
    german: lvl,
    months,
    depts,
  };
}
