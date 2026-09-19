import { describe, it, expect } from "vitest";
import {
  classifyUploadFailure,
  uploadRetryDelayMs,
  shouldRetryUpload,
  MAX_UPLOAD_ATTEMPTS,
  UPLOAD_FAIL_MSG,
  formatUploadDiag,
  type UploadFailKind,
} from "@/lib/uploadFailure";
import { translations, type Lang } from "@/lib/translations";

describe("classifyUploadFailure", () => {
  it("names the offline case instead of calling it a network error", () => {
    // The candidate in a lift needs to be told to wait for signal, not to try
    // picking her passport photo again.
    expect(classifyUploadFailure({ event: "error", online: false }))
      .toEqual({ kind: "offline", transient: true, status: 0 });
  });

  it("treats a bare xhr error while online as a transient network failure", () => {
    expect(classifyUploadFailure({ event: "error", online: true }))
      .toEqual({ kind: "network", transient: true, status: 0 });
  });

  it("assumes online when the browser did not say", () => {
    expect(classifyUploadFailure({ event: "error" }).kind).toBe("network");
  });

  it("never retries a file the browser can no longer read", () => {
    // Re-sending the same dead handle fails identically; only a fresh pick helps.
    const f = classifyUploadFailure({ event: "readError" });
    expect(f.kind).toBe("fileGone");
    expect(f.transient).toBe(false);
  });

  it("never silently retries an expired session", () => {
    for (const status of [401, 403]) {
      const f = classifyUploadFailure({ event: "status", status });
      expect(f).toEqual({ kind: "auth", transient: false, status });
    }
  });

  it("retries 429 and 5xx, but not a 4xx rejection", () => {
    expect(classifyUploadFailure({ event: "status", status: 429 }).transient).toBe(true);
    expect(classifyUploadFailure({ event: "status", status: 500 }).transient).toBe(true);
    expect(classifyUploadFailure({ event: "status", status: 503 }).transient).toBe(true);
    expect(classifyUploadFailure({ event: "status", status: 400 }).transient).toBe(false);
    expect(classifyUploadFailure({ event: "status", status: 422 }).kind).toBe("rejected");
  });

  it("maps 413 to the size message, not a generic upload error", () => {
    expect(classifyUploadFailure({ event: "status", status: 413 }).kind).toBe("tooLarge");
  });

  it("treats status 0 on the load event as a network failure", () => {
    // xhr can fire `load` with status 0 when the connection died after headers.
    expect(classifyUploadFailure({ event: "status", status: 0 }).kind).toBe("network");
  });

  it("treats a watchdog stall like a timeout", () => {
    expect(classifyUploadFailure({ event: "stall" }).kind).toBe("timeout");
    expect(classifyUploadFailure({ event: "timeout" }).transient).toBe(true);
  });
});

describe("uploadRetryDelayMs", () => {
  it("backs off between attempts instead of firing the retry instantly", () => {
    // The old code retried once with zero delay — into the same dead air.
    expect(uploadRetryDelayMs(1, () => 0.5)).toBe(1_000);
    expect(uploadRetryDelayMs(2, () => 0.5)).toBe(3_000);
    expect(uploadRetryDelayMs(3, () => 0.5)).toBe(8_000);
  });

  it("stops after the last attempt", () => {
    expect(uploadRetryDelayMs(MAX_UPLOAD_ATTEMPTS, () => 0.5)).toBe(0);
    expect(uploadRetryDelayMs(99, () => 0.5)).toBe(0);
    expect(uploadRetryDelayMs(0, () => 0.5)).toBe(0);
    expect(uploadRetryDelayMs(Number.NaN, () => 0.5)).toBe(0);
  });

  it("jitters within ±20% so a whole cohort does not re-POST in lockstep", () => {
    expect(uploadRetryDelayMs(1, () => 0)).toBe(800);
    expect(uploadRetryDelayMs(1, () => 1)).toBe(1_200);
  });
});

describe("shouldRetryUpload", () => {
  it("gives a transient failure four chances in total", () => {
    const f = classifyUploadFailure({ event: "error", online: true });
    expect(shouldRetryUpload(f, 1)).toBe(true);
    expect(shouldRetryUpload(f, 3)).toBe(true);
    expect(shouldRetryUpload(f, MAX_UPLOAD_ATTEMPTS)).toBe(false);
  });

  it("never retries a permanent failure, even on attempt 1", () => {
    expect(shouldRetryUpload(classifyUploadFailure({ event: "readError" }), 1)).toBe(false);
    expect(shouldRetryUpload(classifyUploadFailure({ event: "status", status: 401 }), 1)).toBe(false);
  });
});

describe("UPLOAD_FAIL_MSG", () => {
  const KINDS: UploadFailKind[] = [
    "offline", "network", "fileGone", "timeout", "auth", "busy", "server", "tooLarge", "rejected",
  ];

  it("has a message for every cause — no cause may fall through to the generic one", () => {
    for (const kind of KINDS) expect(UPLOAD_FAIL_MSG[kind]).toBeTruthy();
  });

  it("LAW #19: every upload error string exists in FR, EN and DE", () => {
    const keys = [
      "pErrUpload", "pErrNetwork", "pErrSize",
      "pErrOffline", "pErrFileGone", "pErrTimeout", "pErrAuth", "pErrBusy", "pErrServer",
      "pUploadRetrying",
    ] as const;
    for (const lang of ["fr", "en", "de"] as Lang[]) {
      for (const key of keys) {
        const value = translations[lang][key];
        expect(typeof value, `${lang}.${key}`).toBe("string");
        expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("the retry message carries both counters so it cannot read as a dead end", () => {
    for (const lang of ["fr", "en", "de"] as Lang[]) {
      expect(translations[lang].pUploadRetrying).toContain("{n}");
      expect(translations[lang].pUploadRetrying).toContain("{max}");
    }
  });
});

describe("formatUploadDiag", () => {
  it("produces one greppable line with every field the next debugger needs", () => {
    const line = formatUploadDiag({
      slot: "id", attempt: 4, kind: "network", status: 0,
      bytes: 4_200_000, mime: "image/jpeg", ms: 31_400, sent: 1_048_576,
      online: true, net: "3g", hidden: true, final: true,
    });
    expect(line).toBe(
      "slot=id kind=network status=0 attempt=4 final=true bytes=4200000 sent=1048576 " +
      "mime=image/jpeg ms=31400 online=true hidden=true net=3g",
    );
  });

  it("cannot forge a second log line out of client-supplied text", () => {
    const line = formatUploadDiag({ slot: "id\nERROR fake log line", kind: "network" });
    expect(line).not.toContain("\n");
    expect(line.startsWith("slot=id_ERROR_fake_log_line ")).toBe(true);
  });

  it("clamps unbounded strings and rejects an unknown kind", () => {
    const line = formatUploadDiag({ slot: "x".repeat(500), kind: "haxx", mime: "y".repeat(500) });
    expect(line).toContain("kind=unknown");
    expect(line).toContain(`slot=${"x".repeat(48)} `);
    expect(line).toContain(`mime=${"y".repeat(64)} `);
  });

  it("survives a body that is not an object at all", () => {
    expect(() => formatUploadDiag(null)).not.toThrow();
    expect(formatUploadDiag(null)).toContain("kind=unknown");
    expect(formatUploadDiag("nope")).toContain("bytes=-1");
  });
});
