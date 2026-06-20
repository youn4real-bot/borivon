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
import { generateText } from "ai";

export async function transcribeVoice(bytes: Uint8Array, mime: string): Promise<string | null> {
  const project = process.env.GOOGLE_VERTEX_PROJECT;
  const location = process.env.GOOGLE_VERTEX_LOCATION || "europe-west4";
  const credsRaw = process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (!project || !credsRaw) return null;
  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(credsRaw); } catch { return null; }
  try {
    const vertex = createVertex({ project, location, googleAuthOptions: { credentials } });
    const model = vertex(process.env.ASSISTANT_TRANSCRIBE_MODEL || "gemini-2.5-flash");
    const res = await generateText({
      model,
      maxRetries: 1,
      // 2048 + no thinking: a long voice note transcript could overflow 1024 once Gemini
      // 2.5 Flash's thinking shares the budget → truncated transcript. Transcription needs
      // no reasoning, so disable thinking (faster + the full transcript always lands).
      maxOutputTokens: 2048,
      providerOptions: { vertex: { thinkingConfig: { thinkingBudget: 0 } }, google: { thinkingConfig: { thinkingBudget: 0 } } },
      messages: [{
        role: "user",
        content: [
          { type: "file", data: bytes, mediaType: mime || "audio/ogg" },
          { type: "text", text: "Transcribe this voice note to text VERBATIM, in its original language (the speaker uses English, French, German, or Moroccan Arabic — often mixed). Output ONLY the transcription — no preamble, no quotes, no commentary, no translation." },
        ],
      }],
    });
    const t = (res.text || "").trim();
    return t || null;
  } catch (e) {
    console.error("[transcribeVoice] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
