/**
 * Is the founder's global Telegram silence on? Read from inside the raw Worker
 * (cf-worker.ts scheduled()), which has no Next request scope and no supabase-js
 * client, before it alerts about a failed cron job.
 *
 * It reads app_settings where the portal WRITES it. On DATA_BACKEND="d1" the
 * toggle is saved through the service client, which then writes D1 — so reading
 * Supabase's REST API here would keep answering whatever the flag was at the
 * flip, and a silence set afterwards would be ignored by every cron alert.
 *
 * Fails CLOSED on both backends: any trouble reading it returns true (silent),
 * because the founder asked for silence and a missed cron alert costs less than
 * an unwanted message. Same rule as lib/telegram's telegramSilenced().
 */

type D1Statement = { bind(...values: unknown[]): { first<T>(): Promise<T | null> } };

export type SilenceEnv = {
  DATA_BACKEND?: string;
  BORIVON_DB?: { prepare(sql: string): D1Statement };
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export async function telegramSilencedWorker(env: SilenceEnv, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (env.DATA_BACKEND === "d1") {
    try {
      if (!env.BORIVON_DB) return true;
      const row = await env.BORIVON_DB
        .prepare(`SELECT "value" FROM "app_settings" WHERE "key" = ?`)
        .bind("telegram_silenced")
        .first<{ value: unknown }>();
      return row?.value === "on";
    } catch {
      return true;
    }
  }

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return true;
  try {
    const r = await fetchImpl(
      `${url}/rest/v1/app_settings?key=eq.telegram_silenced&select=value`,
      { headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3000) },
    );
    if (!r.ok) return true;
    const rows = (await r.json()) as { value?: unknown }[];
    return rows?.[0]?.value === "on";
  } catch {
    return true;
  }
}
