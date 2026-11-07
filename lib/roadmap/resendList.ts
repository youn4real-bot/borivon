/**
 * The Fahrplan email list, kept in Resend (founder, 2026-10-23: "we always get
 * their email and build an email list"). Resend Contacts are global, so no
 * audience id is needed: https://resend.com/docs/api-reference/contacts
 *
 * Law first (§7 UWG, Art. 6/7 GDPR), founder 2026-11-07: a Fahrplan lead
 * becomes a contact ONLY after the double opt-in (ticked box + POST on the
 * confirm page), and then as subscribed. The unsubscribe link flips them to
 * `unsubscribed: true`, so a Broadcast from the Resend dashboard never reaches
 * them again. Unconfirmed requests never touch the list.
 *
 * Never throws: the list is a side channel; a Resend hiccup must not cost a
 * lead, a PDF or a confirmation. Needs RESEND_API_KEY with contact access
 * (a "sending access" key gets 401/403, which is logged and ignored).
 */
const API = "https://api.resend.com/contacts";

type Result = { ok: boolean; status?: number };

function headers(): Record<string, string> | null {
  const key = (process.env.RESEND_API_KEY || "").trim();
  return key ? { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } : null;
}

async function call(url: string, method: "POST" | "PATCH", body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<Result> {
  const h = headers();
  if (!h) return { ok: false };
  try {
    const r = await fetchImpl(url, { method, headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false };
  }
}

/**
 * Confirm click (subscribed = true) or unsubscribe link (false). Creates the
 * contact when it is not on the list yet (the confirm click, the first time).
 */
export async function setListSubscribed(email: string, subscribed: boolean, fetchImpl: typeof fetch = fetch, names: { lastName?: string } = {}): Promise<Result> {
  const n = names.lastName ? { last_name: names.lastName } : {};
  const r = await call(`${API}/${encodeURIComponent(email)}`, "PATCH", { unsubscribed: !subscribed, ...n }, fetchImpl);
  if (r.ok || r.status !== 404) return r;
  return call(API, "POST", { email, ...n, unsubscribed: !subscribed }, fetchImpl);
}

/** Retention: take an anonymized lead off the list for good (404 = already gone = fine). */
export async function removeFromList(email: string, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const h = headers();
  if (!h) return { ok: false };
  try {
    const r = await fetchImpl(`${API}/${encodeURIComponent(email)}`, { method: "DELETE", headers: h, signal: AbortSignal.timeout(8_000) });
    return { ok: r.ok || r.status === 404, status: r.status };
  } catch {
    return { ok: false };
  }
}

/**
 * Can this key manage contacts at all? (A "sending access" Resend key cannot:
 * 401/403.) Read-only: lists at most one contact.
 */
export async function listAccess(fetchImpl: typeof fetch = fetch): Promise<Result> {
  const h = headers();
  if (!h) return { ok: false };
  try {
    const r = await fetchImpl(`${API}?limit=1`, { method: "GET", headers: h, signal: AbortSignal.timeout(8_000) });
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false };
  }
}
