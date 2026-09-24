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
 *
 * ── THE BILLING OFF-SWITCH — ASSISTANT_ENABLED ─────────────────────────────────
 * The founder killed the AI spend (2026-09-20: "i dont want any billings again its
 * getting too expensive"). Vertex bills PER CALL, so what had to stop is the calls —
 * not the code, which he may want back. assistantEnabled() is that one switch, and
 * it is read HERE, at the factory, because every paid call in the app goes through
 * vertexModel() (the one exception, lib/transcribeVoice.ts, builds its own Vertex
 * client and so calls assistantEnabled() itself). Off ⇒ vertexModel() returns null,
 * which every caller already treats as "no brain configured" and degrades from.
 *
 * DEFAULT: OFF. It must be the literal string "true" to spend money. Default-off is
 * deliberate and costs nothing to get wrong, for two reasons:
 *   1. Shipping this code STOPS the billing on its own. A default-on flag would keep
 *      charging him until someone remembered to set a Worker var.
 *   2. OpenNext COMPILES env vars into the Worker bundle (see the memory note
 *      "OpenNext bakes env vars"): `wrangler secret delete` is a no-op, so "unset the
 *      var to disable" is not a reliable off-switch on this stack. "Set a var to
 *      ENABLE" is, because the absent var is the safe state.
 *
 * TO TURN THE BOT BACK ON: set ASSISTANT_ENABLED="true" (wrangler.jsonc "vars", where
 * it already sits as "false"), then `npm run cf:build && npm run cf:deploy` — the
 * REBUILD is required, because the value is baked in at build time. Nothing else was
 * removed: the tools, prompts, crons and Telegram wiring are all still here.
 *
 * WHAT THIS DOES NOT TOUCH: GOOGLE_VERTEX_CREDENTIALS is ALSO the service-account key
 * lib/googleWorkspace.ts uses for Drive / Gmail / Calendar (see its header). The agency
 * Drive mirror the founder depends on reads that same secret, so the credentials stay
 * exactly as they are — this switch stops CALLS, it never removes a key.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
// ONE Vertex entry point: the /edge build, on every runtime.
//
// This used to import BOTH builds and pick between them at runtime. The default
// (node) build authenticates through google-auth-library, and importing it cost
// 752,458 bytes of the Worker script — google-auth-library 245K, its
// web-streams-polyfill 184K, node-fetch 55K, bignumber.js 50K, gaxios 37K and the
// rest of that chain (measured with esbuild: node+edge = 1,607,680 B, edge alone =
// 855,222 B). Every one of those bytes was parsed on every cold start to serve a
// branch that CANNOT run: on workerd google-auth-library reaches
// node:http.validateHeaderName, which unenv does not implement, so the node build
// 500s the moment it is used — which is exactly why the runtime check existed.
// Deferring the import would not have helped; OpenNext inlines dynamic imports into
// the single Worker script, so the bytes stay (see commit 91ddf1c).
//
// The /edge build signs the service-account JWT with crypto.subtle and exchanges it
// over fetch — verified to contain no `node:` import at all and to construct on Node
// 25 — so it is not a Workers-only fallback, it is the path that works everywhere.
import { createVertex as createVertexEdge } from "@ai-sdk/google-vertex/edge";

export type ModelTier = "flash" | "pro";

/**
 * THE off-switch for every paid model call in the app (see the header). True only when
 * ASSISTANT_ENABLED is the literal string "true" — anything else, including unset, an
 * empty string, "1" or "yes", means OFF. Strict equality on purpose: a typo must fail
 * CLOSED (silent, free) rather than open (silent, billed), because a wrongly-ON bot is
 * only noticed on the invoice, while a wrongly-OFF bot is noticed the first time he
 * texts it and reads the reason.
 *
 * Read at CALL time, never cached in a module constant — a cached read would freeze
 * whatever the value was when the isolate first loaded this module.
 */
export function assistantEnabled(): boolean {
  return (process.env.ASSISTANT_ENABLED || "").trim() === "true";
}

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
  // The /edge client takes the service-account fields directly instead of handing
  // the whole JSON to google-auth-library, so read them out of the same secret.
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
  // THE BILLING GATE. First line on purpose: it must sit AHEAD of every provider branch,
  // or flipping ASSISTANT_PROVIDER / ASSISTANT_BRAIN would route around the switch and
  // start billing again on a different vendor. Null reads to every caller as "no brain
  // configured" — the path they already handle.
  if (!assistantEnabled()) return null;
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
  // Escalation is a SECOND paid call (Flash answer retried on Pro), so it dies with the
  // switch. Without this the webhook would still advertise self-healing while vertexModel()
  // hands back null.
  if (!assistantEnabled()) return false;
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
