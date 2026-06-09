import { AccessToken, WebhookReceiver } from "livekit-server-sdk";

/**
 * LiveKit server helpers for the live classroom.
 *
 * Env (set on Vercel once you have a LiveKit project — Cloud free tier OR your
 * self-hosted server on the VPS):
 *   LIVEKIT_URL         wss://…           (the signalling URL the browser connects to)
 *   LIVEKIT_API_KEY     API key
 *   LIVEKIT_API_SECRET  API secret
 *
 * Until those are set, livekitConfigured() is false → the classroom shows a
 * "configure LiveKit" notice and never errors (dormant, like the old scaffold).
 */

export function livekitUrl(): string {
  return (process.env.LIVEKIT_URL ?? "").trim();
}
function apiKey(): string { return (process.env.LIVEKIT_API_KEY ?? "").trim(); }
function apiSecret(): string { return (process.env.LIVEKIT_API_SECRET ?? "").trim(); }

export function livekitConfigured(): boolean {
  return !!livekitUrl() && !!apiKey() && !!apiSecret();
}

/**
 * Mint a join token. identity MUST be the candidate's user_id so every
 * server-side webhook event (and our own logs) ties cleanly to a person.
 */
export async function mintClassroomToken(opts: {
  room: string;
  identity: string;
  name?: string;
  canPublish?: boolean;       // false = view-only (e.g. an observer)
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const at = new AccessToken(apiKey(), apiSecret(), {
    identity: opts.identity,
    name: opts.name,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
    ttl: "3h",
  });
  at.addGrant({
    roomJoin: true,
    room: opts.room,
    canPublish: opts.canPublish ?? true,
    canSubscribe: true,
    canPublishData: true,   // for exercise actions / hand-raise over the data channel
  });
  return at.toJwt();
}

export function getWebhookReceiver(): WebhookReceiver {
  return new WebhookReceiver(apiKey(), apiSecret());
}
