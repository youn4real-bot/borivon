/**
 * Shared model factory — used by BOTH the in-app assistant route and the Telegram
 * bot, so they run the same brain. Returns null when no model is configured, so
 * callers can degrade gracefully (the feature stays inert).
 *
 * ── PRIMARY BRAIN: flip ONE constant to switch the whole bot ──────────────────
 * PRIMARY_BRAIN picks the main brain; the OTHER configured brain becomes the
 * automatic fallback (used when the primary errors — e.g. a rate limit). History:
 *   2026-06-18  Gemini Flash → Claude Haiku 4.5 (Flash ignored the taught rules)
 *   2026-06-18  Claude → GEMINI PRO (founder test): Pro follows the rules like
 *               Claude does, but has Google's far-higher Vertex ceiling (no Tier-1
 *               rate wall) AND keeps candidate data in the EU (Frankfurt). Claude
 *               Haiku stays wired as the fallback so neither brain hard-fails.
 * To make Claude primary again, set PRIMARY_BRAIN = "claude" — that's the only line.
 */
import { createVertex } from "@ai-sdk/google-vertex";
import { createAnthropic } from "@ai-sdk/anthropic";

export type ModelTier = "flash" | "pro";
export type Brain = "gemini" | "claude";

// ⇩⇩⇩ THE switch. One line flips the bot's main brain. ⇩⇩⇩
export const PRIMARY_BRAIN: Brain = "claude";

// ── Gemini on Vertex (EU/Frankfurt) ──────────────────────────────────────────
function makeVertex() {
  const project = process.env.GOOGLE_VERTEX_PROJECT;
  const location = process.env.GOOGLE_VERTEX_LOCATION || "europe-west4";
  const credsRaw = process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (!project || !credsRaw) return null;
  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(credsRaw); } catch { return null; }
  return createVertex({ project, location, googleAuthOptions: { credentials } });
}
// The Gemini BRAIN is Gemini PRO — the founder left Flash because it ignored the
// taught rules; Pro follows them and still has the huge Vertex ceiling + EU
// residency. Override the exact id with ASSISTANT_GEMINI_PRO (e.g. a newer Pro).
const geminiProId = () => process.env.ASSISTANT_GEMINI_PRO || "gemini-2.5-pro";
function makeGemini() {
  const vertex = makeVertex();
  if (!vertex) return null;
  return vertex(geminiProId());
}

// ── Claude on the Anthropic API ──────────────────────────────────────────────
function makeAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return createAnthropic({ apiKey: key });
}
// Default Claude tier = Haiku 4.5. ONE-LINE escape hatch to a smarter Claude (no
// code edit): set ASSISTANT_CLAUDE_FLASH=claude-sonnet-4-6 in Vercel and redeploy.
const claudeFlashId = () => process.env.ASSISTANT_CLAUDE_FLASH || "claude-haiku-4-5";
const claudeProId = () => process.env.ASSISTANT_CLAUDE_PRO || "claude-sonnet-4-6";
const ALLOW_PRO = false; // Claude Pro tier hard-locked off (chooseTier stays Flash).
function makeClaude(tier: ModelTier) {
  const a = makeAnthropic();
  if (!a) return null;
  return a(tier === "pro" && ALLOW_PRO ? claudeProId() : claudeFlashId());
}

function brainModel(brain: Brain, tier: ModelTier) {
  return brain === "gemini" ? makeGemini() : makeClaude(tier);
}
const otherOf = (b: Brain): Brain => (b === "gemini" ? "claude" : "gemini");

/** Which brain is ACTUALLY primary — PRIMARY_BRAIN if it's configured, else the
 *  other one (so the bot still runs when only one brain is set up). */
export function primaryBrain(): Brain {
  return brainModel(PRIMARY_BRAIN, "flash") ? PRIMARY_BRAIN : otherOf(PRIMARY_BRAIN);
}

/** True only when a DISTINCT, pricier Pro Claude tier is opted in. Hard-locked false. */
export function proConfigured(): boolean {
  return ALLOW_PRO && !!process.env.ASSISTANT_CLAUDE_PRO;
}

/** The PRIMARY brain's model for a tier. Null only if NEITHER brain is configured. */
export function vertexModel(tier: ModelTier = "flash") {
  return brainModel(primaryBrain(), tier);
}

/** The OTHER brain's model — the automatic fallback when the primary errors (rate
 *  limit, transient). Null if the other brain isn't configured (then no fallback). */
export function fallbackModel(tier: ModelTier = "flash") {
  return brainModel(otherOf(primaryBrain()), tier);
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
