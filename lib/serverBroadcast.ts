/**
 * Fire-and-forget Supabase BROADCAST from a server route (no websocket needed).
 *
 * Hits the Realtime HTTP broadcast endpoint with the service key, so any client
 * subscribed to `supabase.channel(topic)` receives the `event` instantly —
 * across browsers/sessions, with no RLS/publication setup (broadcast is plain
 * pub/sub, not Postgres-changes).
 *
 * Used to push an INSTANT "something changed" ping to open admin bells when a
 * candidate is (un)assigned to/from an organization, so an org admin's scoped
 * notification list drops/regains that candidate immediately instead of waiting
 * for the 15s poll backstop. Payload is intentionally empty — listeners just
 * re-fetch through their own authorized + scoped API.
 *
 * Best-effort: any failure is swallowed (the poll still self-corrects).
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function serverBroadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ messages: [{ topic, event, payload }] }),
    });
  } catch {
    /* best-effort — the 15s bell poll is the backstop */
  }
}

/** Global channel every admin bell listens on for assignment changes. */
export const ASSIGNMENTS_TOPIC = "bv-assignments";
