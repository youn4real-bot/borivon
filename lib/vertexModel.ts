/**
 * Shared Gemini-on-Vertex model factory (EU/Frankfurt region) — used by BOTH the
 * in-app assistant route and the Telegram bot, so they run the same brain with
 * the same EU data-residency posture. Returns null when the Vertex key isn't
 * configured, so callers can degrade gracefully (the feature stays inert).
 *
 * FLASH BY DEFAULT (cost): everything runs on cheap gemini-2.5-flash. Flash is
 * made reliable through the WIRING, not a bigger model — batch tools (getCvLinks
 * / getB2Status) collapse multi-step work into one call, conversation history
 * resolves "these candidates", and worked examples in the prompts pin the
 * behaviour that used to fumble.
 *
 * OPTIONAL PRO: a pricier brain is only used when ASSISTANT_MODEL_ID_PRO is set
 * in the env — then chooseTier() routes the HARD requests to it and Flash answers
 * get escalated on a weak reply. Unset (the default) ⇒ pure Flash, zero Pro spend.
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

const flashId = () => process.env.ASSISTANT_MODEL_ID_FLASH || process.env.ASSISTANT_MODEL_ID || "gemini-2.5-flash";
// Pro falls back to the Flash id, so without ASSISTANT_MODEL_ID_PRO there is NO
// separate Pro tier and nothing ever costs more than Flash.
const proId = () => process.env.ASSISTANT_MODEL_ID_PRO || flashId();

/** True only when a DISTINCT, pricier Pro model has been opted into via env. */
export function proConfigured(): boolean {
  return !!process.env.ASSISTANT_MODEL_ID_PRO;
}

/** The model for a tier (default Flash). Returns null if Vertex isn't configured. */
export function vertexModel(tier: ModelTier = "flash") {
  const vertex = makeVertex();
  if (!vertex) return null;
  return vertex(tier === "pro" ? proId() : flashId());
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
