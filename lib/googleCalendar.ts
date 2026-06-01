import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * "Connect Google Calendar" — one-way instant push (Borivon → the user's Google).
 *
 * Per-user OAuth (NOT the Drive service account, which can't write to personal
 * calendars). On connect we store the refresh token; on every event create /
 * edit / delete we write straight into each connected user's Google calendar.
 * We only ever WRITE Borivon events — we never read the user's personal events.
 *
 * Everything here is a no-op unless GOOGLE_OAUTH_CLIENT_ID/SECRET are set, so it
 * stays inert (and event CRUD is untouched) until the OAuth app is configured.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
];

const SITE = (process.env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");
const REDIRECT_URI = `${SITE}/api/portal/calendar/google/callback`;

export function googleOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function oauthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    REDIRECT_URI,
  );
}

/** The Google consent URL. `state` is a signed userId (CSRF-safe round-trip). */
export function buildAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token on every grant
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

function emailFromIdToken(idToken?: string | null): string | null {
  if (!idToken) return null;
  try {
    const payload = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { email?: string };
    return typeof json.email === "string" ? json.email : null;
  } catch { return null; }
}

/** Exchange the auth code for tokens and store them. Returns the Google email. */
export async function completeConnect(userId: string, code: string, seesAll: boolean): Promise<string | null> {
  const { tokens } = await oauthClient().getToken(code);
  const email = emailFromIdToken(tokens.id_token);
  const row: Record<string, unknown> = {
    user_id: userId,
    access_token: tokens.access_token ?? null,
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    google_email: email,
    sees_all: seesAll,
    updated_at: new Date().toISOString(),
  };
  // refresh_token is only present on the consent grant — never overwrite a good
  // one with null on a silent re-auth.
  if (tokens.refresh_token) row.refresh_token = tokens.refresh_token;
  await getServiceSupabase().from("google_calendar_tokens").upsert(row, { onConflict: "user_id" });
  return email;
}

export async function disconnect(userId: string): Promise<void> {
  await getServiceSupabase().from("google_calendar_tokens").delete().eq("user_id", userId);
}

export async function googleStatus(userId: string): Promise<{ configured: boolean; connected: boolean; email: string | null }> {
  const configured = googleOAuthConfigured();
  if (!configured) return { configured: false, connected: false, email: null };
  try {
    const { data } = await getServiceSupabase()
      .from("google_calendar_tokens").select("google_email, refresh_token").eq("user_id", userId).maybeSingle();
    const row = data as { google_email: string | null; refresh_token: string | null } | null;
    return { configured: true, connected: !!row?.refresh_token, email: row?.google_email ?? null };
  } catch {
    return { configured: true, connected: false, email: null };
  }
}

// ── Push ──────────────────────────────────────────────────────────────────────

export type PushEvent = {
  id: string; title: string; description?: string | null;
  starts_at: string; ends_at?: string | null;
  location?: string | null; link_url?: string | null;
  attendee_ids?: string[] | null;
};
type TokenRow = { user_id: string; refresh_token: string | null; access_token: string | null; expiry: string | null; sees_all: boolean };

// A Borivon uuid (hyphens stripped → 32 hex chars) is already a valid Google
// event id (base32hex charset). Deterministic → create/edit/delete all target
// the same Google event without a mapping table.
const gid = (borivonId: string) => borivonId.replace(/-/g, "");

function clientFromRow(row: TokenRow): OAuth2Client {
  const c = oauthClient();
  c.setCredentials({
    refresh_token: row.refresh_token ?? undefined,
    access_token: row.access_token ?? undefined,
    expiry_date: row.expiry ? Date.parse(row.expiry) : undefined,
  });
  // Persist refreshed access tokens so we don't refresh on every push.
  c.on("tokens", (t) => {
    getServiceSupabase().from("google_calendar_tokens").update({
      access_token: t.access_token ?? undefined,
      expiry: t.expiry_date ? new Date(t.expiry_date).toISOString() : undefined,
      updated_at: new Date().toISOString(),
    }).eq("user_id", row.user_id).then(() => {}, () => {});
  });
  return c;
}

function bodyFor(ev: PushEvent) {
  const start = new Date(ev.starts_at);
  const end = ev.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + 60 * 60 * 1000);
  const desc: string[] = [];
  if (ev.description) desc.push(ev.description);
  if (ev.link_url) desc.push(`Link: ${ev.link_url}`);
  return {
    id: gid(ev.id),
    summary: ev.title || "Event",
    description: desc.join("\n\n") || undefined,
    location: ev.location || ev.link_url || undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

function statusOf(e: unknown): number | undefined {
  return (e as { code?: number })?.code ?? (e as { response?: { status?: number } })?.response?.status;
}

async function upsertViaClient(client: OAuth2Client, ev: PushEvent): Promise<void> {
  const cal = google.calendar({ version: "v3", auth: client });
  const requestBody = bodyFor(ev);
  try {
    await cal.events.insert({ calendarId: "primary", requestBody });
  } catch (e) {
    if (statusOf(e) === 409) {
      try { await cal.events.update({ calendarId: "primary", eventId: requestBody.id, requestBody }); }
      catch (e2) { console.error("[gcal] update failed:", (e2 as Error)?.message); }
    } else {
      console.error("[gcal] insert failed:", (e as Error)?.message);
    }
  }
}

async function deleteViaClient(client: OAuth2Client, borivonId: string): Promise<void> {
  const cal = google.calendar({ version: "v3", auth: client });
  try {
    await cal.events.delete({ calendarId: "primary", eventId: gid(borivonId) });
  } catch (e) {
    const s = statusOf(e);
    if (s !== 404 && s !== 410) console.error("[gcal] delete failed:", (e as Error)?.message);
  }
}

async function connectedRows(): Promise<TokenRow[]> {
  const { data } = await getServiceSupabase()
    .from("google_calendar_tokens")
    .select("user_id, refresh_token, access_token, expiry, sees_all")
    .not("refresh_token", "is", null);
  return (data ?? []) as TokenRow[];
}

/** Push (insert/update) events into every connected user's calendar that can see them. */
export async function fanOutUpsert(events: PushEvent[]): Promise<void> {
  if (!googleOAuthConfigured() || events.length === 0) return;
  let rows: TokenRow[];
  try { rows = await connectedRows(); } catch { return; }
  if (!rows.length) return;
  const tasks: Promise<void>[] = [];
  for (const row of rows) {
    const client = clientFromRow(row);
    for (const ev of events) {
      const att = ev.attendee_ids ?? [];
      const sees = row.sees_all || att.length === 0 || att.includes(row.user_id);
      if (sees) tasks.push(upsertViaClient(client, ev));
    }
  }
  await Promise.allSettled(tasks.slice(0, 300));
}

/** Remove an event from every connected user's calendar. */
export async function fanOutDelete(borivonId: string): Promise<void> {
  if (!googleOAuthConfigured()) return;
  let rows: TokenRow[];
  try { rows = await connectedRows(); } catch { return; }
  await Promise.allSettled(rows.map((row) => deleteViaClient(clientFromRow(row), borivonId)));
}
