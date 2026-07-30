import { describe, it, expect } from "vitest";
import { overlayEventType, looksLikeSlug, BUILT_IN_SLUGS } from "@/lib/bookingEventTypes";
import type { BookingEventType } from "@/lib/bookingEventTypes";

/**
 * Event types are the shareable booking links (/book/nurse, /book/clinic,
 * /book/company). Two invariants matter enough to pin:
 *
 *   1. A type with NO overrides must produce availability IDENTICAL to the
 *      global config. That is the promise that adding this feature changed
 *      nothing about how /book already behaves — and it is easy to break by
 *      spreading an undefined over a real value.
 *   2. The slug is used to build a cache key and reaches a DB lookup, so junk
 *      must be rejected by shape before either.
 */

const base = {
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 12,
  horizonDays: 14,
  week: { 1: ["09:00-17:00"] },
  tzOffsetMinutes: 60,
};

const type = (over: Partial<BookingEventType>): BookingEventType => ({
  slug: "x",
  kind: "nurse",
  active: true,
  slotMinutes: null,
  bufferMinutes: null,
  minNoticeHours: null,
  horizonDays: null,
  title: { en: "", de: "", fr: "" },
  blurb: { en: "", de: "", fr: "" },
  ...over,
});

describe("overlayEventType", () => {
  it("with no event type at all, returns the global config untouched", () => {
    expect(overlayEventType(base, null)).toEqual(base);
  });

  it("a type with every override NULL changes nothing", () => {
    // The whole "adding this is a no-op until you configure it" promise.
    expect(overlayEventType(base, type({}))).toEqual(base);
  });

  it("applies only the overrides that are set", () => {
    const out = overlayEventType(base, type({ slotMinutes: 45 }));
    expect(out.slotMinutes).toBe(45);
    // Everything else must survive.
    expect(out.minNoticeHours).toBe(base.minNoticeHours);
    expect(out.horizonDays).toBe(base.horizonDays);
    expect(out.bufferMinutes).toBe(base.bufferMinutes);
    expect(out.week).toEqual(base.week);
  });

  it("applies all four overrides together", () => {
    const out = overlayEventType(
      base,
      type({ slotMinutes: 45, bufferMinutes: 15, minNoticeHours: 24, horizonDays: 30 }),
    );
    expect(out).toMatchObject({ slotMinutes: 45, bufferMinutes: 15, minNoticeHours: 24, horizonDays: 30 });
  });

  it("a zero buffer is an override, not an absent one", () => {
    // 0 is falsy. A `||`-based merge would silently discard a deliberate
    // "no buffer at all" and hand back the global value instead.
    const out = overlayEventType({ ...base, bufferMinutes: 10 }, type({ bufferMinutes: 0 }));
    expect(out.bufferMinutes).toBe(0);
  });

  it("does not mutate the config it was given", () => {
    const original = { ...base };
    overlayEventType(base, type({ slotMinutes: 45 }));
    expect(base).toEqual(original);
  });
});

describe("looksLikeSlug", () => {
  it("accepts the built-in slugs", () => {
    for (const s of BUILT_IN_SLUGS) expect(looksLikeSlug(s)).toBe(true);
  });

  it("accepts lowercase, digits and inner hyphens", () => {
    expect(looksLikeSlug("intro-30")).toBe(true);
    expect(looksLikeSlug("a")).toBe(true);
  });

  it("rejects anything that could reach a query or a cache key as junk", () => {
    for (const bad of [
      "", "  ", "Nurse", "NURSE",          // case matters: the key must be stable
      "-leading", "has space", "trailing/", "a/b", "../etc",
      "nurse?x=1", "nurse#frag", "nurse'--", "n".repeat(40),
      null, undefined, 42, {}, [],
    ]) {
      expect(looksLikeSlug(bad as unknown), `should reject ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});
