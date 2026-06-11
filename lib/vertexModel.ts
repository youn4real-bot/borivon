/**
 * Shared Gemini-on-Vertex model factory (EU/Frankfurt region) — used by BOTH the
 * in-app assistant route and the Telegram bot, so they run the same brain with
 * the same EU data-residency posture. Returns null when the Vertex key isn't
 * configured, so callers can degrade gracefully (the feature stays inert).
 */
import { createVertex } from "@ai-sdk/google-vertex";

export function vertexModel() {
  const project = process.env.GOOGLE_VERTEX_PROJECT;
  const location = process.env.GOOGLE_VERTEX_LOCATION || "europe-west4";
  const credsRaw = process.env.GOOGLE_VERTEX_CREDENTIALS;
  if (!project || !credsRaw) return null;
  let credentials: Record<string, unknown>;
  try { credentials = JSON.parse(credsRaw); } catch { return null; }
  const vertex = createVertex({ project, location, googleAuthOptions: { credentials } });
  return vertex(process.env.ASSISTANT_MODEL_ID || "gemini-2.5-flash");
}
