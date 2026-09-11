/**
 * Browser helpers for the caller's OWN data, via our server instead of direct
 * Supabase table reads (Supabase → D1 step P0).
 *
 * Every helper answers in the same `{ data, error }` shape the supabase-js
 * calls it replaces returned, so call sites keep their error handling as-is.
 * None of them throws.
 */
import { supabase } from "@/lib/supabase";

export async function meToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function call(path: string, init?: RequestInit): Promise<{ ok: boolean; json: unknown }> {
  const tk = await meToken();
  if (!tk) return { ok: false, json: { error: "not_signed_in" } };
  try {
    const r = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${tk}` },
    });
    return { ok: r.ok, json: await r.json().catch(() => null) };
  } catch {
    return { ok: false, json: { error: "network" } };
  }
}

const errOf = (j: unknown) => (j as { error?: string } | null)?.error ?? "request_failed";

/**
 * The caller's OWN candidate_profiles columns. `userId` may be passed (the id
 * the old query filtered on) but must be the caller's own — the route refuses
 * anyone else's, exactly like the self-only RLS it replaces.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMyProfile<T = any>(
  cols: string,
  opts?: { userId?: string | null },
): Promise<{ data: T | null; error: string | null }> {
  const qs = new URLSearchParams({ cols: cols.replace(/\s+/g, "") });
  if (opts?.userId) qs.set("userId", opts.userId);
  const r = await call(`/api/portal/me/profile?${qs}`);
  if (!r.ok) return { data: null, error: errOf(r.json) };
  return { data: ((r.json as { profile?: T | null } | null)?.profile ?? null), error: null };
}

/** The caller's own documents, newest first (archived rows still included). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMyDocuments<T = any>(): Promise<{ data: T[] | null; hadSuperseded: boolean; error: string | null }> {
  const r = await call("/api/portal/me/documents");
  if (!r.ok) return { data: null, hadSuperseded: false, error: errOf(r.json) };
  const j = r.json as { docs?: T[]; hadSuperseded?: boolean } | null;
  return { data: j?.docs ?? [], hadSuperseded: j?.hadSuperseded === true, error: null };
}

/** The caller's own bell rows ("all") or calendar invites ("invites"). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getMyNotifications<T = any>(kind: "all" | "invites"): Promise<{ data: T[] | null; error: string | null }> {
  const r = await call(`/api/portal/me/notifications?kind=${kind}`);
  if (!r.ok) return { data: null, error: errOf(r.json) };
  return { data: (r.json as { notifications?: T[] } | null)?.notifications ?? [], error: null };
}

/** Mark the caller's own notifications read — by id, or all (optionally only invites). */
export async function markMyNotificationsRead(
  body: { ids: string[] } | { all: true; action?: "event_invite" },
): Promise<{ error: string | null }> {
  const r = await call("/api/portal/me/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { error: r.ok ? null : errOf(r.json) };
}
