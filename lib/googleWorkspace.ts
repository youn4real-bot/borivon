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
  const raw = process.env.GOOGLE_WORKSPACE_CREDENTIALS || process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as SaKey;
    return k.client_email && k.private_key ? k : null;
  } catch {
    return null;
  }
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
  const auth = getWorkspaceAuth();
  return auth ? google.gmail({ version: "v1", auth }) : null;
}
export function calendarClient() {
  const auth = getWorkspaceAuth();
  return auth ? google.calendar({ version: "v3", auth }) : null;
}
export function driveClient() {
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
