/**
 * Shared model factory — used by BOTH the in-app assistant route and the Telegram
 * bot, so they run the same brain. Returns null when no model key is configured,
 * so callers can degrade gracefully (the feature stays inert).
 *
 * CLAUDE FIRST (the founder's chosen brain, 2026-06-18): when ANTHROPIC_API_KEY is
 * set, the WHOLE bot runs on Claude — Haiku 4.5 by default. Delete the key and it
 * falls straight back to Gemini-on-Vertex (everything below) with zero other
 * changes. See makeAnthropic() for the why + the one-line escape hatch to Sonnet.
 *
 * GEMINI FALLBACK — FLASH BY DEFAULT (cost): with no Anthropic key, everything runs
 * on cheap gemini-2.5-flash, made reliable through the WIRING, not a bigger model —
 * batch tools (getCvLinks / getB2Status) collapse multi-step work into one call,
 * conversation history resolves "these candidates", and worked examples pin the
 * behaviour that used to fumble.
 *
 * OPTIONAL PRO: a pricier brain is only used when ASSISTANT_MODEL_ID_PRO is set
 * in the env — then chooseTier() routes the HARD requests to it and Flash answers
 * get escalated on a weak reply. Unset (the default) ⇒ pure Flash, zero Pro spend.
 */
import { createVertex } from "@ai-sdk/google-vertex";
import { createAnthropic } from "@ai-sdk/anthropic";

export type ModelTier = "flash" | "pro";

function makeVertex() {
  const project = process.env.GOOGLE_VERTEX_PROJECT;
  const location = process.env.GOOGLE_VERTEX_LOCATION || "europe-west4";
  const credsRaw = process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (!project || !credsRaw) return null;
  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(credsRaw); } catch { return null; }
  return createVertex({ project, location, googleAuthOptions: { credentials } });
}

// ── CLAUDE — the founder's chosen brain (2026-06-18) ─────────────────────────
// When ANTHROPIC_API_KEY is set, the WHOLE bot runs on Claude instead of Gemini:
// Haiku 4.5 for the default tier (cheap, 200K context, and — unlike Flash — it
// actually OBEYS the remembered standing-instructions every turn, which was the
// real reason Flash felt "dumb"). This is the ONLY switch: delete the key and the
// entire bot falls straight back to Gemini-on-Vertex with zero other changes.
//
// ONE-LINE ESCAPE HATCH to a smarter brain — NO code edit, NO new deploy logic:
// set the Vercel env var ASSISTANT_CLAUDE_FLASH=claude-sonnet-4-6 and redeploy.
// Everything keeps working; only the model string changes.
function makeAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return createAnthropic({ apiKey: key });
}
const claudeFlashId = () => process.env.ASSISTANT_CLAUDE_FLASH || "claude-haiku-4-5";
const claudeProId = () => process.env.ASSISTANT_CLAUDE_PRO || "claude-sonnet-4-6";

// ────────────────────────────────────────────────────────────────────────────
// HARD LOCK — FLASH ONLY. Founder's decision (2026-06-14), after the long
// Flash↔Pro back-and-forth: the bot runs on gemini-2.5-flash and must NEVER
// escalate to Pro — not through the hybrid router, not by anyone setting an env
// var. `ALLOW_PRO` is the SINGLE switch; while it's false, nothing else can turn
// Pro on. Flip it to `true` (and set ASSISTANT_MODEL_ID_PRO) ONLY if the founder
// explicitly asks for the Pro / hybrid brain again.
const ALLOW_PRO = false;

const flashId = () => process.env.ASSISTANT_MODEL_ID_FLASH || process.env.ASSISTANT_MODEL_ID || "gemini-2.5-flash";
// Pro is hard-locked off: proId always resolves to the Flash id unless ALLOW_PRO
// is explicitly enabled — so even a stray ASSISTANT_MODEL_ID_PRO can't take effect.
const proId = () => (ALLOW_PRO && process.env.ASSISTANT_MODEL_ID_PRO) || flashId();

/** True only when a DISTINCT, pricier Pro model has been opted into via env AND
 *  the hard lock is open. Hard-locked to false → chooseTier() always stays Flash. */
export function proConfigured(): boolean {
  return ALLOW_PRO && !!process.env.ASSISTANT_MODEL_ID_PRO;
}

/** The model for a tier. Claude when ANTHROPIC_API_KEY is set (Haiku default),
 *  else Gemini-on-Vertex (Flash). Returns null only when NEITHER is configured. */
export function vertexModel(tier: ModelTier = "flash") {
  // Claude first — the founder's chosen brain. Pro tier only resolves to a
  // distinct (pricier) model when the hard lock is open; otherwise stays Haiku.
  const anthropic = makeAnthropic();
  if (anthropic) return anthropic(tier === "pro" && ALLOW_PRO ? claudeProId() : claudeFlashId());
  // Gemini-on-Vertex fallback.
  const vertex = makeVertex();
  if (!vertex) return null;
  return vertex(tier === "pro" ? proId() : flashId());
}

/** Gemini-on-Vertex ALWAYS — ignoring the Anthropic key. The resilience net: when
 *  the Claude call fails (most importantly the Anthropic Tier-1 rate limit), the bot
 *  retries the same request on Gemini, which has far higher quota, so a simple task
 *  (pull a file, answer a question) still GETS DONE instead of hard-failing. Returns
 *  null if Vertex isn't configured (then there's nothing to fall back to). */
export function geminiFallbackModel(tier: ModelTier = "flash") {
  const vertex = makeVertex();
  if (!vertex) return null;
  return vertex(tier === "pro" ? proId() : flashId());
}

/** Is the bot currently running on Claude? (Drives the rate-limit→Gemini fallback.) */
export function isOnClaude(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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
