/**
 * lib/pdfOpenFailure.ts — telling apart the ways the page organiser fails to
 * open a PDF, and what each one says to the person reading the screen.
 *
 * WHY THIS EXISTS. The organiser used to catch everything from the fetch to the
 * last thumbnail in one block and print "Could not open this PDF." A sub-admin
 * on an iPhone got that line — and so would an expired token, a
 * password-protected scan, and a browser too old to run pdf.js at all. Nothing
 * could be told apart from a screenshot, which is how that report stayed
 * unexplained: every /api/portal/file request in her session had answered 200,
 * so the one visible fact pointed at the only layer that was fine.
 *
 * Pure, and its own module, so it can be tested in the plain Node test
 * environment without rendering a React tree.
 */

/** Which step was in flight when it broke. */
export type PdfOpenStage = "fetch" | "engine" | "read";

/** What the person reading the screen is actually being told. */
export type PdfOpenFailure = "fetch" | "engine" | "memory" | "locked" | "read";

/**
 * Error names read out of the INSTALLED pdfjs-dist 5.7.284, not remembered.
 * `BaseException` is `function BaseException(message, name) { this.message =
 * message; this.name = name; }`, and each subclass passes its own class name —
 * so `err.name` is reliable even after the bundle is minified.
 *
 *  • `InvalidPDFException`  — the bytes are not a PDF: the FILE.
 *  • `ResponseException`    — pdf.js could not get the bytes: TRANSPORT, the
 *    same conversation as a failed fetch even though it surfaces a step later.
 *  • `PasswordException`    — a locked scan. Nothing here can open it, and
 *    calling it "not a readable PDF" sends the admin hunting the wrong thing.
 *  • `TypeError` / `ReferenceError` — a platform API that does not exist on
 *    this device. This is the iPhone case: `Promise.withResolvers` below iOS
 *    17.4, `structuredClone` below Safari 15.4. A missing API is never the
 *    file's fault, whichever step it lands in.
 *  • `RangeError` / `QuotaExceededError` / an allocation message — the device
 *    refused the memory. A 300-dpi colour scan materialises tens of MB of RGBA
 *    per page to produce a 220 px picture (lib/pdfThumbBudget), so on a phone
 *    this is an ordinary outcome, not an exotic one.
 */
export function classifyPdfOpenFailure(stage: PdfOpenStage, err: unknown): PdfOpenFailure {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof e?.name === "string" ? e.name : "";
  const message = typeof e?.message === "string" ? e.message : "";

  // Memory can land in ANY step, so it is asked first.
  if (name === "QuotaExceededError" || name === "RangeError"
      || /out of memory|allocation (size too large|failed)|array buffer allocation failed|not enough memory/i.test(message)) {
    return "memory";
  }
  // A missing platform API is the device, wherever it shows up.
  if (name === "TypeError" || name === "ReferenceError") return "engine";
  // pdf.js wraps a failed engine bring-up in a plain Error whose name carries
  // nothing: `Setting up fake worker failed: "..."`. Without this line the one
  // failure that IS the browser gets reported as a broken file.
  if (/fake worker|GlobalWorkerOptions\.workerSrc|worker was destroyed/i.test(message)) return "engine";

  if (stage !== "read") return stage;

  if (name === "PasswordException") return "locked";
  if (name === "ResponseException") return "fetch";
  return "read";
}

/**
 * The five messages in the portal's three languages (LAW #19). Kept as data
 * next to the classifier so a new failure kind cannot ship with text in one
 * language, and so a test can read them without rendering anything.
 */
export const PDF_OPEN_FAILURE_TEXT: Record<PdfOpenFailure, { en: string; de: string; fr: string }> = {
  fetch: {
    en: "Could not download this file.",
    de: "Datei konnte nicht geladen werden.",
    fr: "Impossible de télécharger ce fichier.",
  },
  engine: {
    en: "This browser cannot open PDFs here — update it, or use a computer.",
    de: "Dieser Browser kann hier keine PDFs öffnen — bitte aktualisieren oder einen Computer verwenden.",
    fr: "Ce navigateur ne peut pas ouvrir les PDF ici — mettez-le à jour ou utilisez un ordinateur.",
  },
  memory: {
    en: "This device ran out of memory for this PDF — try it on a computer.",
    de: "Diesem Gerät ist bei diesem PDF der Speicher ausgegangen — bitte an einem Computer versuchen.",
    fr: "Cet appareil a manqué de mémoire pour ce PDF — essayez sur un ordinateur.",
  },
  locked: {
    en: "This PDF is password-protected.",
    de: "Dieses PDF ist passwortgeschützt.",
    fr: "Ce PDF est protégé par mot de passe.",
  },
  read: {
    en: "This file is not a readable PDF.",
    de: "Diese Datei ist kein lesbares PDF.",
    fr: "Ce fichier n'est pas un PDF lisible.",
  },
};

/**
 * The visible line: the message for this kind, plus the error's own name in
 * brackets. The name means nothing to the admin, and it is shown anyway — it is
 * the only technical fact that survives a forwarded screenshot, and it is what
 * makes the NEXT report readable in one glance instead of a week.
 */
export function pdfOpenFailureMessage(kind: PdfOpenFailure, lang: string, errName?: string | null): string {
  const t = PDF_OPEN_FAILURE_TEXT[kind] ?? PDF_OPEN_FAILURE_TEXT.read;
  const base = lang === "de" ? t.de : lang === "fr" ? t.fr : t.en;
  return errName ? `${base} (${errName})` : base;
}
