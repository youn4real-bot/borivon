/**
 * In-session rotation cache — single source of truth for a document's CURRENT
 * preview orientation, keyed by the `documents` row id, in degrees (0/90/180/270).
 *
 * WHY THIS EXISTS
 * `documents.rotation` is persisted server-side (PATCH /api/portal/documents/[id]
 * with `deltaRotation`). But the in-memory doc objects held on each page
 * (dashboard, admin, org…) are NOT mutated after a rotate — so closing and
 * reopening a preview in the SAME session would re-seed the STALE pre-rotation
 * value, and the doc would appear un-rotated until a full page reload. That is
 * the "rotation doesn't stick" bug.
 *
 * This module-level Map is the fix: every preview viewer (EmbedPdfViewer,
 * PdfViewer, …) seeds its initial rotation from here — falling back to the
 * server value (`documents.rotation`, passed as `initialRotation`) only when the
 * cache has no entry yet — and bumps it on every rotate. Because it is shared
 * and keyed by doc id, the orientation is consistent across EVERY box and every
 * surface (Essentials, Qualifications, Visum/Bearbeitung slots, passport strip,
 * admin modal…) for the whole session. It is cleared on a full reload, at which
 * point the freshly-fetched `documents.rotation` seeds it again.
 *
 * Degrees, not quarters, so it composes directly with both viewers (EmbedPDF
 * wants quarters = deg/90; pdf.js wants degrees).
 */

const cache = new Map<string, number>();

/** Snap any angle to the nearest 0/90/180/270. */
const norm = (deg: number): number => (((Math.round((deg || 0) / 90) * 90) % 360) + 360) % 360;

/**
 * Current rotation for a doc. Returns the cached in-session value if present,
 * otherwise the supplied server fallback (documents.rotation). Read this at
 * viewer mount to seed the initial orientation.
 */
export function getCachedRotation(docId: string | null | undefined, fallbackDeg: number): number {
  if (docId && cache.has(docId)) return cache.get(docId)!;
  return norm(fallbackDeg);
}

/**
 * Advance a doc's rotation by +90° and store it. Returns the new absolute
 * rotation. Call this on every rotate click, alongside the server PATCH, so the
 * next reopen in this session re-seeds the up-to-date value.
 */
export function bumpCachedRotation(docId: string | null | undefined, fallbackDeg: number): number {
  const next = norm(getCachedRotation(docId, fallbackDeg) + 90);
  if (docId) cache.set(docId, next);
  return next;
}

/** Force the cache to an authoritative value (e.g. after a fresh server fetch). */
export function setCachedRotation(docId: string | null | undefined, deg: number): void {
  if (docId) cache.set(docId, norm(deg));
}
