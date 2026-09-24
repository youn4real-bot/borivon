import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeGmailRestClient, makeCalendarRestClient } from "../lib/googleRestShim";
import { clearGoogleTokenCache } from "../lib/googleAuthWebCrypto";

/**
 * Gmail + Calendar go through the same fetch/WebCrypto shim as Drive, and they
 * carry the bot's inbox tooling and the booking calendar. Both are exercised
 * only through the live Google APIs, so nothing but a stubbed HTTP layer can
 * pin their contract without sending real mail or touching a real calendar.
 *
 * Every request the app makes is asserted here: URL, method, query and body.
 * Nothing real is contacted — fetch is replaced and the OAuth token endpoint is
 * answered locally, so a generated keypair stands in for the service account.
 */

const te = new TextEncoder();
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function abToPem(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
}
async function genPem(): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  return abToPem(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
}

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function stubFetch(replies: Array<{ status?: number; json?: unknown; text?: string }>) {
  const calls: Call[] = [];
  let i = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const b = init?.body;
    const body = typeof b === "string" ? b : b instanceof URLSearchParams ? b.toString() : "";
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), headers, body });
    if (url === TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "tok-123", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    const r = replies[i++] ?? { json: {} };
    // 204/205/304 must be constructed with a null body — the fetch spec forbids
    // one, which is the same reason the shim cannot call .json() on a delete.
    if (r.status === 204 || r.status === 205 || r.status === 304) return new Response(null, { status: r.status });
    if (r.text !== undefined) return new Response(r.text, { status: r.status ?? 200 });
    return new Response(JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

let pem = "";
let restore: (() => void) | null = null;

async function clients() {
  if (!pem) pem = await genPem();
  const opts = {
    key: { client_email: "bot@borivon.iam.gserviceaccount.com", private_key: pem },
    subject: "founder@borivon.com",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  };
  return { gmail: makeGmailRestClient(opts), cal: makeCalendarRestClient(opts) };
}

beforeEach(() => { clearGoogleTokenCache(); });
afterEach(() => { restore?.(); restore = null; });

const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL = "https://www.googleapis.com/calendar/v3";

describe("Gmail REST shim — every call lib/gmailApi.ts makes", () => {
  it("messages.list sends q + maxResults and a Bearer token", async () => {
    const s = stubFetch([{ json: { messages: [{ id: "m1" }] } }]);
    restore = s.restore;
    const { gmail } = await clients();
    const r = await gmail.users.messages.list({ userId: "me", q: "in:inbox", maxResults: 25 });
    expect(s.calls[0].url).toBe(TOKEN_URL);
    expect(s.calls[1].method).toBe("GET");
    expect(s.calls[1].headers.authorization).toBe("Bearer tok-123");
    expect(params(s.calls[1].url)).toEqual({ q: "in:inbox", maxResults: "25" });
    expect(s.calls[1].url.startsWith(`${GM}/messages?`)).toBe(true);
    expect(r.data.messages[0].id).toBe("m1");
  });

  it("messages.get REPEATS metadataHeaders instead of joining them", async () => {
    const s = stubFetch([{ json: { id: "m1" } }]);
    restore = s.restore;
    const { gmail } = await clients();
    await gmail.users.messages.get({ userId: "me", id: "m1", format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
    // Google reads metadataHeaders as a repeated parameter. Collapsing the array
    // to "From,Subject,Date" returns a message with no headers at all, which the
    // inbox list would render as blank senders.
    const sp = new URL(s.calls[1].url).searchParams;
    expect(sp.getAll("metadataHeaders")).toEqual(["From", "Subject", "Date"]);
    expect(sp.get("format")).toBe("metadata");
  });

  it("messages.send posts the raw MIME body", async () => {
    const s = stubFetch([{ json: { id: "sent-1", threadId: "t1" } }]);
    restore = s.restore;
    const { gmail } = await clients();
    const r = await gmail.users.messages.send({ userId: "me", requestBody: { raw: "UkFXTUlNRQ", threadId: "t1" } });
    expect(s.calls[1].method).toBe("POST");
    expect(s.calls[1].url).toBe(`${GM}/messages/send`);
    expect(s.calls[1].headers["content-type"]).toBe("application/json");
    expect(JSON.parse(s.calls[1].body)).toEqual({ raw: "UkFXTUlNRQ", threadId: "t1" });
    expect(r.data.id).toBe("sent-1");
  });

  it("messages.modify carries both label lists (archive / star / mark-read)", async () => {
    const s = stubFetch([{ json: {} }]);
    restore = s.restore;
    const { gmail } = await clients();
    await gmail.users.messages.modify({ userId: "me", id: "m1", requestBody: { addLabelIds: ["STARRED"], removeLabelIds: ["UNREAD", "INBOX"] } });
    expect(s.calls[1].method).toBe("POST");
    expect(s.calls[1].url).toBe(`${GM}/messages/m1/modify`);
    expect(JSON.parse(s.calls[1].body)).toEqual({ addLabelIds: ["STARRED"], removeLabelIds: ["UNREAD", "INBOX"] });
  });

  it("messages.trash and untrash POST to their own endpoints", async () => {
    const s = stubFetch([{ json: {} }, { json: {} }]);
    restore = s.restore;
    const { gmail } = await clients();
    await gmail.users.messages.trash({ userId: "me", id: "m1" });
    await gmail.users.messages.untrash({ userId: "me", id: "m1" });
    expect(s.calls[1]).toMatchObject({ method: "POST", url: `${GM}/messages/m1/trash` });
    expect(s.calls[2]).toMatchObject({ method: "POST", url: `${GM}/messages/m1/untrash` });
  });

  it("messages.attachments.get reads one attachment of one message", async () => {
    const s = stubFetch([{ json: { data: "QUJD", size: 3 } }]);
    restore = s.restore;
    const { gmail } = await clients();
    const r = await gmail.users.messages.attachments.get({ userId: "me", messageId: "m1", id: "att-1" });
    expect(s.calls[1].url).toBe(`${GM}/messages/m1/attachments/att-1`);
    expect(r.data.data).toBe("QUJD");
  });

  it("threads.list and threads.get hit /threads", async () => {
    const s = stubFetch([{ json: { threads: [{ id: "t1" }] } }, { json: { id: "t1", messages: [] } }]);
    restore = s.restore;
    const { gmail } = await clients();
    await gmail.users.threads.list({ userId: "me", q: "is:unread", maxResults: 10 });
    await gmail.users.threads.get({ userId: "me", id: "t1", format: "full" });
    expect(params(s.calls[1].url)).toEqual({ q: "is:unread", maxResults: "10" });
    expect(s.calls[2].url).toBe(`${GM}/threads/t1?format=full`);
  });

  it("drafts create / send / get use the drafts endpoints", async () => {
    const s = stubFetch([{ json: { id: "d1" } }, { json: { id: "m9" } }, { json: { id: "d1" } }]);
    restore = s.restore;
    const { gmail } = await clients();
    await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw: "UkFX" } } });
    await gmail.users.drafts.send({ userId: "me", requestBody: { id: "d1" } });
    await gmail.users.drafts.get({ userId: "me", id: "d1", format: "full" });
    expect(s.calls[1]).toMatchObject({ method: "POST", url: `${GM}/drafts` });
    expect(s.calls[2]).toMatchObject({ method: "POST", url: `${GM}/drafts/send` });
    expect(s.calls[3]).toMatchObject({ method: "GET", url: `${GM}/drafts/d1?format=full` });
  });

  it("getProfile and settings.sendAs.list back the workspace health check", async () => {
    const s = stubFetch([{ json: { emailAddress: "founder@borivon.com" } }, { json: { sendAs: [] } }]);
    restore = s.restore;
    const { gmail } = await clients();
    const p = await gmail.users.getProfile({ userId: "me" });
    await gmail.users.settings.sendAs.list({ userId: "me" });
    expect(s.calls[1].url).toBe(`${GM}/profile`);
    expect(s.calls[2].url).toBe(`${GM}/settings/sendAs`);
    expect(p.data.emailAddress).toBe("founder@borivon.com");
  });

  it("a non-2xx throws with the status and a readable body", async () => {
    const s = stubFetch([{ status: 403, text: '{"error":{"message":"Delegation denied"}}' }]);
    restore = s.restore;
    const { gmail } = await clients();
    await expect(gmail.users.messages.list({ userId: "me" })).rejects.toThrow(/google_rest 403 .*Delegation denied/);
  });
});

describe("Calendar REST shim — every call lib/workspaceCalendar.ts makes", () => {
  it("events.list forwards the whole availability window", async () => {
    const s = stubFetch([{ json: { items: [] } }]);
    restore = s.restore;
    const { cal } = await clients();
    await cal.events.list({
      calendarId: "primary", timeMin: "2026-09-24T00:00:00Z", timeMax: "2026-10-01T00:00:00Z",
      singleEvents: true, orderBy: "startTime", maxResults: 250, pageToken: "p1", showDeleted: false,
    });
    expect(s.calls[1].url.startsWith(`${CAL}/calendars/primary/events?`)).toBe(true);
    expect(params(s.calls[1].url)).toEqual({
      timeMin: "2026-09-24T00:00:00Z", timeMax: "2026-10-01T00:00:00Z",
      singleEvents: "true", orderBy: "startTime", maxResults: "250", pageToken: "p1", showDeleted: "false",
    });
  });

  it("events.insert carries sendUpdates and conferenceDataVersion — no Meet link without them", async () => {
    const s = stubFetch([{ json: { id: "ev1", hangoutLink: "https://meet.google.com/abc" } }]);
    restore = s.restore;
    const { cal } = await clients();
    const r = await cal.events.insert({
      calendarId: "primary",
      requestBody: { summary: "Screening", conferenceData: { createRequest: { requestId: "r1" } } },
      sendUpdates: "all", conferenceDataVersion: 1,
    });
    expect(s.calls[1].method).toBe("POST");
    expect(params(s.calls[1].url)).toEqual({ sendUpdates: "all", conferenceDataVersion: "1" });
    expect(JSON.parse(s.calls[1].body).summary).toBe("Screening");
    expect(r.data.hangoutLink).toBe("https://meet.google.com/abc");
  });

  it("events.get, patch and update address one event id", async () => {
    const s = stubFetch([{ json: { id: "ev1" } }, { json: { id: "ev1" } }, { json: { id: "ev1" } }]);
    restore = s.restore;
    const { cal } = await clients();
    await cal.events.get({ calendarId: "primary", eventId: "ev1" });
    await cal.events.patch({ calendarId: "primary", eventId: "ev1", requestBody: { summary: "Moved" }, sendUpdates: "all" });
    await cal.events.update({ calendarId: "primary", eventId: "ev1", requestBody: { summary: "Replaced" }, sendUpdates: "none" });
    expect(s.calls[1]).toMatchObject({ method: "GET", url: `${CAL}/calendars/primary/events/ev1` });
    expect(s.calls[2]).toMatchObject({ method: "PATCH", url: `${CAL}/calendars/primary/events/ev1?sendUpdates=all` });
    expect(s.calls[3]).toMatchObject({ method: "PUT", url: `${CAL}/calendars/primary/events/ev1?sendUpdates=none` });
  });

  it("events.delete returns an empty data object instead of parsing the empty 204 body", async () => {
    // Google answers a delete with no body. Calling .json() on that throws, and
    // the caller would read a cancelled invite as a failure.
    const s = stubFetch([{ status: 204, text: "" }]);
    restore = s.restore;
    const { cal } = await clients();
    const r = await cal.events.delete({ calendarId: "primary", eventId: "ev1", sendUpdates: "all" });
    expect(s.calls[1]).toMatchObject({ method: "DELETE", url: `${CAL}/calendars/primary/events/ev1?sendUpdates=all` });
    expect(r.data).toEqual({});
  });

  it("a calendar id that is an e-mail address is URL-encoded", async () => {
    const s = stubFetch([{ json: { items: [] } }]);
    restore = s.restore;
    const { cal } = await clients();
    await cal.events.list({ calendarId: "founder@borivon.com" });
    expect(s.calls[1].url).toBe(`${CAL}/calendars/founder%40borivon.com/events`);
  });

  it("calendarList.list is what testWorkspace() uses to prove the calendar scope", async () => {
    const s = stubFetch([{ json: { items: [{ id: "primary" }] } }]);
    restore = s.restore;
    const { cal } = await clients();
    const r = await cal.calendarList.list({ maxResults: 1 });
    expect(s.calls[1].url).toBe(`${CAL}/users/me/calendarList?maxResults=1`);
    expect(r.data.items[0].id).toBe("primary");
  });
});
