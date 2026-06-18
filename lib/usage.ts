/**
 * AI token-usage tracking — logs each bot turn's token counts and sums them by
 * period for the getApiUsage tool. FAIL-SAFE: if the assistant_token_usage table
 * isn't migrated, logging is a silent no-op and the summary returns not_set_up.
 *
 * Usage accrues from when the table exists onward (we can't backfill what was
 * never logged); Google's authoritative billing is in the Cloud console.
 */
import { getServiceSupabase } from "@/lib/supabase";

/** Pull token counts out of whatever shape the AI SDK returned.
 *  - input/output: v6 inputTokens/outputTokens; older promptTokens/completionTokens.
 *  - cacheRead/cacheWrite: the prompt-caching split (ai v6 usage.inputTokenDetails).
 *    `input` is the TOTAL prompt input (= noCache + cacheRead + cacheWrite), so the
 *    full-price portion is input − cacheRead − cacheWrite. cacheRead bills ~0.1×,
 *    cacheWrite ~1.25×. Zeros when caching is off or the field is absent. */
export function extractTokens(usage: unknown): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const u = (usage ?? {}) as Record<string, unknown>;
  const num = (obj: Record<string, unknown>, ...keys: string[]): number => {
    for (const k of keys) { const v = obj[k]; if (typeof v === "number" && Number.isFinite(v)) return v; }
    return 0;
  };
  const details = (u.inputTokenDetails ?? {}) as Record<string, unknown>;
  return {
    input: Math.max(0, Math.round(num(u, "inputTokens", "promptTokens"))),
    output: Math.max(0, Math.round(num(u, "outputTokens", "completionTokens"))),
    // cacheReadTokens is the standardized field; cachedInputTokens is the deprecated alias.
    cacheRead: Math.max(0, Math.round(num(details, "cacheReadTokens") || num(u, "cachedInputTokens"))),
    cacheWrite: Math.max(0, Math.round(num(details, "cacheWriteTokens"))),
  };
}

/** Rough USD estimate for Claude (the only brain now) + the prompt-cache split.
 *  Deliberately approximate — for "am I burning money?" not invoicing. Rates per 1M
 *  tokens, keyed to the configured model id: Haiku $1/$5 (default), Sonnet $3/$15,
 *  Opus $5/$25. Caching multipliers (Anthropic): fresh input 1×, cache WRITE 1.25×,
 *  cache READ 0.1×. `input` is the TOTAL prompt input, so fresh = input − cacheRead −
 *  cacheWrite. cacheRead/cacheWrite default 0 (caching off) → full rate. */
export function estimateCostUsd(input: number, output: number, cacheRead = 0, cacheWrite = 0): number {
  const m = (process.env.ASSISTANT_CLAUDE_FLASH || "claude-haiku-4-5").toLowerCase();
  let inRate = 1.00, outRate = 5.00; // Haiku 4.5 (the default)
  if (m.includes("opus")) { inRate = 5.00; outRate = 25.00; }
  else if (m.includes("sonnet")) { inRate = 3.00; outRate = 15.00; }
  const fresh = Math.max(0, input - cacheRead - cacheWrite);
  const inputUsd =
    (fresh / 1_000_000) * inRate +
    (cacheWrite / 1_000_000) * inRate * 1.25 +
    (cacheRead / 1_000_000) * inRate * 0.1;
  const usd = inputUsd + (output / 1_000_000) * outRate;
  return Math.round(usd * 100) / 100;
}

export type UsagePeriod = "today" | "week" | "month";

/** Epoch-ms start of the period: today = since UTC midnight; week = last 7 days;
 *  month = last 30 days. */
export function periodStartMs(period: UsagePeriod, now: number): number {
  if (period === "today") { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.getTime(); }
  const days = period === "week" ? 7 : 30;
  return now - days * 86_400_000;
}

/** Log one turn's token usage. Best-effort; never throws, never blocks.
 *  Forward-compatible: tries to store the cache split, and if the cache columns
 *  aren't migrated yet (assistant_token_usage_cache.sql), retries WITHOUT them so
 *  base usage logging keeps working — cost just reverts to a safe full-rate upper
 *  bound until the column migration is run. */
export async function logUsage(usage: unknown, model: string, source: string): Promise<void> {
  const { input, output, cacheRead, cacheWrite } = extractTokens(usage);
  if (!input && !output) return;
  const base = {
    input_tokens: input, output_tokens: output,
    model: (model || "").slice(0, 60), source: (source || "").slice(0, 40),
  };
  try {
    const db = getServiceSupabase();
    const { error } = await db.from("assistant_token_usage")
      .insert({ ...base, cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite });
    if (error) await db.from("assistant_token_usage").insert(base); // pre-migration fallback
  } catch {
    /* table not migrated yet / transient → drop silently */
  }
}

export type UsageSummary =
  | { ok: true; period: UsagePeriod; calls: number; input: number; output: number; total: number;
      cacheRead: number; cacheWrite: number; cacheHitPct: number; estCostUsd: number }
  | { ok: false; error: string };

/** Sum token usage over the period. Reports the cache split + a cache-hit % so the
 *  founder can SEE prompt caching working (and the $ reflects the ~0.1× cache reads).
 *  Falls back gracefully if the cache columns aren't migrated yet. */
export async function getUsageSummary(period: UsagePeriod, now: number = Date.now()): Promise<UsageSummary> {
  try {
    const since = new Date(periodStartMs(period, now)).toISOString();
    const db = getServiceSupabase();
    // Try the cache-aware select; if those columns don't exist yet, fall back to base.
    let data: unknown[] | null = null;
    const withCache = await db.from("assistant_token_usage")
      .select("input_tokens, output_tokens, cache_read_tokens, cache_write_tokens")
      .gte("created_at", since);
    if (withCache.error) {
      const baseOnly = await db.from("assistant_token_usage")
        .select("input_tokens, output_tokens")
        .gte("created_at", since);
      if (baseOnly.error) return { ok: false, error: "not_set_up" };
      data = baseOnly.data;
    } else {
      data = withCache.data;
    }
    const rows = (data ?? []) as { input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_write_tokens?: number }[];
    const input = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
    const output = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);
    const cacheRead = rows.reduce((s, r) => s + (r.cache_read_tokens || 0), 0);
    const cacheWrite = rows.reduce((s, r) => s + (r.cache_write_tokens || 0), 0);
    const cacheHitPct = input > 0 ? Math.round((cacheRead / input) * 100) : 0;
    return {
      ok: true, period, calls: rows.length, input, output, total: input + output,
      cacheRead, cacheWrite, cacheHitPct, estCostUsd: estimateCostUsd(input, output, cacheRead, cacheWrite),
    };
  } catch {
    return { ok: false, error: "not_set_up" };
  }
}
