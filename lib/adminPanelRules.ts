/**
 * Small decision cores lifted out of app/portal/admin/page.tsx.
 *
 * That page is a 9,000-line client component, so every rule buried in it is
 * unreachable from the test suite: the failure paths are React state writes
 * into JSX and vitest runs in plain Node with no jsdom. The rules here are the
 * ones where getting the answer wrong is expensive, so they live where they can
 * actually be driven, one input at a time.
 */

import type { Lang } from "@/lib/translations";

/**
 * Did the "which agencies can see this candidate" read leave the answer
 * UNKNOWN?
 *
 * `GET /api/portal/admin/partner-share` used to be treated as all-or-nothing:
 * any non-OK response cleared partnerOrgs, and an empty partnerOrgs renders no
 * share buttons at all — indistinguishable from a candidate no agency has ever
 * been sent. The founder then answers "can Calmaroi see her?" from a blank
 * space that means "I could not check", and a partner's API access is granted
 * or withheld on that guess.
 *
 * 403 is the one status that genuinely means "none of your business, and that
 * is the final answer": the route refuses agency admins outright, because
 * letting a partner's own admin press Send-to would let them grant themselves
 * candidates (LAW #25), and it refuses candidates outside the caller's scope.
 * For those callers the control is absent by design and a warning on every
 * dossier would be noise.
 *
 * @param status HTTP status, or null when the request never completed
 *               (offline, DNS, the Worker never answered).
 */
export function shareReadIsUnknown(status: number | null): boolean {
  if (status === null) return true;   // nothing came back — nothing is known
  if (status === 403) return false;   // refused on purpose; the absence IS the answer
  return status < 200 || status > 299;
}

/** What a file dropped on a document box or a slot row may do. */
export type SlotDropVerdict =
  | { ok: true }
  | { ok: false; reason: DropRefusal };

export type DropRefusal = "no-file" | "not-pdf" | "not-a-document";

/** What a given drop target takes. It mirrors the `accept` on that target's own
 *  file picker: what you can pick is what you can drop, or the two disagree and
 *  one of them is a trap. */
export type DropAccepts = "pdf" | "pdf-or-photo";

const PHOTO_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const PHOTO_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

/** MIME types a browser hands over when it genuinely does not know. A PDF
 *  dragged out of a mail client or a file manager routinely arrives as one of
 *  these, and refusing it on the strength of an absent MIME would refuse the
 *  very file the row wants. The server sniffs the first bytes either way. */
const UNKNOWN_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/**
 * Decide what a drop on a Bearbeitung / Visum slot row does.
 *
 * The handlers used to read `if (file && file.type === "application/pdf")` with
 * no else at all: drop a JPEG on a slot and nothing happened — no spinner, no
 * upload, no refusal, not even the drag highlight clearing into anything. It
 * was indistinguishable from a drag the page had not noticed, so the founder
 * dropped the same photo again and again.
 *
 * These rows stay PDF-only, deliberately and separately from the photo-friendly
 * Essentials boxes: the slot template is read by detectAcroFormFields() and the
 * original/translated pair is merged, both through pdf-lib, which has no JPEG
 * decoder. A photo here would upload and then break the merge with a bare 500 —
 * trading one silent failure for a louder one. It matches the row's own picker,
 * which asks for `.pdf,application/pdf`. So: refuse, and say why.
 */
export function slotDropVerdict(
  file: { type?: string | null; name?: string | null } | null | undefined,
  accepts: DropAccepts = "pdf",
): SlotDropVerdict {
  if (!file) return { ok: false, reason: "no-file" };
  const type = (file.type ?? "").trim().toLowerCase();
  const name = (file.name ?? "").trim().toLowerCase();
  const isPdf = type === "application/pdf" || type === "application/x-pdf"
    // Unknown MIME + a .pdf name is a PDF as far as this target is concerned;
    // the upload route sniffs the first bytes and answers with its own message
    // if it turns out not to be. Refusing on an absent MIME would refuse the
    // very file the row wants — mail clients and file managers hand over
    // plenty of real PDFs with no type at all.
    || (UNKNOWN_MIMES.has(type) && name.endsWith(".pdf"));
  if (isPdf) return { ok: true };
  if (accepts === "pdf-or-photo") {
    const isPhoto = PHOTO_MIMES.has(type)
      || (UNKNOWN_MIMES.has(type) && PHOTO_EXTS.some(ext => name.endsWith(ext)));
    if (isPhoto) return { ok: true };
    return { ok: false, reason: "not-a-document" };
  }
  return { ok: false, reason: "not-pdf" };
}

/**
 * Why the drop was refused, in the admin's own language (LAW #19).
 *
 * It names the alternative rather than just saying no: a photographed document
 * that has no box of its own belongs in Sonstiges, whose picker and server
 * route both take images.
 */
export function slotDropRefusalMessage(reason: DropRefusal, lang: Lang): string {
  if (reason === "no-file") {
    return lang === "de" ? "Es wurde keine Datei erkannt — bitte erneut ablegen."
      : lang === "fr" ? "Aucun fichier détecté — déposez-le à nouveau."
      : "No file came through — drop it again.";
  }
  if (reason === "not-a-document") {
    return lang === "de" ? "Nur PDF oder Foto (JPG, PNG, WebP) möglich."
      : lang === "fr" ? "Seuls un PDF ou une photo (JPG, PNG, WebP) sont acceptés."
      : "Only a PDF or a photo (JPG, PNG, WebP) can go here.";
  }
  return lang === "de"
    ? "Dieser Schritt nimmt nur PDF. Ein Foto bitte unter Sonstiges ablegen."
    : lang === "fr"
      ? "Cette étape n'accepte que des PDF. Déposez une photo dans Sonstiges."
      : "This step takes PDF only. Drop a photo in Sonstiges instead.";
}
