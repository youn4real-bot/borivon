import { describe, it, expect } from "vitest";
import { quietHasExpired, QUIET_MAX_DAYS } from "@/lib/botQuiet";

/**
 * Regression: "go quiet" was stored as a permanent flag. The founder set it on
 * 2026-07-14 and it was still swallowing eight of the nine scheduled jobs 24
 * days later — including the new-signup ping. Every muted job answers
 * `{skipped:"quiet"}` with HTTP 200, and the cron alarm only looks at HTTP
 * status, so a month of silence read as a month of healthy runs.
 */
const DAY = 86_400_000;
const SET_AT = "2026-07-14T13:22:29.524Z"; // the real value that was live
const t = (iso: string) => Date.parse(iso);

describe("quietHasExpired", () => {
  it("lifts the real 24-day-old mute that caused this", () => {
    expect(quietHasExpired("on", SET_AT, t("2026-08-07T12:00:00Z"))).toBe(true);
  });

  it("leaves a fresh mute alone", () => {
    const now = t(SET_AT) + 2 * DAY;
    expect(quietHasExpired("on", SET_AT, now)).toBe(false);
  });

  it("holds right up to the limit and lifts just past it", () => {
    const at = t(SET_AT);
    expect(quietHasExpired("on", SET_AT, at + QUIET_MAX_DAYS * DAY)).toBe(false);
    expect(quietHasExpired("on", SET_AT, at + QUIET_MAX_DAYS * DAY + 1)).toBe(true);
  });

  it("never reports an expiry for a switch that is already off", () => {
    // Otherwise the caller would announce "reminders are back on" to somebody
    // who never muted them.
    expect(quietHasExpired("off", SET_AT, t("2027-01-01T00:00:00Z"))).toBe(false);
    expect(quietHasExpired(null, SET_AT)).toBe(false);
    expect(quietHasExpired(undefined, undefined)).toBe(false);
  });

  it("keeps the mute when there is no usable timestamp", () => {
    // The expiry is a safety net, not a veto: an unreadable date must not be an
    // excuse to start messaging someone who asked for silence.
    for (const bad of [null, undefined, "", "not-a-date"]) {
      expect(quietHasExpired("on", bad)).toBe(false);
    }
  });

  it("does not lift a mute set in the future", () => {
    expect(quietHasExpired("on", "2027-01-01T00:00:00Z", t("2026-08-07T12:00:00Z"))).toBe(false);
  });
});
