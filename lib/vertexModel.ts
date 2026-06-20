/**
 * Shared model factory — the bot's brain. Used by BOTH the in-app assistant route
 * and the Telegram bot, so they run the same model. Returns null when no key is set,
 * so callers degrade gracefully (feature inert).
 *
 * DEFAULT brain = Claude SONNET 4.6 (founder's call 2026-06-19): the closest affordable
 * match to "answer like Claude Code does". Override the Claude model per env without a
 * code edit: ASSISTANT_CLAUDE_FLASH (e.g. claude-haiku-4-5 / claude-opus-4-8).
 *
 * GROQ / OPENROUTER (founder wants raw SPEED): set ASSISTANT_PROVIDER to flip the brain
 * to ANY OpenAI-compatible host WITHOUT a code change — Claude stays default until then.
 *   ASSISTANT_PROVIDER = "groq" | "openrouter" | "openai-compatible"
 *   ASSISTANT_LLM_API_KEY = the provider key (Groq key, or OpenRouter key)
 *   ASSISTANT_LLM_MODEL   = the model id, e.g. Groq "moonshotai/kimi-k2-instruct" or
 *                           "llama-3.3-70b-versatile"; OpenRouter "moonshotai/kimi-k2"
 *   ASSISTANT_LLM_BASE_URL = optional override (groq/openrouter default URLs are built in)
 * Base URLs default: groq → https://api.groq.com/openai/v1, openrouter →
 * https://openrouter.ai/api/v1. To revert to Claude: unset ASSISTANT_PROVIDER. NOTE the
 * bot drives ~160 tools — only a strong tool-calling model holds up (Kimi K2 recommended
 * on Groq; Llama/GPT-OSS are weaker at function-calling). A/B on real "pull the email
 * from X" requests before committing; flip back instantly if it regresses.
 *
 * Gemini-on-Vertex stays ONLY for voice transcription (lib/transcribeVoice.ts).
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export type ModelTier = "flash" | "pro";

function makeAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return createAnthropic({ apiKey: key });
}

const claudeFlashId = () => process.env.ASSISTANT_CLAUDE_FLASH || "claude-sonnet-4-6";
const claudeProId = () => process.env.ASSISTANT_CLAUDE_PRO || "claude-sonnet-4-6";
// Pro tier hard-locked off — the bot runs on one Claude model (Sonnet by default).
// Flip to true (and set ASSISTANT_CLAUDE_PRO) only if the founder wants a Pro tier.
const ALLOW_PRO = false;

/** True only when a DISTINCT, pricier Pro Claude tier is opted in. Hard-locked false. */
export function proConfigured(): boolean {
  return ALLOW_PRO && !!process.env.ASSISTANT_CLAUDE_PRO;
}

/** Which alt provider (Groq / OpenRouter / any OpenAI-compatible host) is configured, or
 *  null = stay on Claude. Requires ASSISTANT_PROVIDER + a key + a model id. */
function altProvider(): { client: ReturnType<typeof createOpenAICompatible>; model: string } | null {
  const provider = (process.env.ASSISTANT_PROVIDER || "").trim().toLowerCase();
  if (!provider || provider === "anthropic" || provider === "claude") return null;
  const apiKey = (process.env.ASSISTANT_LLM_API_KEY || "").trim();
  const model = (process.env.ASSISTANT_LLM_MODEL || "").trim();
  if (!apiKey || !model) return null; // misconfigured → fall back to Claude, never break
  const baseURL = (process.env.ASSISTANT_LLM_BASE_URL || "").trim()
    || (provider === "groq" ? "https://api.groq.com/openai/v1"
      : provider === "openrouter" ? "https://openrouter.ai/api/v1"
      : "");
  if (!baseURL) return null; // unknown provider with no explicit base URL → stay on Claude
  const client = createOpenAICompatible({ name: provider, apiKey, baseURL });
  return { client, model };
}

/** Is the brain currently a non-Claude (Groq/OpenRouter) provider? */
export function altBrainActive(): boolean {
  return altProvider() !== null;
}

/** The model for a tier. Groq/OpenRouter when configured (both tiers = the one alt model),
 *  else Claude (Sonnet by default). Null only if NOTHING is configured. */
export function vertexModel(tier: ModelTier = "flash") {
  const alt = altProvider();
  if (alt) return alt.client(alt.model);
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
