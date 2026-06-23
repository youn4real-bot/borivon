/**
 * Cloudflare-Workers REST shims for Gmail + Calendar that mimic the `googleapis` client
 * surface the bot actually uses — so lib/gmailApi.ts and lib/workspaceCalendar.ts work
 * UNCHANGED on Workers. (googleapis itself relies on google-auth-library → node:http, which
 * unenv doesn't implement on workerd, so the real client 500s with "validateHeaderName not
 * implemented".) These shims auth via a WebCrypto-minted domain-wide-delegation token
 * (lib/googleAuthWebCrypto) and call the Google REST APIs with plain fetch — no googleapis,
 * no node:http. Only used ON WORKERS; Vercel keeps the real googleapis client.
 *
 * Each method mirrors the googleapis signature (an options object) and returns `{ data }`,
 * and THROWS on a non-2xx response, so the existing callers' shapes + try/catch are unchanged.
 */
import { mintGoogleAccessToken, type GoogleSaKey } from "@/lib/googleAuthWebCrypto";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";

type ShimOpts = { key: GoogleSaKey; subject: string; scopes: string[] };

async function authedFetch(opts: ShimOpts, url: string, init?: RequestInit): Promise<Response> {
  const token = await mintGoogleAccessToken({ key: opts.key, subject: opts.subject, scopes: opts.scopes });
  if (!token) throw new Error("google_token_mint_failed");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`google_rest ${res.status} ${url.replace(/\?.*$/, "")} ${body.slice(0, 300)}`);
  }
  return res;
}
async function jget(opts: ShimOpts, url: string): Promise<unknown> {
  const r = await authedFetch(opts, url); return r.json();
}
function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) sp.append(k, String(item));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
const enc = encodeURIComponent;

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Gmail REST client mimicking the googleapis `gmail({version:'v1'})` surface used by the bot. */
export function makeGmailRestClient(opts: ShimOpts) {
  return {
    users: {
      getProfile: async (_p: { userId: string }) =>
        ({ data: await jget(opts, `${GMAIL_BASE}/profile`) as any }),
      settings: {
        sendAs: {
          list: async (_p: { userId: string }) =>
            ({ data: await jget(opts, `${GMAIL_BASE}/settings/sendAs`) as any }),
        },
      },
      drafts: {
        create: async (p: { userId: string; requestBody: any }) =>
          ({ data: await (await authedFetch(opts, `${GMAIL_BASE}/drafts`, { method: "POST", body: JSON.stringify(p.requestBody) })).json() as any }),
        send: async (p: { userId: string; requestBody: any }) =>
          ({ data: await (await authedFetch(opts, `${GMAIL_BASE}/drafts/send`, { method: "POST", body: JSON.stringify(p.requestBody) })).json() as any }),
        get: async (p: { userId: string; id: string; format?: string }) =>
          ({ data: await jget(opts, `${GMAIL_BASE}/drafts/${enc(p.id)}${qs({ format: p.format })}`) as any }),
      },
      threads: {
        list: async (p: { userId: string; q?: string; maxResults?: number }) =>
          ({ data: await jget(opts, `${GMAIL_BASE}/threads${qs({ q: p.q, maxResults: p.maxResults })}`) as any }),
        get: async (p: { userId: string; id: string; format?: string; metadataHeaders?: string[] }) =>
          ({ data: await jget(opts, `${GMAIL_BASE}/threads/${enc(p.id)}${qs({ format: p.format, metadataHeaders: p.metadataHeaders })}`) as any }),
      },
      messages: {
        list: async (p: { userId: string; q?: string; maxResults?: number }) =>
          ({ data: await jget(opts, `${GMAIL_BASE}/messages${qs({ q: p.q, maxResults: p.maxResults })}`) as any }),
        get: async (p: { userId: string; id: string; format?: string; metadataHeaders?: string[] }) =>
          ({ data: await jget(opts, `${GMAIL_BASE}/messages/${enc(p.id)}${qs({ format: p.format, metadataHeaders: p.metadataHeaders })}`) as any }),
        send: async (p: { userId: string; requestBody: any }) =>
          ({ data: await (await authedFetch(opts, `${GMAIL_BASE}/messages/send`, { method: "POST", body: JSON.stringify(p.requestBody) })).json() as any }),
        modify: async (p: { userId: string; id: string; requestBody: any }) =>
          ({ data: await (await authedFetch(opts, `${GMAIL_BASE}/messages/${enc(p.id)}/modify`, { method: "POST", body: JSON.stringify(p.requestBody) })).json() as any }),
        trash: async (p: { userId: string; id: string }) =>
          ({ data: await (await authedFetch(opts, `${GMAIL_BASE}/messages/${enc(p.id)}/trash`, { method: "POST" })).json() as any }),
        untrash: async (p: { userId: string; id: string }) =>
          ({ data: await (await authedFetch(opts, `${GMAIL_BASE}/messages/${enc(p.id)}/untrash`, { method: "POST" })).json() as any }),
        attachments: {
          get: async (p: { userId: string; messageId: string; id: string }) =>
            ({ data: await jget(opts, `${GMAIL_BASE}/messages/${enc(p.messageId)}/attachments/${enc(p.id)}`) as any }),
        },
      },
    },
  };
}

/** Calendar REST client mimicking the googleapis `calendar({version:'v3'})` surface used. */
export function makeCalendarRestClient(opts: ShimOpts) {
  const evUrl = (calendarId: string, extra = "", params: Record<string, unknown> = {}) =>
    `${CAL_BASE}/calendars/${enc(calendarId)}/events${extra}${qs(params)}`;
  return {
    calendarList: {
      list: async (p: { maxResults?: number } = {}) =>
        ({ data: await jget(opts, `${CAL_BASE}/users/me/calendarList${qs({ maxResults: p.maxResults })}`) as any }),
    },
    events: {
      list: async (p: { calendarId: string; timeMin?: string; timeMax?: string; singleEvents?: boolean; orderBy?: string; maxResults?: number; q?: string; pageToken?: string; showDeleted?: boolean }) =>
        ({ data: await jget(opts, evUrl(p.calendarId, "", { timeMin: p.timeMin, timeMax: p.timeMax, singleEvents: p.singleEvents, orderBy: p.orderBy, maxResults: p.maxResults, q: p.q, pageToken: p.pageToken, showDeleted: p.showDeleted })) as any }),
      get: async (p: { calendarId: string; eventId: string }) =>
        ({ data: await jget(opts, evUrl(p.calendarId, `/${enc(p.eventId)}`)) as any }),
      insert: async (p: { calendarId: string; requestBody: any; sendUpdates?: string; conferenceDataVersion?: number }) =>
        ({ data: await (await authedFetch(opts, evUrl(p.calendarId, "", { sendUpdates: p.sendUpdates, conferenceDataVersion: p.conferenceDataVersion }), { method: "POST", body: JSON.stringify(p.requestBody) })).json() as any }),
      update: async (p: { calendarId: string; eventId: string; requestBody: any; sendUpdates?: string; conferenceDataVersion?: number }) =>
        ({ data: await (await authedFetch(opts, evUrl(p.calendarId, `/${enc(p.eventId)}`, { sendUpdates: p.sendUpdates, conferenceDataVersion: p.conferenceDataVersion }), { method: "PUT", body: JSON.stringify(p.requestBody) })).json() as any }),
      patch: async (p: { calendarId: string; eventId: string; requestBody: any; sendUpdates?: string; conferenceDataVersion?: number }) =>
        ({ data: await (await authedFetch(opts, evUrl(p.calendarId, `/${enc(p.eventId)}`, { sendUpdates: p.sendUpdates, conferenceDataVersion: p.conferenceDataVersion }), { method: "PATCH", body: JSON.stringify(p.requestBody) })).json() as any }),
      delete: async (p: { calendarId: string; eventId: string; sendUpdates?: string }) => {
        await authedFetch(opts, evUrl(p.calendarId, `/${enc(p.eventId)}`, { sendUpdates: p.sendUpdates }), { method: "DELETE" });
        return { data: {} as any };
      },
    },
  };
}
