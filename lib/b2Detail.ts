/**
 * Server-safe reader for the RICH German-exam detail the candidate fills inside
 * the CV builder (cv_draft.langs → the "Deutsch" entry → its b1/b2 panel). This
 * is the real B2 truth — which exam (Goethe/telc/ÖSD), when it's planned, slot
 * confirmed & paid vs still registering, passed/partial/failed, per-module
 * dates, certificate received/expected, planned retake. The pipeline b2_stage
 * is just a coarse manual flag; THIS is the detail the admin actually wants.
 *
 * Mirrors components/CVDocument.tsx formatDeutschDetail() (German output), but
 * lives in lib/ so API routes can use it without importing the @react-pdf doc.
 */

export type MonthYear = { month?: string; year?: string };
export type RegStatus = "expected" | "confirmed" | null;

export interface B2Detail {
  written?: "yes" | "no" | null;
  result?: "full" | "partial" | "failed" | "waiting" | null;
  pruefung?: "telc" | "goethe" | "oesd" | null;
  certificateStatus?: "got" | "waiting" | null;
  certificateDate?: MonthYear;
  certificateExpectedDate?: MonthYear;
  notYetDate?: MonthYear;
  notYetRegStatus?: RegStatus;
  retakeDate?: MonthYear;
  retakeRegStatus?: RegStatus;
  modules?: Record<string, { passed?: boolean; passedDate?: MonthYear; expectedDate?: MonthYear; expectedRegStatus?: RegStatus }>;
  examConfirmation?: { fileName?: string; uploadedAt?: string };
}

const my = (m: MonthYear | undefined): string =>
  !m || (!m.month && !m.year) ? "" : `${m.month || "??"}/${m.year || "????"}`;
const reg = (s: RegStatus): string =>
  s === "confirmed" ? "Platz bestätigt & bezahlt" : s === "expected" ? "Anmeldung läuft" : "";
const examLabel = (p: B2Detail["pruefung"]): string =>
  p === "goethe" ? "Goethe-Zertifikat" : p === "telc" ? "telc Deutsch" : p === "oesd" ? "ÖSD" : "";

/** Human German summary of a single B1/B2 detail block (or "" if empty). */
export function formatB2Detail(b: B2Detail | undefined, level: "B1" | "B2"): string {
  if (!b) return "";
  const exam = examLabel(b.pruefung ?? null);
  const head = exam ? `${exam} ${level}` : `Deutsch ${level}`;

  if (b.written === "no") {
    const parts: string[] = [];
    const date = my(b.notYetDate);
    if (date) parts.push(`Prüfung geplant ${date}`); else parts.push("Prüfung noch nicht angesetzt");
    const r = reg(b.notYetRegStatus ?? null);
    if (r) parts.push(`(${r})`);
    // When the seat is confirmed & paid, surface whether the proof is on file.
    if (b.notYetRegStatus === "confirmed") {
      parts.push(b.examConfirmation?.fileName ? "· Bestätigung hochgeladen" : "· Bestätigung fehlt");
    }
    return `${head} · ${parts.join(" ")}`;
  }
  if (b.written === "yes" && b.result === "full") {
    const certDate = my(b.certificateDate);
    if (b.certificateStatus === "got" && certDate) return `${head} bestanden · Zertifikat ${certDate}`;
    if (b.certificateStatus === "got") return `${head} bestanden · Zertifikat erhalten`;
    if (b.certificateStatus === "waiting") {
      const exp = my(b.certificateExpectedDate);
      return exp ? `${head} bestanden · Zertifikat erwartet ${exp}` : `${head} bestanden · Zertifikat in Bearbeitung`;
    }
    return `${head} · bestanden`;
  }
  if (b.written === "yes" && b.result === "partial" && b.modules) {
    const MOD: Record<string, string> = { lesen: "Lesen", hoeren: "Hören", schreiben: "Schreiben", sprechen: "Sprechen", schriftlich: "Schriftlich", muendlich: "Mündlich" };
    const passed: string[] = [], planned: string[] = [];
    for (const [key, m] of Object.entries(b.modules)) {
      const label = MOD[key] ?? key;
      if (m.passed) { const d = my(m.passedDate); passed.push(d ? `${label} ${d}` : label); }
      else if (m.expectedDate?.month || m.expectedDate?.year) {
        const d = my(m.expectedDate); const r = reg(m.expectedRegStatus ?? null);
        planned.push(r ? `${label} ${d} (${r})` : `${label} ${d}`);
      }
    }
    const segs: string[] = [];
    if (passed.length) segs.push(`bestanden: ${passed.join(", ")}`);
    if (planned.length) segs.push(`offen: ${planned.join(", ")}`);
    return segs.length ? `${head} teilbestanden · ${segs.join(" · ")}` : `${head} teilbestanden`;
  }
  if (b.written === "yes" && b.result === "failed") {
    const date = my(b.retakeDate); const r = reg(b.retakeRegStatus ?? null);
    if (date && r) return `${head} nicht bestanden · Nachprüfung ${date} (${r})`;
    if (date) return `${head} nicht bestanden · Nachprüfung ${date}`;
    return `${head} nicht bestanden`;
  }
  if (b.written === "yes" && b.result === "waiting") return `${head} · Prüfung abgelegt, Ergebnis ausstehend`;
  return "";
}

/** Pull the Deutsch level + its detail block out of a raw cv_draft JSON. */
export function extractGerman(cvDraft: unknown): { level: string | null; detail: B2Detail | null } {
  const draft = cvDraft as { langs?: unknown } | null;
  const langs = draft && Array.isArray(draft.langs) ? draft.langs : [];
  const de = (langs as { name?: string; level?: string; b1?: B2Detail; b2?: B2Detail }[]).find((l) => l && l.name === "Deutsch");
  if (!de) return { level: null, detail: null };
  const level = typeof de.level === "string" && de.level ? de.level : null;
  const detail = level === "B1" ? (de.b1 ?? null) : level === "B2" ? (de.b2 ?? null) : null;
  return { level, detail };
}

/** One-line rich German status from a cv_draft (level + formatted detail). */
export function germanSummary(cvDraft: unknown): { level: string | null; summary: string } {
  const { level, detail } = extractGerman(cvDraft);
  if (!level) return { level: null, summary: "" };
  if (level !== "B1" && level !== "B2") return { level, summary: `Deutsch ${level}` };
  const s = formatB2Detail(detail ?? undefined, level);
  return { level, summary: s || `Deutsch ${level} — noch keine Prüfungsdetails` };
}
