/**
 * Journey-checklist writes, and the sentence that goes with a failed one.
 *
 * THE BUG THIS FILE EXISTS TO PREVENT: every handler in JourneyChecklist ended
 * the same way —
 *
 *     if (!res || !res.ok) setItems(prev => …revert…);
 *
 * — a bare revert with nothing rendered. Ticking a step turned it green and
 * then snapped back half a second later with no explanation, which reads as a
 * misclick, so people tick it again. Adding a step was worse: on failure the
 * `if (res.ok && j.item)` simply did not fire, the input kept its text, and the
 * button looked like it had never been pressed. The same shape covered the due
 * date, the blocked flag, the rename, the delete and both B2 controls.
 *
 * Reverting is still right — the server is the truth. Reverting SILENTLY is
 * the defect. So every write goes through here and returns an outcome the
 * caller has to look at, and `journeyFailureText` gives it words in all three
 * languages (LAW #19).
 */

/** `null` status = the request never produced a response (offline / DNS / abort). */
export type JourneyWriteResult<T = unknown> =
  | { ok: true; item: T | null }
  | { ok: false; status: number | null };

export type JourneyLoadResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; status: number | null };

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/**
 * One checklist write. Never throws: an offline fetch is an outcome, not an
 * exception, because every caller has already applied an optimistic change it
 * must now either keep or undo.
 */
export async function journeyWrite<T = unknown>(opts: {
  fetchImpl: typeof fetch;
  token: string;
  method: "POST" | "PATCH" | "DELETE";
  body: Record<string, unknown>;
  /** Defaults to the checklist endpoint; the B2 controls pass their own. */
  path?: string;
}): Promise<JourneyWriteResult<T>> {
  // No token means the request cannot be made. Reporting success here would
  // leave a tick on screen that no server ever recorded.
  if (!opts.token) return { ok: false, status: null };
  try {
    const r = await opts.fetchImpl(opts.path ?? "/api/portal/journey", {
      method: opts.method,
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify(opts.body),
    });
    if (!r.ok) return { ok: false, status: typeof r.status === "number" ? r.status : null };
    let item: T | null = null;
    try {
      const j = (await r.json()) as { item?: T } | null;
      item = j?.item ?? null;
    } catch {
      // A 2xx with no parseable body still means the write landed (DELETE
      // answers this way) — the caller just gets no canonical row back.
    }
    return { ok: true, item };
  } catch {
    return { ok: false, status: null };
  }
}

/** Read one candidate's checklist. A failure is NOT an empty checklist. */
export async function journeyLoad<T = Record<string, unknown>>(opts: {
  fetchImpl: typeof fetch;
  token: string;
  candidateId: string;
}): Promise<JourneyLoadResult<T>> {
  if (!opts.token) return { ok: false, status: null };
  try {
    const r = await opts.fetchImpl(
      `/api/portal/journey?candidateId=${encodeURIComponent(opts.candidateId)}`,
      { headers: { Authorization: `Bearer ${opts.token}` } },
    );
    if (!r.ok) return { ok: false, status: typeof r.status === "number" ? r.status : null };
    try {
      return { ok: true, data: ((await r.json()) ?? {}) as T };
    } catch {
      // A 200 that will not parse is a broken read, not an empty list.
      return { ok: false, status: 200 };
    }
  } catch {
    return { ok: false, status: null };
  }
}

export type JourneyLang = "en" | "fr" | "de";

/**
 * Why the change did not stick, in her language.
 *
 * 403 gets its own wording on purpose: it is not a glitch to retry but a step
 * that belongs to someone else, and "try again" would be a lie. Everything
 * else — 500s, a dropped connection, an expired token — is retryable.
 */
export function journeyFailureText(status: number | null, lang: string): string {
  const l: JourneyLang = lang === "de" ? "de" : lang === "fr" ? "fr" : "en";
  if (status === 403 || status === 401) {
    return l === "de" ? "Nicht gespeichert — dazu fehlt die Berechtigung."
      : l === "fr" ? "Non enregistré — vous n’avez pas l’autorisation."
      : "Not saved — you don’t have permission for this.";
  }
  if (status === null) {
    return l === "de" ? "Nicht gespeichert — keine Verbindung. Bitte erneut versuchen."
      : l === "fr" ? "Non enregistré — pas de connexion. Réessayez."
      : "Not saved — no connection. Please try again.";
  }
  return l === "de" ? "Nicht gespeichert — bitte erneut versuchen."
    : l === "fr" ? "Non enregistré — veuillez réessayer."
    : "Not saved — please try again.";
}

/** The checklist could not be read at all (different from "no steps yet"). */
export function journeyLoadFailedText(lang: string): string {
  const l: JourneyLang = lang === "de" ? "de" : lang === "fr" ? "fr" : "en";
  return l === "de" ? "Die Schritte konnten nicht geladen werden."
    : l === "fr" ? "Impossible de charger les étapes."
    : "The steps could not be loaded.";
}
