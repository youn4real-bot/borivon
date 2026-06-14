import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * "Use my REAL Gmail signature" — read-only Gmail connection for the founder.
 *
 * Gmail SMTP (App Password) can SEND but can't READ settings, so the bot can't
 * see the signature saved in Gmail. This does a one-time OAuth grant (read-only
 * scope `gmail.settings.basic`), reads the primary sendAs signature HTML (logo
 * image + disclaimer included, exactly as saved), and caches it in
 * `gmail_signature_token`. Outbound email then appends that VERBATIM instead of
 * the hand-matched copy. Reuses the SAME OAuth app as Calendar
 * (GOOGLE_OAUTH_CLIENT_ID/SECRET). Everything is fail-safe → null when not
 * configured/connected, so email falls back to the built-in signature.
 */

const SCOPES = ["https://www.googleapis.com/auth/gmail.settings.basic", "openid", "email"];
const SITE = (process.env.NEXT_PUBLIC_BASE_URL || "https://www.borivon.com").replace(/\/+$/, "");
const REDIRECT_URI = `${SITE}/api/portal/admin/gmail-signature/callback`;
const TABLE = "gmail_signature_token";

export function gmailSignatureConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function oauthClient(): OAuth2Client {
  return new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET, REDIRECT_URI);
}

/** The Google consent URL (read-only Gmail settings). `state` = a signed userId. */
export function buildGmailAuthUrl(state: string): string {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state });
}

type Row = {
  owner_user_id: string;
  refresh_token: string | null;
  access_token: string | null;
  expiry: string | null;
  google_email: string | null;
  signature_html: string | null;
};

async function loadRow(userId: string): Promise<Row | null> {
  try {
    const { data } = await getServiceSupabase()
      .from(TABLE)
      .select("owner_user_id, refresh_token, access_token, expiry, google_email, signature_html")
      .eq("owner_user_id", userId)
      .maybeSingle();
    return (data as Row) ?? null;
  } catch {
    return null;
  }
}

function clientFromRow(row: Row): OAuth2Client {
  const c = oauthClient();
  c.setCredentials({
    refresh_token: row.refresh_token ?? undefined,
    access_token: row.access_token ?? undefined,
    expiry_date: row.expiry ? Date.parse(row.expiry) : undefined,
  });
  c.on("tokens", (t) => {
    getServiceSupabase().from(TABLE).update({
      access_token: t.access_token ?? undefined,
      expiry: t.expiry_date ? new Date(t.expiry_date).toISOString() : undefined,
      updated_at: new Date().toISOString(),
    }).eq("owner_user_id", row.owner_user_id).then(() => {}, () => {});
  });
  return c;
}

function emailFromIdToken(idToken?: string | null): string | null {
  if (!idToken) return null;
  try {
    const json = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString("utf8")) as { email?: string };
    return typeof json.email === "string" ? json.email : null;
  } catch { return null; }
}

/** Read the primary sendAs signature HTML from Gmail. */
async function pullSignature(client: OAuth2Client): Promise<{ email: string | null; signature: string | null }> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const { data } = await gmail.users.settings.sendAs.list({ userId: "me" });
  const list = data.sendAs ?? [];
  const primary = list.find((s) => s.isPrimary) ?? list.find((s) => s.isDefault) ?? list[0];
  const signature = (primary?.signature ?? "").trim();
  return { email: primary?.sendAsEmail ?? null, signature: signature || null };
}

/** Exchange the consent code, store tokens, then pull + cache the signature. */
export async function completeGmailConnect(userId: string, code: string): Promise<{ email: string | null; hasSignature: boolean }> {
  const { tokens } = await oauthClient().getToken(code);
  const client = oauthClient();
  client.setCredentials(tokens);
  let email = emailFromIdToken(tokens.id_token);
  let signature: string | null = null;
  try {
    const r = await pullSignature(client);
    signature = r.signature;
    email = r.email ?? email;
  } catch (e) {
    console.error("[gmailSig] pull on connect failed:", (e as Error)?.message);
  }
  const row: Record<string, unknown> = {
    owner_user_id: userId,
    access_token: tokens.access_token ?? null,
    expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    google_email: email,
    updated_at: new Date().toISOString(),
  };
  if (tokens.refresh_token) row.refresh_token = tokens.refresh_token; // only on the consent grant
  if (signature !== null) { row.signature_html = signature; row.signature_fetched_at = new Date().toISOString(); }
  await getServiceSupabase().from(TABLE).upsert(row, { onConflict: "owner_user_id" });
  return { email, hasSignature: !!signature };
}

/** Re-pull the signature from Gmail on demand (e.g. after the founder edits it). */
export async function refreshGmailSignature(userId: string): Promise<{ ok: boolean; hasSignature: boolean; error?: string }> {
  const row = await loadRow(userId);
  if (!row?.refresh_token) return { ok: false, hasSignature: false, error: "not_connected" };
  try {
    const { signature, email } = await pullSignature(clientFromRow(row));
    await getServiceSupabase().from(TABLE).update({
      signature_html: signature,
      signature_fetched_at: new Date().toISOString(),
      google_email: email ?? row.google_email,
      updated_at: new Date().toISOString(),
    }).eq("owner_user_id", userId);
    return { ok: true, hasSignature: !!signature };
  } catch (e) {
    return { ok: false, hasSignature: false, error: (e as Error)?.message || "fetch_failed" };
  }
}

/** The cached REAL Gmail signature HTML (used by outbound email). No arg → the
 *  single connected admin's signature. Returns null when not connected / unmigrated. */
export async function getStoredSignatureHtml(userId?: string | null): Promise<string | null> {
  try {
    const db = getServiceSupabase();
    const q = userId
      ? db.from(TABLE).select("signature_html").eq("owner_user_id", userId).limit(1)
      : db.from(TABLE).select("signature_html").order("updated_at", { ascending: false }).limit(1);
    const { data } = await q;
    const row = (data && (data as { signature_html: string | null }[])[0]) || null;
    return row?.signature_html?.trim() || null;
  } catch {
    return null; // table not migrated / transient → fall back to the built-in signature
  }
}

export async function gmailSignatureStatus(userId: string): Promise<{ connected: boolean; email: string | null; hasSignature: boolean }> {
  const row = await loadRow(userId);
  return { connected: !!row?.refresh_token, email: row?.google_email ?? null, hasSignature: !!(row?.signature_html && row.signature_html.trim()) };
}
