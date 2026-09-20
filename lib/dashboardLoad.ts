/**
 * Loading the candidate dashboard's Bearbeitung / Visum slots — and the one
 * distinction the old code could not make: EMPTY is not BROKEN.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT: loadDynamicSlots did
 *
 *     const beaJ = beaRes.ok ? await beaRes.json() : { slots: [] };
 *
 * and then set `dynamicSlotsLoaded = true` regardless. A 500 from
 * /api/portal/phase-slots therefore rendered exactly what a correctly-empty
 * account renders — "Documents being configured." — while every Bearbeitung and
 * Visum box a nurse had already filled simply vanished from her screen. A
 * network reject was worse still: an empty phase with no sentence at all.
 *
 * So the result type here has no "empty-ish" middle. Either both slot reads
 * succeeded and the lists are real, or the load FAILED and the page must say so
 * and offer a retry.
 */

/** `null` status = the request never produced a response (offline / DNS / abort). */
export type SlotsLoadFailure = { ok: false; status: number | null };

export type SlotsLoadSuccess<S, C> = {
  ok: true;
  bea: S[];
  vis: S[];
  catsBea: C[];
  catsVis: C[];
  /** Admin-defined Visum ordering; null when that read failed (use the default). */
  visumOrder: string[] | null;
};

export type SlotsLoadResult<S, C> = SlotsLoadSuccess<S, C> | SlotsLoadFailure;

type Json = Record<string, unknown> | null;

async function readJson(r: Response | null): Promise<Json> {
  if (!r || !r.ok) return null;
  try { return (await r.json()) as Json; } catch { return null; }
}

function arr<T>(j: Json, field: string): T[] {
  const v = j?.[field];
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Fetch everything the two dynamic phases need.
 *
 * The two /phase-slots reads are LOAD-BEARING: if either fails the whole load
 * is a failure, because a half-populated phase is indistinguishable from a
 * phase whose boxes were deleted.
 *
 * Categories and the Visum doc order are genuinely optional — they only affect
 * grouping and ordering, so a failure there degrades to a flat list in default
 * order rather than hiding a nurse's documents.
 */
export async function fetchPhaseSlots<S, C>(
  fetchImpl: typeof fetch,
  token: string,
): Promise<SlotsLoadResult<S, C>> {
  if (!token) return { ok: false, status: null };
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const settle = (p: Promise<Response>) => p.then(r => r, () => null);

  let bea: Response | null, vis: Response | null;
  let beaCat: Response | null, visCat: Response | null, ord: Response | null;
  try {
    [bea, vis, beaCat, visCat, ord] = await Promise.all([
      settle(fetchImpl("/api/portal/phase-slots?phase=bearbeitung", auth)),
      settle(fetchImpl("/api/portal/phase-slots?phase=visum", auth)),
      settle(fetchImpl("/api/portal/phase-slot-categories?phase=bearbeitung", auth)),
      settle(fetchImpl("/api/portal/phase-slot-categories?phase=visum", auth)),
      settle(fetchImpl("/api/portal/phase-doc-order", auth)),
    ]);
  } catch {
    return { ok: false, status: null };
  }

  if (!bea || !bea.ok) return { ok: false, status: bea ? bea.status : null };
  if (!vis || !vis.ok) return { ok: false, status: vis ? vis.status : null };

  const beaJ = await readJson(bea);
  const visJ = await readJson(vis);
  // A 200 whose body will not parse is a broken read, not an empty account.
  if (beaJ === null || visJ === null) return { ok: false, status: 200 };

  const orderJ = await readJson(ord);
  const orders = orderJ?.orders as { visum?: unknown } | undefined;

  return {
    ok: true,
    bea: arr<S>(beaJ, "slots"),
    vis: arr<S>(visJ, "slots"),
    catsBea: arr<C>(await readJson(beaCat), "categories"),
    catsVis: arr<C>(await readJson(visCat), "categories"),
    visumOrder: Array.isArray(orders?.visum) ? (orders!.visum as string[]) : null,
  };
}

/**
 * What a phase with no rows on screen should SAY.
 *
 * - "loading"     — the read has not finished; say nothing yet.
 * - "failed"      — the read failed; say so and offer a retry.
 * - "configuring" — the read succeeded and this account genuinely has no slots.
 * - "none"        — there are rows; render them, no empty state at all.
 *
 * Splitting "failed" out of "configuring" IS the fix: those two rendered the
 * same calm sentence, so a nurse whose documents had vanished was told they
 * were being set up for her.
 */
export type EmptyStateKind = "loading" | "failed" | "configuring" | "none";

export function emptyStateKind(opts: {
  loaded: boolean;
  failed: boolean;
  itemCount: number;
}): EmptyStateKind {
  if (opts.itemCount > 0) return "none";
  // A failure outranks "not loaded yet": after a failed attempt the spinner
  // would otherwise spin forever with nothing to wait for.
  if (opts.failed) return "failed";
  if (!opts.loaded) return "loading";
  return "configuring";
}
