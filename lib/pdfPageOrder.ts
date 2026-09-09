/**
 * lib/pdfPageOrder.ts — the pure core of the PDF page organiser.
 *
 * Scans arrive with pages in the wrong order, upside down, or with a blank sheet
 * in the middle. This validates a requested arrangement BEFORE any bytes are
 * rewritten, so a malformed request can never produce a corrupted document or
 * silently drop somebody's page.
 *
 * The arrangement is expressed as a list of source page indices, in the order
 * they should appear, each with an optional rotation:
 *   [{from: 2}, {from: 0, rotate: 90}, {from: 1}]
 * Omitting a page DELETES it (that's how a blank scan sheet is removed) — which
 * is exactly why dropping every page must be refused.
 */

export type PageOp = {
  /** 0-based index of the page in the SOURCE document. */
  from: number;
  /** Extra clockwise rotation in degrees; normalised to 0/90/180/270. */
  rotate: number;
};

export type PageOrderResult =
  | { ok: true; pages: PageOp[]; removed: number[] }
  | { ok: false; error: string };

/** Degrees → 0/90/180/270 (accepts negatives and multiples of 360). */
export function normalizeRotation(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
  if (n % 90 !== 0) return 0;          // anything not a quarter turn is ignored
  return ((n % 360) + 360) % 360;
}

/**
 * Validate a requested arrangement against the real page count.
 *
 * Rejects: a non-array, an empty result (a document with no pages is not a
 * document), an out-of-range index, and a repeated index — duplication would
 * silently multiply a page and is never what a page organiser means.
 */
export function validatePageOrder(order: unknown, pageCount: number): PageOrderResult {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: "Source document has no pages" };
  }
  if (!Array.isArray(order)) {
    return { ok: false, error: "order must be an array" };
  }
  if (order.length === 0) {
    return { ok: false, error: "Cannot remove every page" };
  }
  if (order.length > pageCount) {
    return { ok: false, error: "More pages requested than the document has" };
  }

  const pages: PageOp[] = [];
  const seen = new Set<number>();
  for (const raw of order) {
    const item = (typeof raw === "number" ? { from: raw } : raw) as { from?: unknown; rotate?: unknown };
    const from = typeof item?.from === "number" ? item.from : NaN;
    if (!Number.isInteger(from) || from < 0 || from >= pageCount) {
      return { ok: false, error: `Page index out of range: ${String(item?.from)}` };
    }
    if (seen.has(from)) {
      return { ok: false, error: `Page ${from + 1} listed more than once` };
    }
    seen.add(from);
    pages.push({ from, rotate: normalizeRotation(item?.rotate) });
  }

  const removed: number[] = [];
  for (let i = 0; i < pageCount; i++) if (!seen.has(i)) removed.push(i);

  return { ok: true, pages, removed };
}

/** True when the arrangement is identical to the source (nothing to rewrite). */
export function isUnchanged(pages: PageOp[], pageCount: number): boolean {
  if (pages.length !== pageCount) return false;
  return pages.every((p, i) => p.from === i && p.rotate === 0);
}
