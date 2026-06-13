/**
 * Shared Gemini-on-Vertex model factory (EU/Frankfurt region) — used by BOTH the
 * in-app assistant route and the Telegram bot, so they run the same brain with
 * the same EU data-residency posture. Returns null when the Vertex key isn't
 * configured, so callers can degrade gracefully (the feature stays inert).
 *
 * HYBRID ROUTING (cost control): cheap Flash handles everyday messages; the
 * pricier Pro brain is reserved for the HARD requests where Flash fumbles —
 * multi-person, "these candidates" context references, comparisons, files,
 * voice. chooseTier() decides up front; callers also retry on Pro if a Flash
 * answer looks weak (looksWeak()). Both model ids are env-overridable.
 */
import { createVertex } from "@ai-sdk/google-vertex";

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

// ASSISTANT_MODEL_ID kept as a legacy override of the Flash default.
const flashId = () => process.env.ASSISTANT_MODEL_ID_FLASH || process.env.ASSISTANT_MODEL_ID || "gemini-2.5-flash";
const proId = () => process.env.ASSISTANT_MODEL_ID_PRO || "gemini-2.5-pro";

/** The model for a tier (default Flash). Returns null if Vertex isn't configured. */
export function vertexModel(tier: ModelTier = "flash") {
  const vertex = makeVertex();
  if (!vertex) return null;
  return vertex(tier === "pro" ? proId() : flashId());
}

/**
 * Pick the brain BEFORE running: Flash by default (cheap), Pro for the hard,
 * multi-step / multi-person / context-dependent requests where Flash stumbles.
 * Deterministic + conservative — when in doubt about complexity, send to Pro.
 */
export function chooseTier(text: string, opts?: { hasHistory?: boolean; hasFile?: boolean; isVoice?: boolean }): ModelTier {
  if (opts?.hasFile || opts?.isVoice) return "pro"; // identify-candidate / transcribe = multi-step
  const raw = (text || "").trim();
  const t = raw.toLowerCase();

  // Context references — the bot must resolve WHO from prior turns (Flash's weak
  // spot: it grabbed the wrong people for "give me their B2 status").
  if (/\b(these|those|them|their|theirs|they|the same|same ones?|the others?|the rest|both|all\s+\d+|the\s+\d+)\b/.test(t)) return "pro";

  // A list of people/items → multi-entity resolution.
  const commas = (raw.match(/,/g) || []).length;
  if (commas >= 2) return "pro";
  if (commas >= 1 && /\b(and|et|und)\b/.test(t)) return "pro";

  // Multi-step / comparison / chained instructions.
  if (/\b(compare|versus|vs\.?|each|breakdown|then|after that|also (send|email|attach)|as well|one by one|step by step)\b/.test(t)) return "pro";

  // Long, dense message → likely complex.
  if (raw.length > 220) return "pro";

  return "flash";
}

/**
 * Did a Flash answer look like a failure/punt a stronger brain should retry?
 * Catches the "which one?" clarification loop + empty replies. Kept narrow so
 * legitimate single answers aren't needlessly re-run on Pro.
 */
export function looksWeak(replyText: string): boolean {
  const r = (replyText || "").trim().toLowerCase();
  if (!r) return true; // empty reply → escalate
  return /\bwhich\s+(one|candidate|person|hajar|lahcen)\b|could you (please )?(clarify|specify)|please (tell|provide|specify|give) me (the )?candidate|not sure who|who (do you mean|are you referring)/.test(r);
}
