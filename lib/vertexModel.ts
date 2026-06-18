/**
 * Shared model factory — Claude on the Anthropic API. Used by BOTH the in-app
 * assistant route and the Telegram bot, so they run the same brain. Returns null
 * when ANTHROPIC_API_KEY isn't set, so callers degrade gracefully (feature inert).
 *
 * CLAUDE ONLY (founder's call, 2026-06-18): Gemini was removed entirely — no
 * primary, no fallback — for a clean week-long evaluation of Claude. The old
 * Gemini-on-Vertex path (and the dual-brain switch) lives in git history if we ever
 * want it back. (The name `vertexModel` is kept so callers don't have to change.)
 *
 * Default tier = Haiku 4.5 (cheapest Claude). ONE-LINE escape hatch to a smarter
 * Claude, no code edit: set ASSISTANT_CLAUDE_FLASH=claude-sonnet-4-6 in Vercel and
 * redeploy — only the model string changes.
 */
import { createAnthropic } from "@ai-sdk/anthropic";

export type ModelTier = "flash" | "pro";

function makeAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return createAnthropic({ apiKey: key });
}

const claudeFlashId = () => process.env.ASSISTANT_CLAUDE_FLASH || "claude-haiku-4-5";
const claudeProId = () => process.env.ASSISTANT_CLAUDE_PRO || "claude-sonnet-4-6";
// Pro tier hard-locked off — the bot runs on one Claude model (Haiku by default).
// Flip to true (and set ASSISTANT_CLAUDE_PRO) only if the founder wants a Pro tier.
const ALLOW_PRO = false;

/** True only when a DISTINCT, pricier Pro Claude tier is opted in. Hard-locked false. */
export function proConfigured(): boolean {
  return ALLOW_PRO && !!process.env.ASSISTANT_CLAUDE_PRO;
}

/** The Claude model for a tier (Haiku by default). Null if ANTHROPIC_API_KEY unset. */
export function vertexModel(tier: ModelTier = "flash") {
  const a = makeAnthropic();
  if (!a) return null;
  return a(tier === "pro" && ALLOW_PRO ? claudeProId() : claudeFlashId());
}

/**
 * Which brain to use — only consulted when a Pro tier is configured. Flash by
 * default; Pro for the hard, multi-step / multi-person / context-dependent
 * requests. Conservative: when in doubt about complexity, send to Pro.
 */
export function chooseTier(text: string, opts?: { hasHistory?: boolean; hasFile?: boolean; isVoice?: boolean }): ModelTier {
  if (!proConfigured()) return "flash";
  if (opts?.hasFile || opts?.isVoice) return "pro";
  const raw = (text || "").trim();
  const t = raw.toLowerCase();
  if (/\b(these|those|them|their|theirs|they|the same|same ones?|the others?|the rest|both|all\s+\d+|the\s+\d+)\b/.test(t)) return "pro";
  const commas = (raw.match(/,/g) || []).length;
  if (commas >= 2) return "pro";
  if (commas >= 1 && /\b(and|et|und)\b/.test(t)) return "pro";
  if (/\b(compare|versus|vs\.?|each|breakdown|then|after that|also (send|email|attach)|as well|one by one|step by step)\b/.test(t)) return "pro";
  if (raw.length > 220) return "pro";
  return "flash";
}

/** Did a Flash answer look like a punt a stronger brain should retry? (Pro tier only.) */
export function looksWeak(replyText: string): boolean {
  const r = (replyText || "").trim().toLowerCase();
  if (!r) return true;
  return /\bwhich\s+(one|candidate|person|hajar|lahcen)\b|could you (please )?(clarify|specify)|please (tell|provide|specify|give) me (the )?candidate|not sure who|who (do you mean|are you referring)/.test(r);
}
