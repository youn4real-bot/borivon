/**
 * The passport draft — the one place in the portal where the LOCAL copy is the
 * ONLY copy.
 *
 * A candidate fills eighteen fields (names, MRZ passport number, two dates,
 * addresses) on a phone, on Moroccan mobile data. Two stores hold that work:
 * localStorage (written on every keystroke) and a debounced draft POST to
 * /api/portal/passport.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT (app/portal/dashboard/page.tsx, the
 * modal-close branch): closing the modal fired a best-effort keepalive POST and
 * then deleted BOTH localStorage keys unconditionally, in the same tick, without
 * ever looking at the response. When that POST failed — offline in a lift, a 502
 * from the Worker, an expired JWT — the server had nothing and the device had
 * nothing. Eighteen fields, gone, with no message: the modal just closed.
 *
 * So the rule here is a single sentence: the local copy is released ONLY when
 * the server has confirmed it holds the draft. Everything else in this module
 * serves that sentence, and every outcome is reported back so the page can SAY
 * something instead of failing quietly.
 */

/** The two localStorage keys one candidate's draft occupies. */
export type PassportDraftKeys = { data: string; confirmed: string };

/** Just the slice of Storage we use — so tests can drive this with a Map and
 *  simulate the Safari private-mode quota throw. */
export type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** `null` status = the request never produced a response (offline / DNS / abort). */
export type DraftSaveResult = { saved: boolean; status: number | null };

/**
 * What closing the modal did. `keptLocal` is the load-bearing field: true means
 * her work still exists on this device and the page MUST tell her it is not on
 * the server yet, because reopening is the only way it gets there.
 */
export type DraftFlushResult = DraftSaveResult & { keptLocal: boolean };

/** POST one draft. Never throws — a rejected fetch is reported, not raised. */
export async function savePassportDraft(opts: {
  fetchImpl: typeof fetch;
  token: string;
  data: Record<string, unknown>;
  confirmed: string[];
  /** Set when the caller is unmounting, so the request outlives the page. */
  keepalive?: boolean;
}): Promise<DraftSaveResult> {
  // No token = no possible save. Reporting "saved" here would release her only
  // copy to satisfy a request that was never even sent.
  if (!opts.token) return { saved: false, status: null };
  try {
    const r = await opts.fetchImpl("/api/portal/passport", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ ...opts.data, confirmed_fields: opts.confirmed, __draft: true }),
      ...(opts.keepalive ? { keepalive: true } : {}),
    });
    return { saved: r.ok === true, status: typeof r.status === "number" ? r.status : null };
  } catch {
    return { saved: false, status: null };
  }
}

/**
 * Write the draft to the device. Returns false when the browser refused —
 * Safari private mode throws QuotaExceededError on the FIRST setItem, and a
 * candidate whose only copy silently never got written deserves to know.
 */
export function writeLocalDraft(
  storage: DraftStorage,
  keys: PassportDraftKeys,
  data: unknown,
  confirmed: string[],
): boolean {
  try {
    storage.setItem(keys.data, JSON.stringify(data));
    storage.setItem(keys.confirmed, JSON.stringify(confirmed));
    return true;
  } catch {
    return false;
  }
}

/**
 * Close-the-modal path: flush the draft, and release the local copy ONLY if the
 * server confirmed it. On any failure the two keys stay exactly where they are,
 * so the next dashboard load restores every field she typed.
 */
export async function flushAndReleaseLocalDraft(opts: {
  fetchImpl: typeof fetch;
  token: string;
  data: Record<string, unknown>;
  confirmed: string[];
  storage: DraftStorage;
  keys: PassportDraftKeys;
}): Promise<DraftFlushResult> {
  const res = await savePassportDraft({
    fetchImpl: opts.fetchImpl,
    token: opts.token,
    data: opts.data,
    confirmed: opts.confirmed,
    keepalive: true, // the modal is unmounting; the request must survive it
  });
  if (!res.saved) return { ...res, keptLocal: true };
  try {
    opts.storage.removeItem(opts.keys.data);
    opts.storage.removeItem(opts.keys.confirmed);
  } catch {
    // Removing failed but the server HAS the draft — harmless: the next load
    // restores identical data from the device and re-flushes it.
  }
  return { ...res, keptLocal: false };
}
