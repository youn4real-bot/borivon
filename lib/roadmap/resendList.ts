/**
 * The Fahrplan email list, kept in Resend (founder, 2026-10-23: "we always get
 * their email and build an email list"). Resend Contacts are global, so no
 * audience id is needed: https://resend.com/docs/api-reference/contacts
 *
 * Law first (§7 UWG, Art. 6/7 GDPR): EVERY Fahrplan lead becomes a contact,
 * but as `unsubscribed: true`, so a Broadcast from the Resend dashboard never
 * reaches them. Only the double opt-in (ticked "tips" box + POST on the confirm
 * page) flips them to subscribed, and the unsubscribe link flips them back.
 * A new submission never re-unsubscribes someone who already confirmed.
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
 * New Fahrplan lead: add to the list, NOT subscribed. If the contact already
 * exists, only refresh the name (leave their subscription exactly as it is).
 */
export async function addLeadToList(c: { email: string; firstName?: string; lastName?: string }, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const names = { ...(c.firstName ? { first_name: c.firstName } : {}), ...(c.lastName ? { last_name: c.lastName } : {}) };
  const created = await call(API, "POST", { email: c.email, ...names, unsubscribed: true }, fetchImpl);
  if (created.ok || !created.status || created.status === 401 || created.status === 403) return created;
  if (!Object.keys(names).length) return { ok: true, status: created.status };
  return call(`${API}/${encodeURIComponent(c.email)}`, "PATCH", names, fetchImpl);
}

/** Confirm click (subscribed = true) or unsubscribe link (false). */
export async function setListSubscribed(email: string, subscribed: boolean, fetchImpl: typeof fetch = fetch): Promise<Result> {
  const r = await call(`${API}/${encodeURIComponent(email)}`, "PATCH", { unsubscribed: !subscribed }, fetchImpl);
  if (r.ok || r.status !== 404) return r;
  // not on the list yet (e.g. a lead from before the list existed): add them in the right state
  return call(API, "POST", { email, unsubscribed: !subscribed }, fetchImpl);
}
