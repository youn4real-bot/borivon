/**
 * Shared model factory — the bot's brain. Used by BOTH the in-app assistant route
 * and the Telegram bot, so they run the same model. Returns null when no key is set,
 * so callers degrade gracefully (feature inert).
 *
 * DEFAULT brain = GEMINI 2.5 FLASH on Vertex-Frankfurt (founder's call 2026-06-20:
 * "switch fully to Gemini Flash NOW" — fast + cheap, and Vertex billing already works so
 * there's no payment block like Groq's frozen Developer tier). Set ASSISTANT_BRAIN=claude
 * to revert to Claude instantly (Sonnet 4.6; override its id via ASSISTANT_CLAUDE_FLASH).
 * Gemini model id override: ASSISTANT_GEMINI_MODEL. NOTE: Gemini function-calling rejects
 * union/anyOf/regex/format in tool schemas — all ~160 bot tools are flat, so they're safe.
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
import { createVertex } from "@ai-sdk/google-vertex";
import { createVertex as createVertexEdge } from "@ai-sdk/google-vertex/edge";

// True on the Cloudflare Workers runtime (workerd sets this UA). On Workers the default
// google-auth-library auth path calls node:http funcs unenv doesn't implement
// (validateHeaderName) → the bot 500s mid-generation; the /edge Vertex variant auths via
// WebCrypto instead. On Vercel (Node) this is false and we keep the proven node path.
const ON_WORKERS = typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

export type ModelTier = "flash" | "pro";

/**
 * Gemini safety thresholds for EVERY Gemini call (main brain + voice transcription +
 * auto-close + self-learn). This is an INTERNAL ops tool with ONE fully-trusted user (the
 * founder); Gemini's default medium-threshold filters were FALSE-blocking benign business
 * content (a real chat: he pasted a candidate's email → "I cannot send… it goes against my
 * safety guidelines"). BLOCK_ONLY_HIGH still blocks genuinely severe content, needs no Vertex
 * allowlist, and never errors the call (unlike OFF/BLOCK_NONE on some categories). Pass via
 * providerOptions.{vertex,google}.safetySettings — the key differs by SDK path, so set both.
 * Claude ignores these keys, so it's a no-op when the brain is Claude.
 */
export const GEMINI_SAFETY: { category: string; threshold: string }[] = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
];

function makeAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return createAnthropic({ apiKey: key });
}

// Gemini Flash on Vertex (Frankfurt) — the DEFAULT brain (founder's call 2026-06-20:
// "switch fully to Gemini Flash" — fast + cheap, and the Vertex billing already works,
// so there's no payment block like Groq's frozen Developer tier). Reuses the SAME
// GOOGLE_VERTEX_* creds already present for voice transcription / Gmail / Calendar.
// Returns null if Vertex isn't configured, so vertexModel() safely falls back to Claude.
// All ~160 tool schemas are flat (no union/anyOf/regex/format) → Gemini-safe.
const geminiId = () => process.env.ASSISTANT_GEMINI_MODEL || "gemini-2.5-flash";
const geminiProId = () => process.env.ASSISTANT_GEMINI_PRO || "gemini-2.5-pro";
function makeVertexGemini() {
  const project = process.env.GOOGLE_VERTEX_PROJECT;
  const credsRaw = process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (!project || !credsRaw) return null;
  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(credsRaw); } catch { return null; }
  const location = process.env.GOOGLE_VERTEX_LOCATION || "europe-west4";
  if (ON_WORKERS) {
    // Cloudflare Workers: the node google-auth-library path 500s (node:http.validateHeaderName
    // is unimplemented by unenv). The /edge Vertex variant signs the service-account JWT with
    // WebCrypto and exchanges it via fetch — no node:http, no google-auth-library.
    const clientEmail = String(credentials.client_email || "");
    const privateKey = String(credentials.private_key || "");
    if (!clientEmail || !privateKey) return null;
    return createVertexEdge({
      project,
      location,
      googleCredentials: {
        clientEmail,
        privateKey,
        privateKeyId: credentials.private_key_id ? String(credentials.private_key_id) : undefined,
      },
    });
  }
  return createVertex({ project, location, googleAuthOptions: { credentials } });
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

/** The model for a tier. Precedence: (1) an explicit Groq/OpenRouter alt provider, then
 *  (2) the DEFAULT brain = Gemini Flash on Vertex (founder's call 2026-06-20), then
 *  (3) Claude as the safe fallback. Override the brain with ASSISTANT_BRAIN: "claude" to
 *  revert to Claude, "gemini" (default) for Gemini Flash. Null only if NOTHING configured. */
export function vertexModel(tier: ModelTier = "flash") {
  const alt = altProvider();
  if (alt) return alt.client(alt.model);
  const brain = (process.env.ASSISTANT_BRAIN || "gemini").trim().toLowerCase();
  if (brain !== "claude") {
    const g = makeVertexGemini();
    // Flash drives every turn; "pro" = Gemini 2.5 Pro, used only for the self-healing
    // escalation (a weak/failed Flash answer is retried on Pro — same Vertex billing).
    if (g) return g(tier === "pro" ? geminiProId() : geminiId());
  }
  const a = makeAnthropic();
  if (!a) return null;
  return a(tier === "pro" && ALLOW_PRO ? claudeProId() : claudeFlashId());
}

/** SELF-HEALING escalation is live when the brain is Gemini on Vertex: the webhook runs
 *  Flash first, and silently retries a weak/empty/errored answer on Gemini 2.5 Pro — no
 *  human, no Claude Code. (Off when an alt provider is set, or brain forced to Claude.) */
export function escalationActive(): boolean {
  if (altProvider()) return false;
  const brain = (process.env.ASSISTANT_BRAIN || "gemini").trim().toLowerCase();
  if (brain === "claude") return false;
  return makeVertexGemini() !== null;
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
