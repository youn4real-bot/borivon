/**
 * AI token-usage tracking — logs each bot turn's token counts and sums them by
 * period for the getApiUsage tool. FAIL-SAFE: if the assistant_token_usage table
 * isn't migrated, logging is a silent no-op and the summary returns not_set_up.
 *
 * Usage accrues from when the table exists onward (we can't backfill what was
 * never logged); Google's authoritative billing is in the Cloud console.
 */
import { getServiceSupabase } from "@/lib/supabase";

/** Pull input/output token counts out of whatever shape the AI SDK returned
 *  (v6: inputTokens/outputTokens; older: promptTokens/completionTokens). */
export function extractTokens(usage: unknown): { input: number; output: number } {
  const u = (usage ?? {}) as Record<string, unknown>;
  const num = (...keys: string[]): number => {
    for (const k of keys) { const v = u[k]; if (typeof v === "number" && Number.isFinite(v)) return v; }
    return 0;
  };
  return {
    input: Math.max(0, Math.round(num("inputTokens", "promptTokens"))),
    output: Math.max(0, Math.round(num("outputTokens", "completionTokens"))),
  };
}

/** Rough USD estimate, priced to whatever brain the bot is actually running.
 *  Deliberately approximate — for "am I burning money?" not invoicing. Tracks the
 *  same env switch as vertexModel: Claude (Haiku $1/$5, or Sonnet/Opus if the
 *  escape-hatch env points there) when ANTHROPIC_API_KEY is set, else Gemini 2.5
 *  Flash ($0.30/$2.50). NOTE: once prompt caching is on, the real input bill is
 *  lower than this (cache reads bill ~0.1×) — this stays a safe upper bound. */
export function estimateCostUsd(input: number, output: number): number {
  let inRate = 0.30, outRate = 2.50; // Gemini 2.5 Flash, per 1M tokens
  if (process.env.ANTHROPIC_API_KEY) {
    const m = (process.env.ASSISTANT_CLAUDE_FLASH || "claude-haiku-4-5").toLowerCase();
    if (m.includes("opus")) { inRate = 5.00; outRate = 25.00; }
    else if (m.includes("sonnet")) { inRate = 3.00; outRate = 15.00; }
    else { inRate = 1.00; outRate = 5.00; } // Haiku 4.5 (the default)
  }
  const usd = (input / 1_000_000) * inRate + (output / 1_000_000) * outRate;
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

/** Log one turn's token usage. Best-effort; never throws, never blocks. */
export async function logUsage(usage: unknown, model: string, source: string): Promise<void> {
  const { input, output } = extractTokens(usage);
  if (!input && !output) return;
  try {
    await getServiceSupabase().from("assistant_token_usage").insert({
      input_tokens: input, output_tokens: output, model: (model || "").slice(0, 60), source: (source || "").slice(0, 40),
    });
  } catch {
    /* table not migrated yet / transient → drop silently */
  }
}

export type UsageSummary =
  | { ok: true; period: UsagePeriod; calls: number; input: number; output: number; total: number; estCostUsd: number }
  | { ok: false; error: string };

/** Sum token usage over the period. */
export async function getUsageSummary(period: UsagePeriod, now: number = Date.now()): Promise<UsageSummary> {
  try {
    const since = new Date(periodStartMs(period, now)).toISOString();
    const { data, error } = await getServiceSupabase()
      .from("assistant_token_usage")
      .select("input_tokens, output_tokens")
      .gte("created_at", since);
    if (error) return { ok: false, error: "not_set_up" };
    const rows = (data ?? []) as { input_tokens: number; output_tokens: number }[];
    const input = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
    const output = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);
    return { ok: true, period, calls: rows.length, input, output, total: input + output, estCostUsd: estimateCostUsd(input, output) };
  } catch {
    return { ok: false, error: "not_set_up" };
  }
}
