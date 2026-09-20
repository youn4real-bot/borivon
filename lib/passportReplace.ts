/**
 * lib/passportReplace.ts — what the admin's "replace the passport scan" path
 * accepts, what it stores it as, and what it says when it says no.
 *
 * WHY THIS EXISTS. The candidate boxes learned to take a photograph, because
 * she has a phone and not a scanner. The admin's replace path did not: its own
 * ceiling was 10 MB and it refused anything that was not a PDF, in German only
 * ("Nur PDF."). So the moment a nurse photographed her passport, nobody could
 * swap it — not for a clearer picture, not for the right person's passport, not
 * for anything. The one role that exists to fix a bad document could not.
 *
 * Three things had to be decided in one place rather than inline in the route:
 *
 *  1. WHAT COUNTS. The same formats /api/portal/upload accepts for the passport
 *     box, judged by magic bytes rather than by the browser's `file.type`,
 *     which is trivially spoofed and frequently absent when the pick came out
 *     of the Files app.
 *
 *  2. WHAT IT IS CALLED AFTERWARDS. `documents.file_name` is not decoration:
 *     the preview picks its renderer from the extension, and
 *     lib/documentFetch's expectedBodyFor() REFUSES bytes that disagree with
 *     it. Leaving a JPEG on a row still named ".pdf" would have produced a
 *     passport that fails to open, after a replace the admin was told
 *     succeeded — a worse outcome than refusing the photo outright.
 *
 *  3. WHAT SHE IS TOLD. LAW #19: every refusal in French, English and German,
 *     kept as data next to the rule it explains so a new one cannot ship in a
 *     single language.
 *
 * LAW #39 is untouched by all of this and is the reason there is no decoding
 * here: nothing in this module parses, re-encodes or re-saves a passport. It
 * looks at the first twelve bytes, names the format, and the route stores the
 * buffer verbatim.
 *
 * Pure and dependency-light on purpose, so the route, the admin panel and the
 * tests can all share one answer.
 */

import type { DocKind } from "@/lib/docBytes";

/**
 * 25 MB — the SAME ceiling as /api/portal/upload and the login-less /u page.
 *
 * It was 10 MB here. A phone photograph of a passport page at full resolution
 * clears 10 MB without trying, so the widening would have been half a fix: the
 * picker would offer the camera and the server would answer 400 to a perfectly
 * ordinary picture. Three different numbers for the same document is also how
 * "uploading is broken" gets reported — it works, then it does not, and nothing
 * on screen explains which limit was hit.
 */
export const PASSPORT_REPLACE_MAX_BYTES = 25 * 1024 * 1024;

/** The formats a replacement passport scan may be. */
export type PassportReplaceKind = "pdf" | "jpeg" | "png" | "webp";

/**
 * WebP is in the list because the upload route accepts it for the passport box
 * and this path must not be stricter than the one that put the document there.
 * It is safe HERE specifically because a passport is never merged (merge-pdf
 * refuses one outright, LAW #39) — pdf-lib's missing WebP embedder, which is
 * why lib/mergeDocs refuses it, is never reached for this document.
 */
export const PASSPORT_REPLACE_KINDS: readonly PassportReplaceKind[] = ["pdf", "jpeg", "png", "webp"];

export function isPassportReplaceKind(kind: DocKind): kind is PassportReplaceKind {
  return (PASSPORT_REPLACE_KINDS as readonly string[]).includes(kind);
}

/** The extension each accepted format is stored under. */
const EXTENSION_FOR_KIND: Record<PassportReplaceKind, string> = {
  pdf: "pdf",
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

/**
 * The name the row carries after the swap: the existing structured name
 * (LAW #35 — `<firstname>_<lastname>_pflegekraft_reisepass`) with the
 * extension of the bytes that just arrived.
 *
 * Keeping the old extension is not a cosmetic bug. AdminDocPreviewModal picks
 * its renderer from this string, and lib/documentFetch's expectedBodyFor()
 * demands a PDF body for a ".pdf" name and throws on anything else — so a JPEG
 * filed as ".pdf" opens as a failure message on a document the admin was just
 * told had been replaced. The bytes decide the name.
 *
 * Only a recognised document extension is replaced. A name that never had one,
 * or ends in something we do not recognise, keeps every character it had and
 * gains the right suffix.
 */
export function passportReplaceFileName(
  oldName: string | null | undefined,
  kind: PassportReplaceKind,
): string {
  const ext = EXTENSION_FOR_KIND[kind];
  const base = (oldName ?? "").trim() || "reisepass";
  const stem = base.replace(/\.(pdf|jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i, "");
  return `${stem || "reisepass"}.${ext}`;
}

/** Why a replacement was refused. */
export type PassportReplaceRefusal =
  | "file_missing"
  | "format"
  | "too_large"
  | "archive_failed"
  | "save_failed";

/**
 * Every refusal in the portal's three languages (LAW #19). Kept as data beside
 * the rules above so a new one cannot ship with text in German only — which is
 * exactly what "Nur PDF." was, on the one screen a French-speaking sub-admin
 * would have met it.
 *
 * Each sentence names the way out, because a refusal that only says "no" sends
 * the admin to WhatsApp to ask the founder what to do.
 */
export const PASSPORT_REPLACE_REFUSAL_TEXT: Record<
  PassportReplaceRefusal,
  { en: string; de: string; fr: string }
> = {
  file_missing: {
    en: "No file arrived — pick the scan or photo again.",
    de: "Es ist keine Datei angekommen — bitte den Scan oder das Foto erneut auswählen.",
    fr: "Aucun fichier n'est arrivé — sélectionnez à nouveau le scan ou la photo.",
  },
  format: {
    en: "This file is neither a PDF nor a photo. Use a PDF, or a JPEG, PNG or WebP picture.",
    de: "Diese Datei ist weder ein PDF noch ein Foto. Bitte ein PDF oder ein JPEG-, PNG- oder WebP-Bild verwenden.",
    fr: "Ce fichier n'est ni un PDF ni une photo. Utilisez un PDF, ou une image JPEG, PNG ou WebP.",
  },
  too_large: {
    en: "This file is over 25 MB. Photograph the page again at a lower resolution.",
    de: "Diese Datei ist größer als 25 MB. Bitte die Seite mit geringerer Auflösung erneut fotografieren.",
    fr: "Ce fichier dépasse 25 Mo. Photographiez la page à nouveau en résolution plus basse.",
  },
  archive_failed: {
    en: "The previous scan could not be archived — nothing was changed. Please try again.",
    de: "Der alte Scan konnte nicht archiviert werden — nichts wurde geändert. Bitte erneut versuchen.",
    fr: "L'ancien scan n'a pas pu être archivé — rien n'a été modifié. Veuillez réessayer.",
  },
  save_failed: {
    en: "The replacement could not be saved. Please try again.",
    de: "Die Ersetzung konnte nicht gespeichert werden. Bitte erneut versuchen.",
    fr: "Le remplacement n'a pas pu être enregistré. Veuillez réessayer.",
  },
};

/** The refusal in the reader's language, falling back to English. */
export function passportReplaceRefusalText(code: string | null | undefined, lang: string): string | null {
  const t = PASSPORT_REPLACE_REFUSAL_TEXT[code as PassportReplaceRefusal];
  if (!t) return null;
  return lang === "de" ? t.de : lang === "fr" ? t.fr : t.en;
}
