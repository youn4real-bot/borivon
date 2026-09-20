/**
 * lib/documentFetch.ts — WHAT ACTUALLY CAME BACK, decided before anything in
 * the portal treats it as a file.
 *
 * WHY THIS EXISTS. Every document viewer here used to do exactly this:
 *
 *     fetch(url, { headers: { Authorization: … } })
 *       .then(r => r.blob())
 *       .then(blob => setBlobUrl(URL.createObjectURL(blob)))
 *
 * `r.blob()` NEVER THROWS ON AN ERROR STATUS. A 401, a 404, a 500 carrying an
 * HTML error page, a Worker exception page, a JSON `{"error":"…"}` — every one
 * of them produces a perfectly good Blob, gets a blob: URL, and is handed to a
 * renderer as though it were the document. What the person sees is then decided
 * by which renderer happened to get it:
 *
 *   • pdf.js is handed the five bytes "Unaut…" → it throws deep inside the
 *     parser and PdfViewer printed the single English line "Preview not
 *     available", which blames the FILE when the fault was the SESSION;
 *   • an <img> is handed an HTML error page → a broken-image glyph, no words;
 *   • the iOS native frame is handed the same → WebKit renders the error page
 *     as a web page, which is the "garbled document" in the report;
 *   • and when the fetch REJECTED outright, the old code only called
 *     console.error, left `blobUrl` null, and the modal sat on its spinner
 *     forever. That is the "endless spinner".
 *
 * So the bytes are inspected once, here, and a failure is named by LAYER:
 *
 *   download — the server never handed the document over (bad status, or the
 *              request never completed at all).
 *   content  — the server answered 200 with a MESSAGE (HTML / JSON / plain
 *              text) instead of a file. Its own layer because the status line
 *              looks healthy and only the body gives it away.
 *   engine   — this browser cannot run the PDF engine (an old iPhone).
 *   locked   — a password-protected PDF. Nothing here can open it, and calling
 *              it unreadable sends the admin hunting the wrong thing.
 *   parse    — real document bytes the engine could not read: a truncated
 *              scan, a corrupt file.
 *
 * Only `download` and `content` can be decided from the response; the rest are
 * classified from whatever pdf.js throws afterwards (`classifyOpenError`).
 *
 * Pure decision core plus a thin IO wrapper, so the five shapes that broke in
 * production — 401, 404, 500-with-HTML, 200-with-a-JSON-error, and a truncated
 * PDF — are testable in the plain-Node vitest environment with no DOM.
 */

/** Which layer said no. Picks the sentence shown to the person. */
export type DocFailureLayer = "download" | "content" | "engine" | "locked" | "parse";

/** How many leading bytes are enough to tell a document from an error page. */
export const SNIFF_BYTES = 1024;

/** What the body looks like, judged from the bytes rather than the header. */
export type DocumentBodyKind =
  | "pdf" | "image" | "zip" | "markup" | "json" | "text" | "empty" | "binary";

/** What the caller intends to render, which decides how strict the sniff is. */
export type ExpectedBody = "pdf" | "binary";

/** A named layer plus the one technical fact worth photographing. */
export type DocumentFailure = {
  layer: DocFailureLayer;
  /** Shown in brackets: "HTTP 404", "text/html", "empty". Never translated. */
  detail: string;
};

/** The only parts of a Response the decision core needs. */
export type ResponseFacts = {
  ok: boolean;
  status: number;
  /** Raw Content-Type header, or null. Used for the DETAIL, never the verdict. */
  contentType: string | null;
};

/** Does `head` start with these bytes, at `at`? */
function startsWith(head: Uint8Array, bytes: number[], at = 0): boolean {
  if (head.length < at + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (head[at + i] !== bytes[i]) return false;
  return true;
}

/**
 * Classify the first bytes of a body.
 *
 * The HEADER is deliberately not consulted for the verdict: a perfectly good
 * PDF is regularly served as `application/octet-stream` (Drive does it), and an
 * error page is regularly served as `application/pdf` by a proxy that copied
 * the upstream headers. The bytes are the only honest witness.
 */
export function sniffDocumentBody(head: Uint8Array): DocumentBodyKind {
  if (head.length === 0) return "empty";
  const win = head.subarray(0, SNIFF_BYTES);

  // `%PDF-` may be preceded by junk. Acrobat itself scans the first 1024 bytes
  // for it and pdf.js copies that tolerance, so a strict offset-0 test would
  // reject files that open fine in every other reader.
  for (let i = 0; i + 4 < win.length; i++) {
    if (win[i] === 0x25 && win[i + 1] === 0x50 && win[i + 2] === 0x44
      && win[i + 3] === 0x46 && win[i + 4] === 0x2d) return "pdf";
  }

  // The binary formats the upload route accepts. Recognised EXPLICITLY rather
  // than by "has a high byte somewhere", because a short GIF or a RIFF header
  // can be entirely printable ASCII and would otherwise be mistaken for an
  // error message — the exact inversion of the bug this module exists for.
  if (startsWith(win, [0x89, 0x50, 0x4e, 0x47])) return "image";               // PNG
  if (startsWith(win, [0xff, 0xd8, 0xff])) return "image";                     // JPEG
  if (startsWith(win, [0x47, 0x49, 0x46, 0x38])) return "image";               // GIF8
  if (startsWith(win, [0x42, 0x4d])) return "image";                           // BMP
  if (startsWith(win, [0x52, 0x49, 0x46, 0x46])
    && startsWith(win, [0x57, 0x45, 0x42, 0x50], 8)) return "image";           // RIFF….WEBP
  if (startsWith(win, [0x00, 0x00, 0x00]) && startsWith(win, [0x66, 0x74, 0x79, 0x70], 4)
    && startsWith(win, [0x68, 0x65, 0x69], 8)) return "image";                 // HEIC (ftypheic/heix)
  if (startsWith(win, [0x50, 0x4b, 0x03, 0x04])) return "zip";                 // .docx / .xlsx

  // Skip a BOM and leading whitespace before judging the first character —
  // Worker error pages and pretty-printed JSON often begin with a newline, and
  // not skipping it mislabels both as binary.
  let i = 0;
  if (startsWith(win, [0xef, 0xbb, 0xbf])) i = 3;
  while (i < win.length && (win[i] === 0x20 || win[i] === 0x09 || win[i] === 0x0a || win[i] === 0x0d)) i++;
  if (i >= win.length) return "empty";

  const first = win[i];
  if (first === 0x3c) return "markup";                      // <!DOCTYPE html>, <html>, <?xml, <Error>
  if (first === 0x7b || first === 0x5b) return "json";      // { or [

  // Everything printable and no NUL → a plain-text message. Cloudflare's and
  // Next's bare bodies ("Internal Server Error", "error code: 1015") are exactly
  // this, and they are what rendered as a garbled "document".
  for (let j = i; j < win.length; j++) {
    const b = win[j];
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20 || b >= 0x80) return "binary";
  }
  return "text";
}

/** A Content-Type worth printing in brackets, stripped of its charset. */
function typeDetail(contentType: string | null, fallback: string): string {
  const base = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return base || fallback;
}

/**
 * May these bytes be handed to a renderer? Returns null when they may, and the
 * named layer when they may not. Pure: the caller supplies the response facts
 * and the first `SNIFF_BYTES` of the body.
 */
export function verifyDocumentResponse(
  res: ResponseFacts,
  head: Uint8Array,
  expect: ExpectedBody,
): DocumentFailure | null {
  // The STATUS is the whole diagnosis when it is not 2xx: 401 is an expired
  // session, 403 is LAW #25 scope, 404 is a row whose Drive file moved, 5xx is
  // us. It goes in the detail because it is the only technical fact that
  // survives a screenshot forwarded from a phone.
  if (!res.ok) return { layer: "download", detail: `HTTP ${res.status}` };

  const body = sniffDocumentBody(head);
  if (body === "empty") {
    // 200 with nothing in it. The old code made a 0-byte blob URL from this and
    // the viewer spun on it. It is a download failure, not a bad file.
    return { layer: "download", detail: "empty" };
  }
  if (body === "markup" || body === "json" || body === "text") {
    // 200 and a MESSAGE. This is the shape that produced the "garbled page":
    // an HTML error page rendered by the native iOS frame as a web page.
    return { layer: "content", detail: typeDetail(res.contentType, body) };
  }
  if (expect === "pdf" && body !== "pdf") {
    // Real bytes, real file, wrong kind. This one IS about the file, so it is
    // reported as a read failure rather than blamed on the server.
    return { layer: "parse", detail: typeDetail(res.contentType, body) };
  }
  return null;
}

/**
 * Turn whatever the PDF engine threw into a layer.
 *
 * Error names read out of pdfjs-dist 5.7.284: `BaseException` is
 * `function BaseException(message, name) { … }` and each subclass passes its own
 * class name, so `err.name` stays reliable after minification.
 *
 *  • MissingPDFException / UnexpectedResponseException — pdf.js fetched the URL
 *    itself and the server said no. Transport, i.e. the download layer, even
 *    though it surfaces a step later than our own fetch would have.
 *  • PasswordException — locked. Nothing here can open it.
 *  • TypeError / ReferenceError — a platform API that does not exist on this
 *    device: `Promise.withResolvers` below iOS 17.4, `structuredClone` below
 *    Safari 15.4. A missing API is never the file's fault.
 *  • a "fake worker" message — pdf.js's own engine bring-up failed, and it
 *    reports that in a plain Error whose name carries nothing. Without this
 *    line the one failure that IS the browser gets reported as a broken file.
 */
export function classifyOpenError(err: unknown): DocFailureLayer {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof e?.name === "string" ? e.name : "";
  const message = typeof e?.message === "string" ? e.message : "";

  if (name === "TypeError" || name === "ReferenceError") return "engine";
  if (/fake worker|GlobalWorkerOptions\.workerSrc|worker was destroyed/i.test(message)) return "engine";
  if (name === "PasswordException") return "locked";
  if (name === "MissingPDFException" || name === "UnexpectedResponseException"
    || name === "ResponseException") return "download";
  return "parse";
}

/**
 * The five sentences in the portal's three languages (LAW #19). Kept as data so
 * a new layer cannot ship with text in one language, and so a test can read
 * them without rendering anything.
 */
export const DOC_FAILURE_TEXT: Record<DocFailureLayer, { en: string; de: string; fr: string }> = {
  download: {
    en: "Could not download this file.",
    de: "Datei konnte nicht geladen werden.",
    fr: "Impossible de télécharger ce fichier.",
  },
  content: {
    en: "The server sent an error instead of the document — please try again.",
    de: "Der Server hat einen Fehler statt des Dokuments gesendet — bitte erneut versuchen.",
    fr: "Le serveur a renvoyé une erreur au lieu du document — veuillez réessayer.",
  },
  engine: {
    en: "This browser cannot open PDFs here — update it, or use a computer.",
    de: "Dieser Browser kann hier keine PDFs öffnen — bitte aktualisieren oder einen Computer verwenden.",
    fr: "Ce navigateur ne peut pas ouvrir les PDF ici — mettez-le à jour ou utilisez un ordinateur.",
  },
  locked: {
    en: "This PDF is password-protected.",
    de: "Dieses PDF ist passwortgeschützt.",
    fr: "Ce PDF est protégé par mot de passe.",
  },
  parse: {
    en: "This file is not a readable PDF.",
    de: "Diese Datei ist kein lesbares PDF.",
    fr: "Ce fichier n'est pas un PDF lisible.",
  },
};

/**
 * The visible line: the sentence for this layer, plus the one technical fact in
 * brackets. The detail means nothing to the admin and is shown anyway — it is
 * the only part that survives a forwarded screenshot, and it is what makes the
 * NEXT report readable in one glance instead of a week.
 */
export function docFailureMessage(layer: DocFailureLayer, lang: string, detail?: string | null): string {
  const t = DOC_FAILURE_TEXT[layer] ?? DOC_FAILURE_TEXT.parse;
  const base = lang === "de" ? t.de : lang === "fr" ? t.fr : t.en;
  return detail ? `${base} (${detail})` : base;
}

/** Thrown by fetchDocumentBlob. Carries the layer, so callers never guess. */
export class DocumentFetchError extends Error {
  readonly layer: DocFailureLayer;
  readonly detail: string;
  /** The server's own error code, present only when the caller asked for the
   *  error body (see `readErrorBody`). It tells a REFUSAL, which has its own
   *  sentence, apart from a fault, which gets the layer sentence. */
  readonly code?: string;
  constructor(failure: DocumentFailure, code?: string) {
    super(`${failure.layer}: ${failure.detail}`);
    // `name` is what gets printed in brackets and read off a screenshot. Make
    // it the fact, not the word "Error".
    this.name = failure.detail;
    this.layer = failure.layer;
    this.detail = failure.detail;
    this.code = code;
  }
}

/**
 * Fetch a document and hand back its bytes ONLY if they are a document.
 *
 * Throws `DocumentFetchError` for every failure except an abort, which is
 * re-thrown untouched so a caller's cleanup still recognises it.
 *
 * The head is read through `blob.slice(0, SNIFF_BYTES)` rather than buffering
 * the whole response into an ArrayBuffer first: a 25 MB passport scan on a
 * phone must not be materialised twice just to look at five bytes.
 */
export async function fetchDocumentBlob(
  url: string,
  init: RequestInit,
  expect: ExpectedBody,
  opts?: {
    /** Read a refused response's small JSON body and carry its `error` code
     *  on the thrown DocumentFetchError. Only for routes of ours that answer
     *  a refusal that way; everything else leaves the body on the wire. */
    readErrorBody?: boolean;
  },
): Promise<{ blob: Blob; contentDisposition: string | null }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") throw e;
    // The request never completed, so there is no status to report. Say which
    // layer instead of letting the caller print "TypeError: Failed to fetch".
    throw new DocumentFetchError({ layer: "download", detail: "network" });
  }

  // Do not even read the body of an error response: it is a message, and
  // downloading it over mobile data helps nobody.
  if (!res.ok) {
    const code = opts?.readErrorBody
      ? await res.json().then((b: { error?: string }) => b?.error).catch(() => undefined)
      : undefined;
    throw new DocumentFetchError({ layer: "download", detail: `HTTP ${res.status}` }, code);
  }

  const facts: ResponseFacts = {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get("Content-Type"),
  };
  const blob = await res.blob();
  const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
  const failure = verifyDocumentResponse(facts, head, expect);
  if (failure) throw new DocumentFetchError(failure);

  return { blob, contentDisposition: res.headers.get("Content-Disposition") };
}

/**
 * Is this file name one the viewers open as a PDF? Decides `expect` at the call
 * sites, which otherwise re-derive the extension three different ways.
 */
export function expectedBodyFor(fileName: string | null | undefined): ExpectedBody {
  return (fileName ?? "").split(".").pop()?.toLowerCase() === "pdf" ? "pdf" : "binary";
}
