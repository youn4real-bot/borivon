/**
 * Signed links for the Fahrplan emails: confirm the tips (double opt-in) and
 * unsubscribe. HMAC-SHA256 over "<purpose>:<leadId>" with a server secret, so a
 * link cannot be forged for someone else's lead. Web Crypto: runs on Workers
 * and Node alike.
 */
export type TokenPurpose = "confirm" | "unsub";

function secret(): string {
  return (process.env.DL_TOKEN_SECRET || process.env.CRON_SECRET || "").trim();
}

export function tokensEnabled(): boolean {
  return secret().length >= 16;
}

const b64url = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function signLeadToken(purpose: TokenPurpose, leadId: string, key = secret()): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`roadmap:${purpose}:${leadId}`));
  return b64url(sig).slice(0, 32);
}

/** Constant-time compare of a presented token against the expected one. */
export async function verifyLeadToken(purpose: TokenPurpose, leadId: string, token: string, key = secret()): Promise<boolean> {
  if (!key || !leadId || !token) return false;
  const want = await signLeadToken(purpose, leadId, key);
  if (want.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
