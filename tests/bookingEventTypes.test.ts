import { describe, it, expect } from "vitest";
import {
  overlayEventType, looksLikeSlug, BUILT_IN_SLUGS,
  parseEventTypePatch, parseEventTypeOverride, EVENT_TYPE_RANGES,
} from "@/lib/bookingEventTypes";
import type { BookingEventType, EventTypeOverrideKey } from "@/lib/bookingEventTypes";

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

/**
 * The admin edit path. Two rules decide whether this feature works at all:
 *
 *   1. ABSENT is not EMPTY. A key missing from the body leaves its column
 *      alone; a key present but blank writes NULL, which is the ONLY way to
 *      take an override back off and return the link to inheriting the global
 *      settings. Collapse the two and an override becomes one-way.
 *   2. REFUSE, never clamp. A mistyped 2400 stored as 240 with a green "saved"
 *      is the exact silent-correction failure the availability editor was
 *      fixed for — and here the number is how long every call on that link is.
 */
describe("parseEventTypePatch", () => {
  const keys = Object.keys(EVENT_TYPE_RANGES) as EventTypeOverrideKey[];

  it("leaves untouched columns out of the patch entirely", () => {
    const r = parseEventTypePatch({ slot_minutes: 45 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Only the one field. Sending the other three as null would silently wipe
    // overrides the founder never opened.
    expect(Object.keys(r.patch)).toEqual(["slot_minutes"]);
    expect(r.patch.slot_minutes).toBe(45);
  });

  it("an EMPTY value clears the override back to NULL (inherit)", () => {
    for (const raw of ["", "   ", null]) {
      const r = parseEventTypePatch({ slot_minutes: raw });
      expect(r.ok, JSON.stringify(raw)).toBe(true);
      if (!r.ok) continue;
      expect(r.patch.slot_minutes, JSON.stringify(raw)).toBeNull();
    }
  });

  it("keeps a legitimate ZERO rather than reading it as empty", () => {
    // 0 is falsy and 0 is a real, meaningful buffer/notice — "no gap at all".
    const r = parseEventTypePatch({ buffer_minutes: 0, min_notice_hours: "0" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.buffer_minutes).toBe(0);
    expect(r.patch.min_notice_hours).toBe(0);
  });

  it("accepts each field at both ends of its range", () => {
    for (const k of keys) {
      const [min, max] = EVENT_TYPE_RANGES[k];
      for (const v of [min, max]) {
        const r = parseEventTypePatch({ [k]: v });
        expect(r.ok, `${k}=${v}`).toBe(true);
        if (r.ok) expect(r.patch[k]).toBe(v);
      }
    }
  });

  it("REFUSES out of range instead of clamping — the whole point", () => {
    for (const k of keys) {
      const [min, max] = EVENT_TYPE_RANGES[k];
      for (const v of [min - 1, max + 1, 99999]) {
        const r = parseEventTypePatch({ [k]: v });
        expect(r.ok, `${k}=${v} must be refused, not clamped`).toBe(false);
        if (!r.ok && r.error === "out_of_range") {
          expect(r.field).toBe(k);
          expect([r.min, r.max]).toEqual([min, max]);
        } else {
          expect.unreachable(`${k}=${v} should report out_of_range`);
        }
      }
    }
  });

  it("rejects values that are not whole numbers", () => {
    for (const bad of ["30.5", 30.5, "abc", NaN, Infinity, true, [], {}, ["30"]]) {
      const r = parseEventTypePatch({ slot_minutes: bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("only accepts a real boolean for active", () => {
    expect(parseEventTypePatch({ active: false })).toEqual({ ok: true, patch: { active: false } });
    expect(parseEventTypePatch({ active: true })).toEqual({ ok: true, patch: { active: true } });
    for (const bad of ["true", 1, 0, null, "", "yes"]) {
      const r = parseEventTypePatch({ active: bad });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses a body with nothing in it, rather than writing an empty update", () => {
    for (const body of [{}, { slug: "nurse" }, null, undefined, "nope", 7]) {
      const r = parseEventTypePatch(body);
      expect(r.ok, JSON.stringify(body)).toBe(false);
      if (!r.ok) expect(r.error).toBe("nothing_to_update");
    }
  });

  it("never lets an unknown key reach the database", () => {
    const r = parseEventTypePatch({ slot_minutes: 30, kind: "nurse", created_at: "2020-01-01", slug: "x" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.patch)).toEqual(["slot_minutes"]);
  });
});

/**
 * The READ side, which had no coverage at all: every test above hands
 * overlayEventType a hand-built object that already contains real nulls, so
 * nothing ever ran a database row through the column parser.
 *
 * The bug that hid there: `Number(null)` is 0, and 0 is inside [0,120] and
 * [0,720] — so a NULL buffer_minutes / min_notice_hours was read back as an
 * EXPLICIT 0 and applied as an override. Every seeded link ran with no buffer
 * and no minimum notice against a global that asked for both.
 */
describe("parseEventTypeOverride — NULL means inherit, not zero", () => {
  it("a NULL column whose floor is 0 still reads as null", () => {
    expect(parseEventTypeOverride(null, 0, 120)).toBeNull();  // buffer_minutes
    expect(parseEventTypeOverride(null, 0, 720)).toBeNull();  // min_notice_hours
    expect(parseEventTypeOverride(undefined, 0, 120)).toBeNull();
    expect(parseEventTypeOverride("", 0, 720)).toBeNull();
  });

  it("the two columns that masked the bug behave the same", () => {
    expect(parseEventTypeOverride(null, 5, 240)).toBeNull();  // slot_minutes
    expect(parseEventTypeOverride(null, 1, 90)).toBeNull();   // horizon_days
  });

  it("a deliberate zero still survives as a real override", () => {
    expect(parseEventTypeOverride(0, 0, 120)).toBe(0);
    expect(parseEventTypeOverride("0", 0, 720)).toBe(0);
  });

  it("keeps real values and refuses out-of-range ones", () => {
    expect(parseEventTypeOverride(45, 5, 240)).toBe(45);
    expect(parseEventTypeOverride("45", 5, 240)).toBe(45);
    expect(parseEventTypeOverride(2400, 5, 240)).toBeNull();
    expect(parseEventTypeOverride("abc", 5, 240)).toBeNull();
  });

  it("never lets a non-numeric type coerce its way to 0", () => {
    // Number([]) and Number(false) are both 0, which would pass a 0 floor.
    for (const bad of [[], {}, false, true, NaN, Infinity]) {
      expect(parseEventTypeOverride(bad, 0, 120), JSON.stringify(bad)).toBeNull();
    }
  });

  it("an all-NULL row leaves the global availability completely untouched", () => {
    const seeded: BookingEventType = {
      slug: "nurse", kind: "nurse", active: true,
      slotMinutes: parseEventTypeOverride(null, 5, 240),
      bufferMinutes: parseEventTypeOverride(null, 0, 120),
      minNoticeHours: parseEventTypeOverride(null, 0, 720),
      horizonDays: parseEventTypeOverride(null, 1, 90),
      title: { en: "", de: "", fr: "" },
      blurb: { en: "", de: "", fr: "" },
    };
    // The seeded rows are exactly this, so /book/nurse must be byte-identical
    // to /book. With the old parser it silently offered 0 h notice.
    expect(overlayEventType({ ...base, bufferMinutes: 10 }, seeded).bufferMinutes).toBe(10);
    expect(overlayEventType(base, seeded)).toEqual(base);
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
