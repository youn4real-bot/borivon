/**
 * Take the picked file's bytes into memory before anything can take them away.
 *
 * The bug this exists for: on 2026-09-19 a candidate's passport upload failed
 * with "Netzwerkfehler" and the Worker log had no POST at all — the request
 * never left the phone. The dashboard's change handler did
 *
 *     e.target.value = "";          // <- reset the input
 *     handleFile(file, k);          // <- ...then start reading `file`
 *
 * and `file` here is not bytes, it is a handle to a file the OS still owns. A
 * camera capture lives in a temporary location the browser holds a read grant
 * for, and that grant is tied to the selection in the input. Clearing the input
 * — or the OS reclaiming the temp copy while she is picking, or a memory
 * warning after photographing a passport — can make the handle unreadable. XHR
 * only reads it at send() time, asynchronously, long after the change handler
 * returned: the read fails, the browser fires `error`, and nothing is ever put
 * on the wire. That is exactly the observed signature.
 *
 * Reading the whole file here, inside the pick, turns the handle into plain
 * bytes on the JS heap. From that point the upload — and every retry of it —
 * is immune to anything the OS does with the original file.
 *
 * LAW #39: this copies bytes verbatim into a Blob. It never parses, re-saves
 * or normalises anything, so a scanner-produced passport PDF arrives at the
 * server byte-for-byte identical to what she picked.
 */

export type StabilizedFile =
  | { ok: true; file: File; copied: boolean }
  | { ok: false; reason: string };

/**
 * Files at or above this size are sent straight from the handle instead of
 * being buffered. The picker already refuses anything over 25 MB, so this only
 * ever trips for the very largest scans — where buffering would briefly hold
 * the bytes twice (ArrayBuffer + Blob) on a phone that is already the
 * lowest-memory device in the fleet. Those still get every other protection:
 * the retry schedule, the classified message and the beacon.
 */
export const SNAPSHOT_MAX_BYTES = 20 * 1024 * 1024;

export async function stabilizePickedFile(
  file: File,
  maxBytes: number = SNAPSHOT_MAX_BYTES,
): Promise<StabilizedFile> {
  if (file.size > maxBytes) {
    // Too big to hold twice. Still prove the handle is readable right now, so
    // an already-dead pick is reported as "pick it again" instead of surfacing
    // minutes later as a mystery network error.
    try {
      await file.slice(0, 1).arrayBuffer();
    } catch (e) {
      return { ok: false, reason: readErrorReason(e) };
    }
    return { ok: true, file, copied: false };
  }

  try {
    const bytes = await file.arrayBuffer();
    // Guard against a truncated read: a partial body would upload as a corrupt
    // passport scan, which is worse than a visible failure.
    if (bytes.byteLength !== file.size) {
      return { ok: false, reason: `short-read:${bytes.byteLength}/${file.size}` };
    }
    return {
      ok: true,
      file: new File([bytes], file.name, { type: file.type, lastModified: file.lastModified }),
      copied: true,
    };
  } catch (e) {
    // Out of memory is not "your file is gone" — fall back to streaming from
    // the handle rather than refusing an upload that might still work.
    const reason = readErrorReason(e);
    if (/range|allocat|memory/i.test(reason)) return { ok: true, file, copied: false };
    return { ok: false, reason };
  }
}

function readErrorReason(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as { name?: unknown; message?: unknown };
    const name = typeof err.name === "string" ? err.name : "";
    const message = typeof err.message === "string" ? err.message : "";
    const joined = [name, message].filter(Boolean).join(":");
    if (joined) return joined.slice(0, 120);
  }
  return String(e ?? "unknown").slice(0, 120);
}
