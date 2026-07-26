/**
 * NATIVE Google Workspace access for the bot (SERVER ONLY) — ONE service account
 * with DOMAIN-WIDE DELEGATION, impersonating the founder, gives native access to
 * Gmail, Calendar, Drive, Docs and Sheets through the official `googleapis` lib.
 * No App Password, no per-user OAuth, no token expiry — set it up once in the
 * Google Workspace Admin console and every Google API is available.
 *
 * Reuses the existing service-account key in GOOGLE_VERTEX_CREDENTIALS (override
 * with GOOGLE_WORKSPACE_CREDENTIALS) and impersonates GOOGLE_WORKSPACE_SUBJECT
 * (defaults to GMAIL_USER / ADMIN_EMAIL — the founder's mailbox).
 *
 * FAIL-SAFE: every getter returns null until domain-wide delegation is granted,
 * so callers fall back to the existing App-Password paths — nothing breaks before
 * the one-time setup is done.
 */
import { google } from "googleapis";
import type { JWT } from "google-auth-library";
import { makeGmailRestClient, makeCalendarRestClient } from "@/lib/googleRestShim";
import { makeDriveRestClient } from "@/lib/googleDriveShim";

// On Cloudflare Workers, googleapis (→ google-auth-library → node:http) 500s with
// "validateHeaderName not implemented". We swap in fetch+WebCrypto REST shims that mimic the
// googleapis surface, so gmailApi.ts / workspaceCalendar.ts run unchanged. Vercel (Node) keeps
// the real googleapis client (this is false there).
const ON_WORKERS = typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

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

/** A delegated JWT auth client (impersonating the founder), or null if unconfigured. */
export function getWorkspaceAuth(scopes: string[] = WORKSPACE_SCOPES): JWT | null {
  const k = saKey();
  const sub = subjectEmail();
  if (!k || !sub) return null;
  return new google.auth.JWT({ email: k.client_email, key: k.private_key, scopes, subject: sub });
}

export function gmailClient() {
  if (ON_WORKERS) {
    const k = saKey(); const sub = subjectEmail();
    if (!k || !sub) return null;
    return makeGmailRestClient({ key: k, subject: sub, scopes: WORKSPACE_SCOPES }) as unknown as ReturnType<typeof google.gmail>;
  }
  const auth = getWorkspaceAuth();
  return auth ? google.gmail({ version: "v1", auth }) : null;
}
export function calendarClient() {
  if (ON_WORKERS) {
    const k = saKey(); const sub = subjectEmail();
    if (!k || !sub) return null;
    return makeCalendarRestClient({ key: k, subject: sub, scopes: WORKSPACE_SCOPES }) as unknown as ReturnType<typeof google.calendar>;
  }
  const auth = getWorkspaceAuth();
  return auth ? google.calendar({ version: "v3", auth }) : null;
}
export function driveClient() {
  // Drive was the LAST Google client still on the googleapis SDK after the move
  // to Workers. googleapis reaches node:http via gaxios, which workerd can't
  // serve — and every Drive caller catches + logs, so syncs reported success
  // while copying nothing. No document reached Drive between the migration and
  // this shim. Same fetch-based treatment Gmail and Calendar already had.
  if (ON_WORKERS) {
    const k = saKey(); const sub = subjectEmail();
    if (!k || !sub) return null;
    return makeDriveRestClient({ key: k, subject: sub, scopes: WORKSPACE_SCOPES }) as unknown as ReturnType<typeof google.drive>;
  }
  const auth = getWorkspaceAuth();
  return auth ? google.drive({ version: "v3", auth }) : null;
}
export function docsClient() {
  const auth = getWorkspaceAuth();
  return auth ? google.docs({ version: "v1", auth }) : null;
}
export function sheetsClient() {
  const auth = getWorkspaceAuth();
  return auth ? google.sheets({ version: "v4", auth }) : null;
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
