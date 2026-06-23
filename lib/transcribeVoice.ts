/**
 * Voice-note transcription via Gemini on Vertex.
 *
 * Claude (the bot's brain) has NO audio input, so a Telegram voice note can't be sent
 * to it directly — that's what broke voice when the brain switched to Claude. Gemini
 * DOES understand audio natively, so we use a cheap Gemini-Flash call ONLY to turn the
 * audio into text, then the main Claude run reasons over that text. Uses the existing
 * GOOGLE_VERTEX_* creds (already present for Gmail/Calendar). Returns null when Vertex
 * isn't configured or transcription fails, so the caller can ask the founder to type.
 */
import { createVertex } from "@ai-sdk/google-vertex";
import { createVertex as createVertexEdge } from "@ai-sdk/google-vertex/edge";
import { generateText } from "ai";
import { GEMINI_SAFETY } from "@/lib/vertexModel";

// On Cloudflare Workers the node google-auth path 500s (unenv lacks node:http.validateHeaderName);
// the /edge variant auths via WebCrypto. Mirrors lib/vertexModel.
const ON_WORKERS = typeof navigator !== "undefined" && (navigator as { userAgent?: string }).userAgent === "Cloudflare-Workers";

export async function transcribeVoice(bytes: Uint8Array, mime: string): Promise<{ text: string; truncated: boolean } | null> {
  const project = process.env.GOOGLE_VERTEX_PROJECT;
  const location = process.env.GOOGLE_VERTEX_LOCATION || "europe-west4";
  const credsRaw = process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (!project || !credsRaw) return null;
  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(credsRaw); } catch { return null; }
  try {
    const vertex = ON_WORKERS
      ? createVertexEdge({ project, location, googleCredentials: { clientEmail: String(credentials.client_email || ""), privateKey: String(credentials.private_key || ""), privateKeyId: credentials.private_key_id ? String(credentials.private_key_id) : undefined } })
      : createVertex({ project, location, googleAuthOptions: { credentials } });
    const model = vertex(process.env.ASSISTANT_TRANSCRIBE_MODEL || "gemini-2.5-flash");
    const res = await generateText({
      model,
      maxRetries: 1,
      // 8192 + no thinking. Transcription output scales with audio length: at the old 2048
      // cap a long memo (the founder's main input, often several dictated tasks) was cut off
      // by Gemini with NO error, so the tasks after the cutoff silently vanished. 8192 covers
      // any realistic voice note; thinking is disabled (no reasoning needed) so the whole
      // budget is transcript, and we still flag finishReason === "length" so the caller can
      // warn the founder if even 8192 wasn't enough (never let a dictated task slip silently).
      maxOutputTokens: 8192,
      providerOptions: { vertex: { thinkingConfig: { thinkingBudget: 0 }, safetySettings: GEMINI_SAFETY }, google: { thinkingConfig: { thinkingBudget: 0 }, safetySettings: GEMINI_SAFETY } },
      messages: [{
        role: "user",
        content: [
          { type: "file", data: bytes, mediaType: mime || "audio/ogg" },
          { type: "text", text: "Transcribe this voice note to text VERBATIM, in its original language (the speaker uses English, French, German, or Moroccan Arabic — often mixed). Output ONLY the transcription — no preamble, no quotes, no commentary, no translation." },
        ],
      }],
    });
    const t = (res.text || "").trim();
    if (!t) return null;
    return { text: t, truncated: res.finishReason === "length" };
  } catch (e) {
    console.error("[transcribeVoice] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
