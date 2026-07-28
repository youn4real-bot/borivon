import { describe, it, expect } from "vitest";
import { isGone } from "../lib/workspaceCalendar";

/**
 * "That event no longer exists" vs "Google refused the change".
 *
 * The portal decides between a clean 404 and a 502 on this one predicate, and a
 * cancel of an already-deleted event is supposed to be a SUCCESS (nothing left
 * to cancel) rather than a failure the founder has to puzzle over.
 *
 * The version this replaces could never return true for any real error: its
 * regex held two literal backspace bytes (0x08) where `\b` was intended, so it
 * only matched messages containing a control character. It looked perfect when
 * printed. That is why this file imports the REAL predicate — a retyped copy is
 * exactly what hid the bug the first time.
 *
 * Both clients are pinned because the app runs both: the fetch shim on Workers,
 * googleapis on Node.
 */

// Verbatim shape from lib/googleRestShim.ts: `google_rest ${status} ${url} ${body}`.
const shimError = (status: number) =>
  new Error(
    `google_rest ${status} https://www.googleapis.com/calendar/v3/calendars/primary/events/abc123 ` +
      `{"error":{"code":${status},"message":"Not Found","errors":[{"domain":"global","reason":"notFound"}]}}`,
  );

/** A GaxiosError as googleapis actually throws it — message carries NO digits. */
const gaxiosError = (status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(status === 404 ? "Not Found" : "Resource has been deleted"), {
    code: status,
    status,
    response: { status },
    errors: [{ reason: status === 404 ? "notFound" : "deleted" }],
    ...extra,
  });

describe("isGone", () => {
  it("recognises the WORKERS shim 404 and 410 — the shape prod actually throws", () => {
    expect(isGone(shimError(404)), "shim 404").toBe(true);
    expect(isGone(shimError(410)), "shim 410").toBe(true);
  });

  it("recognises the googleapis error, whose message contains no status at all", () => {
    expect(isGone(gaxiosError(404))).toBe(true);
    expect(isGone(gaxiosError(410))).toBe(true);
  });

  it("recognises a STRING code — googleapis is not consistent about the type", () => {
    expect(isGone({ code: "404" })).toBe(true);
    expect(isGone({ status: "410" })).toBe(true);
    expect(isGone({ response: { status: 404 } })).toBe(true);
  });

  it("recognises the machine reason even when no status field survived", () => {
    expect(isGone({ errors: [{ reason: "notFound" }] })).toBe(true);
    expect(isGone({ errors: [{ reason: "deleted" }] })).toBe(true);
  });

  it("does NOT treat other failures as gone — those must stay a 502", () => {
    expect(isGone(shimError(403)), "403 forbidden").toBe(false);
    expect(isGone(shimError(500)), "500 server error").toBe(false);
    expect(isGone(gaxiosError(404, { code: 403, status: 403, response: { status: 403 }, errors: [{ reason: "forbidden" }] }))).toBe(false);
    expect(isGone(new Error("google_token_mint_failed"))).toBe(false);
    expect(isGone(new Error("end_before_start"))).toBe(false);
    expect(isGone(null)).toBe(false);
    expect(isGone(undefined)).toBe(false);
  });

  it("is not fooled by a 404 that is merely PRESENT in a url or a body", () => {
    // A 500 whose response body quotes an earlier 404, and an event id with 404
    // in it. The old loose search called both of these "gone" and would have
    // told the founder a live event had been deleted.
    expect(isGone(new Error("google_rest 500 https://www.googleapis.com/calendar/v3/calendars/primary/events/x404x internal error"))).toBe(false);
    expect(isGone(new Error("google_rest 500 https://www.googleapis.com/calendar/v3/events/a {\"error\":{\"message\":\"upstream returned 404 earlier\"}}"))).toBe(false);
  });

  it("does not match a 4040 or a 4104 — the status is a whole token", () => {
    expect(isGone(new Error("google_rest 4040 https://www.googleapis.com/calendar/v3/x y"))).toBe(false);
    expect(isGone({ code: 4040 })).toBe(false);
  });
});
