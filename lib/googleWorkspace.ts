/**
 * NATIVE Google Workspace access for the bot (SERVER ONLY) — ONE service account
 * with DOMAIN-WIDE DELEGATION, impersonating the founder, gives native access to
 * Gmail, Calendar and Drive. No App Password, no per-user OAuth, no token expiry
 * — set it up once in the Google Workspace Admin console and every Google API is
 * available.
 *
 * Reuses the existing service-account key in GOOGLE_VERTEX_CREDENTIALS (override
 * with GOOGLE_WORKSPACE_CREDENTIALS) and impersonates GOOGLE_WORKSPACE_SUBJECT
 * (defaults to GMAIL_USER / ADMIN_EMAIL — the founder's mailbox).
 *
 * NOTHING HERE LOADS `googleapis` ANY MORE — the only mention left is an erased
 * `import type`. The one runtime is Cloudflare Workers, and on workerd the SDK
 * never ran: it reaches node:http through gaxios, so every client was long ago
 * replaced by a fetch + WebCrypto REST shim (lib/googleRestShim.ts for Gmail and
 * Calendar, lib/googleDriveShim.ts for Drive). The SDK branch that sat beside
 * each shim was unreachable code that still cost the whole bundle — googleapis
 * ships hundreds of generated API clients (dfareporting, Google's ad-reporting
 * API, among them) and that weight is what makes every cold start 2-5s.
 * Deferring the import did nothing, because OpenNext inlines dynamic imports
 * into the single worker bundle; only deleting the import removes the bytes.
 *
 * FAIL-SAFE: every getter returns null until domain-wide delegation is granted,
 * so callers fall back to their existing "not connected" paths — nothing throws
 * before the one-time setup is done.
 */
// TYPE-ONLY, and it must stay that way. `import type` is erased by TypeScript, so
// it contributes nothing to the bundle — but it is what lets the shims keep the
// exact client surface every caller (lib/gmailApi.ts, lib/workspaceCalendar.ts,
// lib/driveMirror.ts, lib/googleSheets.ts) already compiles against. Dropping it
// and exposing the shims' own narrower types instead breaks those four files.
import type { calendar_v3, drive_v3, gmail_v1, sheets_v4 } from "googleapis";
import { makeGmailRestClient, makeCalendarRestClient } from "@/lib/googleRestShim";
import { makeDriveRestClient } from "@/lib/googleDriveShim";

// Scopes the bot needs across Workspace. These must ALSO be pasted into the
// Admin console domain-wide-delegation grant for the service account (same list).
export const WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify", // read + labels + drafts + trash
  "https://www.googleapis.com/auth/gmail.send",   // send / reply / forward
  "https://www.googleapis.com/auth/calendar",     // events + invitations + RSVP
  "https://www.googleapis.com/auth/drive",        // files
  "https://www.googleapis.com/auth/documents",    // Docs
  "https://www.googleapis.com/auth/spreadsheets", // Sheets
];

type SaKey = { client_email: string; private_key: string; client_id?: string };

function saKey(): SaKey | null {
  // Try WORKSPACE creds, then fall back to VERTEX creds. IMPORTANT: a present-but-MALFORMED
  // WORKSPACE secret must NOT block the valid VERTEX one (that bug made gmailApiReady() false
  // on Cloudflare — Gmail/Calendar "workspace_not_connected" — even though the same SA key in
  // GOOGLE_VERTEX_CREDENTIALS powers the brain fine). So iterate + skip any that won't parse.
  for (const raw of [process.env.GOOGLE_WORKSPACE_CREDENTIALS, process.env.GOOGLE_VERTEX_CREDENTIALS]) {
    if (!raw) continue;
    try {
      const k = JSON.parse(raw) as SaKey;
      if (k.client_email && k.private_key) return k;
    } catch { /* malformed → try the next source */ }
  }
  return null;
}

/**
 * The service-account key (client_email + private_key) already on the worker via
 * GOOGLE_WORKSPACE_CREDENTIALS / GOOGLE_VERTEX_CREDENTIALS. Exposed so other
 * Google APIs (e.g. Cloud Vision passport OCR) can reuse it instead of requiring
 * a separate GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY pair — one fewer
 * secret to configure. Returns null if no valid credential is present.
 */
export function serviceAccountKey(): { client_email: string; private_key: string } | null {
  const k = saKey();
  return k ? { client_email: k.client_email, private_key: k.private_key } : null;
}

/** The founder's mailbox the service account impersonates. */
function subjectEmail(): string {
  return (process.env.GOOGLE_WORKSPACE_SUBJECT || process.env.GMAIL_USER || process.env.ADMIN_EMAIL || "").trim();
}

/** True once the SA key + an impersonation subject are present (NOT proof the
 *  Admin-console delegation is granted — testGoogleWorkspace verifies that live). */
export function workspaceConfigured(): boolean {
  return !!(saKey() && subjectEmail());
}

/** The SA identity the founder pastes into the Admin console DWD grant. */
export function workspaceServiceAccount(): { clientEmail: string; clientId: string | null; subject: string } | null {
  const k = saKey();
  if (!k) return null;
  return { clientEmail: k.client_email, clientId: k.client_id ?? null, subject: subjectEmail() };
}

/**
 * Every client below mints its own domain-wide-delegation access token per call
 * (lib/googleAuthWebCrypto), impersonating `subjectEmail()`. That is the same
 * identity the deleted SDK path used, so anything the bot writes to Drive is
 * still owned by the founder — lib/driveMirror.ts depends on that.
 */
export function gmailClient() {
  const k = saKey(); const sub = subjectEmail();
  if (!k || !sub) return null;
  return makeGmailRestClient({ key: k, subject: sub, scopes: WORKSPACE_SCOPES }) as unknown as gmail_v1.Gmail;
}
export function calendarClient() {
  const k = saKey(); const sub = subjectEmail();
  if (!k || !sub) return null;
  return makeCalendarRestClient({ key: k, subject: sub, scopes: WORKSPACE_SCOPES }) as unknown as calendar_v3.Calendar;
}
export function driveClient() {
  // Drive was the LAST Google client still on the googleapis SDK after the move
  // to Workers. googleapis reaches node:http via gaxios, which workerd can't
  // serve — and every Drive caller catches + logs, so syncs reported success
  // while copying nothing. No document reached Drive between the migration and
  // this shim. Same fetch-based treatment Gmail and Calendar already had.
  const k = saKey(); const sub = subjectEmail();
  if (!k || !sub) return null;
  return makeDriveRestClient({ key: k, subject: sub, scopes: WORKSPACE_SCOPES }) as unknown as drive_v3.Drive;
}

/**
 * Docs and Sheets have NO REST shim — unlike Gmail, Calendar and Drive above.
 * They therefore have no client at all now that the SDK is gone, which is a
 * statement of fact rather than a regression: on workerd the SDK client threw
 * "validateHeaderName is not implemented" deep inside google-auth-library the
 * moment it was used, so these two getters already returned null in production.
 *
 * Returning null routes into each caller's existing `workspace_not_connected`
 * branch, which is a clean, typed refusal they already handle.
 * `sheetsShimMissing()` lets those callers say WHY rather than implying the
 * Workspace connection is broken, because it is not — see lib/googleSheets.ts.
 */
export function sheetsShimMissing(): boolean {
  return true;
}

export function docsClient(): null {
  return null;
}
// Typed `sheets_v4.Sheets | null` rather than plain `null` so lib/googleSheets.ts
// still narrows to a usable client after its null check instead of to `never`.
export function sheetsClient(): sheets_v4.Sheets | null {
  return null;
}

/** Live check: can we actually impersonate + reach Gmail + Calendar? Returns the
 *  connected email + counts, or a clear error (e.g. delegation not granted yet). */
export async function testWorkspace(): Promise<{ ok: boolean; connectedAs?: string; gmail?: boolean; calendar?: boolean; error?: string }> {
  if (!workspaceConfigured()) return { ok: false, error: "not_configured" };
  try {
    const gmail = gmailClient()!;
    const profile = await gmail.users.getProfile({ userId: "me" });
    let calendar = false;
    try { await calendarClient()!.calendarList.list({ maxResults: 1 }); calendar = true; } catch { /* calendar scope/api maybe pending */ }
    return { ok: true, connectedAs: profile.data.emailAddress ?? subjectEmail(), gmail: true, calendar };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
