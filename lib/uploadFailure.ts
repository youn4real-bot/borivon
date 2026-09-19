/**
 * Why an upload failed, in words the candidate can act on — and a retry
 * schedule that survives a phone.
 *
 * Written on 2026-09-19, after a candidate's passport upload died with
 * "Netzwerkfehler" and the Cloudflare log had NO `POST /api/portal/upload` at
 * all in the surrounding hours. The request never left the browser, so the
 * server side had nothing to say about it, and the page said one generic
 * sentence for nine different causes: an expired session, a stalled cellular
 * connection, a photo the OS had already reclaimed, and a 500 all read the
 * same. Nobody could tell her what to do next, and nobody could tell from the
 * logs what had happened.
 *
 * Everything here is pure so it can be unit-tested without a browser; the
 * dashboard supplies the XHR events and `navigator.onLine`.
 */

/** What actually went wrong, at the granularity the candidate needs. */
export type UploadFailKind =
  | "offline"   // the device reports no network at all
  | "network"   // the request never completed: reset, dropped, blocked
  | "fileGone"  // the browser could no longer read the picked photo/PDF
  | "timeout"   // bytes stopped moving and never resumed
  | "auth"      // 401/403 — the session expired mid-upload
  | "busy"      // 429 — rate limited
  | "server"    // 5xx — our side broke
  | "tooLarge"  // 413 that is not the per-slot page cap
  | "rejected"; // any other non-2xx

export interface UploadFailure {
  kind: UploadFailKind;
  /** Worth trying again on its own: the same bytes could still succeed. */
  transient: boolean;
  /** HTTP status, or 0 when the request never reached a server at all. */
  status: number;
}

/** The terminal browser event that ended the attempt. */
export type UploadFailEvent =
  | "error"      // xhr `error` — connection reset / never opened
  | "timeout"    // xhr `timeout`
  | "stall"      // our own watchdog aborted it: no progress for too long
  | "readError"  // reading the File threw before a single byte was sent
  | "status";    // the server answered, with a status we cannot accept

export function classifyUploadFailure(input: {
  event: UploadFailEvent;
  status?: number;
  /** navigator.onLine at the moment of failure. Undefined = unknown, treated as online. */
  online?: boolean;
}): UploadFailure {
  const status = Number.isFinite(input.status) ? Number(input.status) : 0;

  if (input.event === "readError") {
    // No retry: re-reading the same dead File handle fails exactly the same
    // way. The only cure is picking the file again, so say so.
    return { kind: "fileGone", transient: false, status: 0 };
  }
  if (input.event === "timeout" || input.event === "stall") {
    return { kind: "timeout", transient: true, status: 0 };
  }
  if (input.event === "error") {
    // `error` with the radio down is not a mystery — name it, so she waits for
    // signal instead of re-picking the file five times.
    if (input.online === false) return { kind: "offline", transient: true, status: 0 };
    return { kind: "network", transient: true, status: 0 };
  }

  // event === "status": the request DID reach a server.
  if (status === 0) return { kind: "network", transient: true, status: 0 };
  if (status === 401 || status === 403) {
    // A stale JWT is not something a retry of this request can fix, and
    // silently retrying an expired session just burns the rate limit.
    return { kind: "auth", transient: false, status };
  }
  if (status === 429) return { kind: "busy", transient: true, status };
  if (status === 413) return { kind: "tooLarge", transient: false, status };
  if (status >= 500) return { kind: "server", transient: true, status };
  return { kind: "rejected", transient: false, status };
}

/**
 * Four attempts, not two.
 *
 * The old code retried exactly once, immediately. On a phone that is barely a
 * retry at all: a cellular hand-off, a screen lock and a lift all last longer
 * than zero milliseconds, so the second attempt died in the same dead air as
 * the first and the candidate got a red message she could do nothing about.
 */
export const MAX_UPLOAD_ATTEMPTS = 4;

/** Backoff after the given 1-based attempt, or 0 when there is nothing left to try. */
export function uploadRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = [1_000, 3_000, 8_000];
  if (!Number.isFinite(attempt) || attempt < 1) return 0;
  const step = base[Math.floor(attempt) - 1];
  if (step === undefined) return 0;
  // ±20% jitter so ~93 phones coming back from the same cell outage do not all
  // re-POST a 20 MB body in the same 50 ms.
  const jitter = 1 + (random() - 0.5) * 0.4;
  return Math.round(step * jitter);
}

export function shouldRetryUpload(failure: UploadFailure, attempt: number): boolean {
  return failure.transient && attempt < MAX_UPLOAD_ATTEMPTS;
}

/**
 * Message key for each cause. Both slot render sites go through this, so a new
 * cause cannot quietly fall through to "Fehler beim Hochladen." at one of them
 * — which is how the sub-row already swallowed every network failure.
 */
export const UPLOAD_FAIL_MSG = {
  offline: "errOffline",
  network: "errNetwork",
  fileGone: "errFileGone",
  timeout: "errTimeout",
  auth: "errAuth",
  busy: "errBusy",
  server: "errServer",
  tooLarge: "errSize",
  rejected: "errUpload",
} as const satisfies Record<UploadFailKind, string>;

export type UploadFailMsgType = (typeof UPLOAD_FAIL_MSG)[UploadFailKind];

/** What the browser tells the server about a failure it could not deliver. */
export interface UploadDiag {
  /** Slot key (`id`, `cv_de`, a slot UUID…). Never a filename — those carry her name. */
  slot: string;
  attempt: number;
  kind: UploadFailKind;
  status: number;
  /** Size in bytes and MIME type — the two things that decide whether a body was even sendable. */
  bytes: number;
  mime: string;
  /** Milliseconds from send() to the failure, and how many bytes upload progress had reported. */
  ms: number;
  sent: number;
  online: boolean;
  /** effectiveType from the Network Information API where the browser has it ("4g", "2g"…). */
  net?: string;
  /** True when the page was hidden (app switched away, screen locked) as it died. */
  hidden?: boolean;
  /** True when this was the last attempt and the candidate saw a red message. */
  final: boolean;
}

const DIAG_KINDS = new Set<string>(Object.keys(UPLOAD_FAIL_MSG));

/**
 * One flat, greppable log line. Every value is clamped and coerced here because
 * this is client-supplied input landing in a production log: no unbounded
 * strings, and no newlines that could forge a second log line.
 */
export function formatUploadDiag(raw: unknown): string {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    String(v ?? "").replace(/[\r\n\t ]+/g, "_").slice(0, max) || "-";
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : -1;
  };
  const kind = DIAG_KINDS.has(String(d.kind)) ? String(d.kind) : "unknown";
  return [
    `slot=${str(d.slot, 48)}`,
    `kind=${kind}`,
    `status=${num(d.status)}`,
    `attempt=${num(d.attempt)}`,
    `final=${d.final === true}`,
    `bytes=${num(d.bytes)}`,
    `sent=${num(d.sent)}`,
    `mime=${str(d.mime, 64)}`,
    `ms=${num(d.ms)}`,
    `online=${d.online !== false}`,
    `hidden=${d.hidden === true}`,
    `net=${str(d.net, 16)}`,
  ].join(" ");
}
