/**
 * cvDraftToText — serialize a candidate's cv_draft (CVData) into readable plain
 * text, the same content the CV PDF renders from. Used by the visa
 * Motivationsschreiben "Copy prompt" button so a Borivon admin gets the prompt
 * AND the CV text in one copy — no PDF download. Source is cv_draft, so it works
 * in any document state (draft / pending / approved).
 *
 * Type-only import of CVData (erased at compile) → no @react-pdf runtime pulled in.
 */
import type { CVData, MonthYear } from "@/components/CVDocument";

function fmtMY(m?: MonthYear | null): string {
  if (!m || !m.month || !m.year) return "";
  return `${m.month}.${m.year}`;
}
function range(start: MonthYear, end: MonthYear | null): string {
  const a = fmtMY(start);
  const b = end ? fmtMY(end) : "aktuell";
  return a ? `${a} – ${b}` : "";
}
function nursingLabel(status: string, degree: string): string {
  if (status === "year1") return `${degree} (1. Ausbildungsjahr)`;
  if (status === "year2") return `${degree} (2. Ausbildungsjahr)`;
  if (status === "year3") return `${degree} (3. Ausbildungsjahr)`;
  return degree;
}

export function cvDraftToText(data: CVData): string {
  const L: string[] = [];
  const push = (s = "") => L.push(s);

  push("=== LEBENSLAUF (CV) ===");

  const name = `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim();
  if (name) push(`Name: ${name}`);

  // ── Persönliche Daten ──
  const pers: string[] = [];
  if (data.birthDate) pers.push(`geboren am ${data.birthDate}${data.birthPlace ? ` in ${data.birthPlace}` : ""}${data.countryOfBirth ? `, ${data.countryOfBirth}` : ""}`);
  if (data.nationality) pers.push(`Staatsangehörigkeit: ${[data.nationality, ...(data.additionalNationalities ?? [])].filter(Boolean).join(", ")}`);
  if (data.maritalStatus) pers.push(`Familienstand: ${data.maritalStatus}`);
  const addr = [
    [data.address, data.addressNumber].filter(Boolean).join(" "),
    [data.postalCode, data.city].filter(Boolean).join(" "),
    data.countryOfResidence,
  ].filter(Boolean).join(", ");
  if (addr) pers.push(`Adresse: ${addr}`);
  if (data.phone) pers.push(`Telefon: ${data.phone}`);
  if (data.email) pers.push(`E-Mail: ${data.email}`);
  if (pers.length) { push(); push("Persönliche Daten:"); pers.forEach(p => push(`- ${p}`)); }

  // ── Berufserfahrung ──
  const work = (data.workEntries ?? []).filter(w => !w.isGap && (w.title || w.employer));
  if (work.length) {
    push(); push("Berufserfahrung:");
    for (const w of work) {
      const head = [w.title, w.employer].filter(Boolean).join(", ");
      const loc = [w.location, w.country].filter(Boolean).join(", ");
      const r = range(w.start, w.end);
      push(`- ${head}${loc ? ` (${loc})` : ""}${r ? ` | ${r}` : ""}`);
      const depts = (w.departments ?? []).filter(Boolean);
      if (depts.length) push(`  Abteilungen: ${depts.join(", ")}`);
      (w.taetigkeiten ?? []).map(x => (x ?? "").trim()).filter(Boolean).forEach(tk => push(`  • ${tk}`));
    }
  }

  // ── Ausbildung ──
  const edu = (data.eduEntries ?? []).filter(e => e.degree || e.institution);
  if (edu.length) {
    push(); push("Ausbildung:");
    for (const e of edu) {
      const deg = e.type === "nursing" ? nursingLabel(e.nursingStatus, e.degree) : e.degree;
      const head = [deg, e.institution].filter(Boolean).join(", ");
      const loc = [e.location, e.country].filter(Boolean).join(", ");
      const r = range(e.start, e.end);
      push(`- ${head}${loc ? ` (${loc})` : ""}${r ? ` | ${r}` : ""}`);
      if (e.abiturFocus) push(`  Schwerpunkt: ${e.abiturFocus}`);
    }
  }

  // ── Sprachen ──
  const langs = (data.langs ?? []).filter(l => l.name);
  if (langs.length) {
    push(); push("Sprachen:");
    for (const l of langs) {
      let note = "";
      if (l.name.toLowerCase().includes("deutsch")) {
        const got = l.b2?.certificateStatus === "got" || l.b1?.certificateStatus === "got";
        if (got) note = " (Zertifikat vorhanden)";
      }
      push(`- ${[l.name, l.level].filter(Boolean).join(": ")}${note}`);
    }
  }

  // ── EDV / Sonstiges ──
  const edv = [...(data.edvSelected ?? []), ...(data.edvCustomInputs ?? [])].map(s => (s ?? "").trim()).filter(Boolean);
  if (edv.length) { push(); push(`EDV-Kenntnisse: ${edv.join(", ")}`); }
  if (data.driverLicense) push(`Führerschein: ${data.driverLicense}`);
  if (data.hobbies) push(`Hobbys/Interessen: ${data.hobbies}`);

  return L.join("\n").trim();
}
