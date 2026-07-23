import { after } from "next/server";

/**
 * Fire-and-forget: mirror ONE candidate's dossier into the agency's Google Drive
 * AFTER the current response is sent, so the agency folder tracks portal changes
 * automatically instead of waiting for someone to click "Sync this batch → Drive".
 *
 * Why `after()` and not a bare floating promise: on Vercel a promise left running
 * past the response is killed, so the mirror would silently not happen. `after()`
 * (next/server) guarantees the callback runs within the invocation's compute budget,
 * OFF the critical path — a Drive outage can never slow or fail the approval/upload
 * that triggered it. The whole thing is best-effort: autoMirrorCandidate never throws.
 *
 * The import of the Drive engine is DYNAMIC so googleapis is never pulled into an
 * edge/client module graph (same pattern as the dynamic cvRender import elsewhere).
 * Calling this outside a request scope (a script, a cron, a test) is safe — the
 * try/catch around after() swallows the "called outside a request" throw and the
 * mirror is simply skipped (those paths run the manual batch sync instead).
 */
export function scheduleCandidateMirror(userId: string): void {
  if (!userId) return;
  try {
    after(async () => {
      try {
        const { autoMirrorCandidate } = await import("@/lib/driveMirror");
        await autoMirrorCandidate(userId);
      } catch (e) {
        console.error("[scheduleCandidateMirror] task failed:", e instanceof Error ? e.message : e);
      }
    });
  } catch {
    /* not in a request scope (script/cron/test) — skip the best-effort mirror */
  }
}
