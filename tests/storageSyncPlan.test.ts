import { describe, it, expect } from "vitest";
import { normEtag, parseFlippedAt, planSync, sameContent } from "../storage/sync-plan.mjs";

/**
 * storage/sync-plan.mjs decides what copy-to-r2.mjs and copy-back-to-supabase.mjs
 * may write. Each case below is a way the old "skip on same size, otherwise
 * overwrite" rule lost or clobbered a real file.
 */

type Obj = { size: number; etag?: string | null; updated?: number | null };
const T = (iso: string) => Date.parse(iso);
const map = (entries: Record<string, Obj>) => new Map(Object.entries(entries));

const FLIP = T("2026-09-15T01:30:00Z");
const BEFORE = T("2026-09-15T01:00:00Z");
const AFTER = T("2026-09-15T02:00:00Z");
const LATER = T("2026-09-15T03:00:00Z");

describe("storage sync plan", () => {
  it("eTags compare without quotes or case — Supabase quotes them, R2 does not", () => {
    expect(normEtag('"ABC123"')).toBe("abc123");
    expect(normEtag("abc123")).toBe("abc123");
    expect(normEtag("")).toBeNull();
    expect(normEtag(null)).toBeNull();
    expect(sameContent({ size: 3, etag: '"abc"' }, { size: 3, etag: "abc" })).toBe(true);
  });

  it("a file replaced in place by one of the SAME size is not 'identical' (the old rule missed it)", () => {
    const plan = planSync(
      map({ "sign-documents/c/req.pdf": { size: 1000, etag: '"new"', updated: AFTER } }),
      map({ "sign-documents/c/req.pdf": { size: 1000, etag: "old", updated: BEFORE } }),
    );
    expect(plan.copy).toEqual(["sign-documents/c/req.pdf"]);
    expect(plan.same).toEqual([]);
  });

  it("identical content is skipped; a missing etag falls back to size and is counted", () => {
    const plan = planSync(
      map({ "a/1": { size: 5, etag: '"e1"', updated: BEFORE }, "a/2": { size: 7, etag: null, updated: BEFORE } }),
      map({ "a/1": { size: 5, etag: "e1", updated: AFTER }, "a/2": { size: 7, etag: "x", updated: AFTER } }),
    );
    expect(plan.same.sort()).toEqual(["a/1", "a/2"]);
    expect(plan.sizeOnly).toBe(1);
    expect(plan.copy).toEqual([]);
  });

  it("a contract signed on R2 after the flip is never reverted to Supabase's unsigned bytes", () => {
    // sign route: upserts <req>-signed.pdf AND overwrites <req>.pdf, on R2.
    const supabase = map({ "sign-documents/c/req.pdf": { size: 900, etag: '"unsigned"', updated: BEFORE } });
    const r2 = map({
      "sign-documents/c/req.pdf": { size: 1400, etag: "signed", updated: AFTER },
      "sign-documents/c/req-signed.pdf": { size: 1400, etag: "signed", updated: AFTER },
    });
    for (const flippedAt of [undefined, FLIP]) {
      const plan = planSync(supabase, r2, { flippedAt });
      expect(plan.copy).toEqual([]);
      expect(plan.targetNewer).toEqual(["sign-documents/c/req.pdf"]);
    }
  });

  it("a new profile photo on R2 is not replaced by the old Supabase one", () => {
    const plan = planSync(
      map({ "profile-photos/u.jpg": { size: 100, etag: '"old"', updated: BEFORE } }),
      map({ "profile-photos/u.jpg": { size: 120, etag: "new", updated: AFTER } }),
      { flippedAt: FLIP },
    );
    expect(plan.targetNewer).toEqual(["profile-photos/u.jpg"]);
  });

  it("a file changed on Supabase after the last copy (during the freeze, before the flip) IS copied", () => {
    const plan = planSync(
      map({ "slot-templates/slot-templates/s.pdf": { size: 10, etag: '"v2"', updated: AFTER } }),
      map({ "slot-templates/slot-templates/s.pdf": { size: 12, etag: "v1", updated: BEFORE } }),
    );
    expect(plan.copy).toEqual(["slot-templates/slot-templates/s.pdf"]);
  });

  it("missing on the target: copied before the flip; after it, an object older than the flip was deleted and is not recreated", () => {
    const source = map({
      "feed-photos/old-post.jpg": { size: 1, etag: "a", updated: BEFORE },
      "sign-documents/c/new.pdf": { size: 2, etag: "b", updated: AFTER },
      "feed-photos/no-time.jpg": { size: 3, etag: "c", updated: null },
    });
    const noFlip = planSync(source, new Map());
    expect(noFlip.copy.sort()).toEqual(["feed-photos/no-time.jpg", "feed-photos/old-post.jpg", "sign-documents/c/new.pdf"]);
    const afterFlip = planSync(source, new Map(), { flippedAt: FLIP });
    expect(afterFlip.copy).toEqual(["sign-documents/c/new.pdf"]);
    expect(afterFlip.notRecreated.sort()).toEqual(["feed-photos/no-time.jpg", "feed-photos/old-post.jpg"]);
  });

  it("different content with unknown times: copied only when nothing can have written the target", () => {
    const source = map({ "a/x": { size: 1, etag: "s", updated: null } });
    const target = map({ "a/x": { size: 2, etag: "t", updated: LATER } });
    expect(planSync(source, target).copy).toEqual(["a/x"]);
    expect(planSync(source, target, { flippedAt: FLIP }).targetNewer).toEqual(["a/x"]);
  });

  it("copy-back after a rollback: a missed mirror is repaired, a Supabase write made after the rollback is kept", () => {
    const r2 = map({
      "sign-documents/c/missed.pdf": { size: 4, etag: "m", updated: AFTER },
      "profile-photos/u.jpg": { size: 5, etag: "r2", updated: AFTER },
      "feed-photos/pre-flip.jpg": { size: 6, etag: "p", updated: BEFORE },
    });
    const supabase = map({ "profile-photos/u.jpg": { size: 9, etag: '"after-rollback"', updated: LATER } });
    const plan = planSync(r2, supabase, { flippedAt: FLIP });
    expect(plan.copy).toEqual(["sign-documents/c/missed.pdf"]);
    expect(plan.targetNewer).toEqual(["profile-photos/u.jpg"]);
    expect(plan.notRecreated).toEqual(["feed-photos/pre-flip.jpg"]);
  });

  it("--flipped-at must be a real date", () => {
    expect(parseFlippedAt("2026-09-15T01:30:00Z")).toBe(FLIP);
    expect(parseFlippedAt(null)).toBeNull();
    expect(() => parseFlippedAt("yesterday-ish")).toThrow(/not a date/);
  });
});
