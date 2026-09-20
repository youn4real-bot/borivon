/**
 * Reading the candidate's own pipeline row — and the one distinction the old
 * code could not make: "she has no pipeline" is not "I could not find out".
 *
 * THE BUG THIS FILE EXISTS TO PREVENT: the dashboard bootstrap did
 *
 *     fetch(`/api/portal/pipeline/me`, …)
 *       .then(r => r.json())
 *       .then(({ pipeline: p }) => setPipeline(p ?? null))
 *
 * with no look at `r.status`, against a route that answered `{ pipeline: null }`
 * for a 401 as well as for a candidate with no row. So an expired JWT — the
 * normal state of a phone left open for an hour — landed as `pipeline = null`,
 * every `isAdminUnlocked()` said false, and a candidate whose Visum or
 * interview stage the founder had explicitly unlocked tapped it and was shown
 * the "Upgrade to Premium" box. LAW #31/#32: that lock is the supreme admin's
 * discretion alone, and a dropped read must never override it on screen.
 *
 * The result type therefore has no "empty-ish" middle. Either the row was read
 * (and `pipeline: null` is a real, known absence) or the read FAILED and the
 * caller must keep whatever it already had and refuse to downgrade her view.
 */

/** `null` status = the request never produced a response (offline / abort). */
export type PipelineLoadFailure = { ok: false; status: number | null };
export type PipelineLoadSuccess<P> = { ok: true; pipeline: P | null };
export type PipelineLoadResult<P> = PipelineLoadSuccess<P> | PipelineLoadFailure;

/** Same reasoning as the login page: a stalled mobile connection raises
 *  nothing, so without a deadline the bootstrap's Promise.allSettled never
 *  settles and the dashboard never reveals. */
export const PIPELINE_TIMEOUT_MS = 20_000;

export async function fetchMyPipeline<P>(
  fetchImpl: typeof fetch,
  token: string,
  timeoutMs: number = PIPELINE_TIMEOUT_MS,
): Promise<PipelineLoadResult<P>> {
  // No token is not "no pipeline" either — it is not knowing.
  if (!token) return { ok: false, status: null };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl("/api/portal/pipeline/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }

  // 401 (expired token), 429 (rate limited), 500 (db error) — none of them
  // tell us anything about which stages the admin opened.
  if (!res.ok) return { ok: false, status: res.status };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // A 200 whose body will not parse (an HTML error page from an edge
    // proxy, a truncated response) is a broken read, not an empty account.
    return { ok: false, status: res.status };
  }

  // The route puts `pipeline` in the body ONLY when it actually read the row.
  // A body without that key is a failure shape, whatever the status said.
  if (!body || typeof body !== "object" || !("pipeline" in body)) {
    return { ok: false, status: res.status };
  }

  const p = (body as { pipeline: unknown }).pipeline;
  return { ok: true, pipeline: (p ?? null) as P | null };
}
