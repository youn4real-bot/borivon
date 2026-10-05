/**
 * What a storage copy may do, decided from two listings — no bytes, no network.
 *
 * Shared by storage/copy-to-r2.mjs (Supabase -> R2) and
 * storage/copy-back-to-supabase.mjs (R2 -> Supabase, for a rollback). Pure, so
 * tests/storageSyncPlan.test.ts can prove every rule.
 *
 * The rule it replaced was "skip when the sizes match, otherwise overwrite".
 * That failed two ways once the app writes to R2:
 *   • content: a file replaced in place by one of the same byte size counted
 *     as copied, so a re-check reported "fresh" over stale bytes;
 *   • clobbering: re-running the copy after the switch overwrote every R2
 *     object changed since then whose size differed from Supabase's — a newly
 *     signed contract reverted to the unsigned PDF, a new profile photo to the
 *     old one.
 *
 * So now:
 *   same content (etag, else size)        -> skip
 *   different, source changed more recently -> copy
 *   different, target is as new or newer    -> KEEP the target (it was written
 *                                              by the app after the copy; the
 *                                              copy is what is stale)
 *   missing in target, flippedAt given, source predates the flip
 *                                           -> do NOT recreate: before the flip
 *                                              the copy had it, so its absence
 *                                              means the app deleted it since
 *   missing in target otherwise             -> copy
 *
 * `flippedAt` is the moment writes moved to the new side (the FLIP deploy).
 * Without it the plan assumes nothing has been written to the target yet —
 * right for the copy taken during the write freeze, wrong at any later time.
 */

/** Supabase lists eTags quoted ("abc"), R2 bare (abc); multipart suffixes stay. */
export function normEtag(etag) {
  return typeof etag === "string" && etag ? etag.replace(/"/g, "").trim().toLowerCase() || null : null;
}

/** Same bytes, as far as two listings can tell. */
export function sameContent(a, b) {
  if (a.size !== b.size) return false;
  const x = normEtag(a.etag);
  const y = normEtag(b.etag);
  return x && y ? x === y : true;
}

/**
 * @param {Map<string, {size:number, etag?:string|null, updated?:number|null}>} source  key -> object ("<bucket>/<path>")
 * @param {Map<string, {size:number, etag?:string|null, updated?:number|null}>} target
 * @param {{ flippedAt?: number | null }} [opts]  updated / flippedAt are epoch ms
 */
export function planSync(source, target, opts = {}) {
  const flippedAt = Number.isFinite(opts.flippedAt) ? opts.flippedAt : null;
  const plan = { copy: [], same: [], targetNewer: [], notRecreated: [], sizeOnly: 0 };
  for (const [key, s] of source) {
    const t = target.get(key);
    if (!t) {
      if (flippedAt !== null && (s.updated == null || s.updated < flippedAt)) plan.notRecreated.push(key);
      else plan.copy.push(key);
      continue;
    }
    if (sameContent(s, t)) {
      plan.same.push(key);
      if (!normEtag(s.etag) || !normEtag(t.etag)) plan.sizeOnly++;
      continue;
    }
    const known = s.updated != null && t.updated != null;
    if (known && t.updated >= s.updated) plan.targetNewer.push(key);
    // Unknown times after the flip: cannot prove the source is newer, so keep.
    else if (!known && flippedAt !== null) plan.targetNewer.push(key);
    else plan.copy.push(key);
  }
  return plan;
}

/** "2026-09-15T01:30:00Z" -> epoch ms, refusing anything Date cannot read. */
export function parseFlippedAt(value) {
  if (value == null) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`--flipped-at: not a date: ${value}`);
  return ms;
}
