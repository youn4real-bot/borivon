import { describe, it, expect } from "vitest";
import { changedKeys, sameJson, planLiveRowStep, createLiveRowTracker, SAVE_STALE_MS } from "@/lib/liveRowDiff";

/**
 * The dashboard's live passport row, driven the way the page drives it:
 * readStart() before the request, step() when the answer lands, markLocalEdit()
 * on every keystroke / tick, trackSave() around every draft POST. Every case is
 * a timeline on a cold Worker (2-5 s answers), where the first port applied an
 * older read over the candidate's own newer input because it asked "did she
 * edit in the last 3 s?" at RESPONSE time.
 */
describe("createLiveRowTracker — a poll read never lands over her own newer writes", () => {
  const COLS = { always: ["passport_status", "payment_tier", "profile_photo"], deferrable: ["last_name", "passport_confirmed_fields"] };
  const U = "user-1";
  function setup() {
    let t = 0;
    const tr = createLiveRowTracker({ now: () => t });
    return { tr, at: (ms: number) => { t = ms; } };
  }
  function pendingSave() {
    let resolve: () => void = () => {};
    const p = new Promise<void>((r) => { resolve = r; });
    return { p, resolve };
  }
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const base = { passport_status: null, payment_tier: null, profile_photo: null, last_name: "", passport_confirmed_fields: [] };

  it("field: a read sent while she typed, answered >3 s after her last keystroke, is held back", async () => {
    const { tr, at } = setup();
    tr.seed(U, base, 0);
    at(500);  tr.markLocalEdit();                       // "Sch"
    at(1000); const readAt = tr.readStart();            // the poll goes out
    at(1300); const a = pendingSave(); tr.trackSave(a.p); // debounced save of "Sch"
    at(1500); a.resolve(); await flush();
    at(4000); tr.markLocalEdit();                       // "Schmidt"
    at(4800); const b = pendingSave(); tr.trackSave(b.p); // save of "Schmidt", still out
    at(7100);                                           // the old read lands: 3.1 s after her keystroke
    const step = tr.step(U, { ...base, last_name: "Sch" }, readAt, COLS)!;
    expect([...step.apply]).toEqual([]);                // "Schmidt" in the open modal is untouched
    expect(step.next.last_name).toBe("");               // not advanced: nothing is lost either
    b.resolve(); await flush();
  });

  it("field: a draft save still in flight holds back a read even long after the keystroke", async () => {
    const { tr, at } = setup();
    tr.seed(U, base, 0);
    at(0); tr.markLocalEdit();
    at(800); const s = pendingSave(); tr.trackSave(s.p);   // cold Worker: this takes a while
    at(4000); const r1 = tr.readStart();
    at(6000);
    expect(tr.step(U, { ...base, last_name: "" }, r1, COLS)!.apply.size).toBe(0);
    expect(tr.mayMissLocalWrites(r1)).toBe(true);

    at(6500); const r2 = tr.readStart();                 // sent before the save landed...
    at(7000); s.resolve(); await flush();
    at(8000);
    expect(tr.mayMissLocalWrites(r2)).toBe(true);        // ...so it may predate it
    at(7500); const r3 = tr.readStart();                 // sent after it landed
    at(9000);
    const step = tr.step(U, { ...base, last_name: "Schmidt" }, r3, COLS)!;
    expect([...step.apply]).toEqual(["last_name"]);      // her own value echoing back: the page's v !== p[k] makes it a no-op
  });

  it("checkbox (LAW #38): her last click was UNTICK; an older read showing it ticked never re-ticks it", async () => {
    const { tr, at } = setup();
    tr.seed(U, base, 0);
    at(0);    tr.markLocalEdit();                                    // tick dob
    at(800);  const a = pendingSave(); tr.trackSave(a.p);
    at(1000); a.resolve(); await flush();
    at(1200); const readAt = tr.readStart();                         // row now says ["dob"]
    at(1500); tr.markLocalEdit();                                    // UNtick dob
    at(2300); const b = pendingSave(); tr.trackSave(b.p);
    at(4600);
    const stale = tr.step(U, { ...base, passport_confirmed_fields: ["dob"] }, readAt, COLS)!;
    expect(stale.apply.has("passport_confirmed_fields")).toBe(false);
    at(5000); b.resolve(); await flush();
    at(5500); const fresh = tr.readStart();
    at(6000);
    const after = tr.step(U, { ...base, passport_confirmed_fields: [] }, fresh, COLS)!;
    expect(after.apply.size).toBe(0);                                // box stays unticked, nothing re-saved
  });

  it("a genuine tick from her other device still lands on the next quiet read", () => {
    const { tr, at } = setup();
    tr.seed(U, base, 0);
    at(10_000); const r = tr.readStart();
    at(11_000);
    const step = tr.step(U, { ...base, passport_confirmed_fields: ["dob"] }, r, COLS)!;
    expect([...step.apply]).toEqual(["passport_confirmed_fields"]);
  });

  it("admin-driven columns apply even while her writes are out", () => {
    const { tr, at } = setup();
    tr.seed(U, base, 0);
    at(1000); tr.markLocalEdit();
    const r = tr.readStart();
    tr.trackSave(new Promise(() => {}));
    at(3000);
    const step = tr.step(U, { ...base, passport_status: "approved", last_name: "X" }, r, COLS)!;
    expect([...step.apply]).toEqual(["passport_status"]);
  });

  it("a save that never answers stops holding the sync back after SAVE_STALE_MS", () => {
    const { tr, at } = setup();
    tr.seed(U, base, 0);
    at(0); tr.trackSave(new Promise(() => {}));
    at(SAVE_STALE_MS - 1);
    expect(tr.mayMissLocalWrites(SAVE_STALE_MS - 1)).toBe(true);
    at(SAVE_STALE_MS);
    expect(tr.mayMissLocalWrites(SAVE_STALE_MS)).toBe(false);
  });

  it("seed: a change between the bootstrap read and the first poll IS applied", () => {
    const { tr, at } = setup();
    at(100); const boot = tr.readStart();
    at(900); tr.seed(U, { passport_status: null, payment_tier: null }, boot); // bootstrap put these on screen
    at(1000); const r = tr.readStart();
    at(2000);
    const step = tr.step(U, { ...base, payment_tier: "premium", profile_photo: "p.jpg", last_name: "Amina" }, r, COLS)!;
    // payment_tier was seeded -> a real change. profile_photo / last_name were
    // never loaded by the page -> this read is their baseline.
    expect([...step.apply]).toEqual(["payment_tier"]);
    expect(step.next.profile_photo).toBe("p.jpg");
  });

  it("seed: a poll read that started BEFORE the page's own load is dropped, not applied backwards", () => {
    const { tr, at } = setup();
    at(50);  const early = tr.readStart();
    at(100); const boot = tr.readStart();
    at(900); tr.seed(U, { passport_status: "approved" }, boot);
    at(1200);
    expect(tr.step(U, { ...base, passport_status: "pending" }, early, COLS)).toBeNull();
    at(1300); const later = tr.readStart();
    const step = tr.step(U, { ...base, passport_status: "approved" }, later, COLS)!;
    expect(step.apply.size).toBe(0);
  });

  it("another account starts from scratch", () => {
    const { tr, at } = setup();
    tr.seed(U, { ...base, passport_status: "approved" }, 0);
    at(10_000);
    const step = tr.step("user-2", { ...base, passport_status: "pending" }, tr.readStart(), COLS)!;
    expect(step.apply.size).toBe(0);
  });
});

describe("planLiveRowStep — the dashboard's live passport/profile poll", () => {
  const cols = (defer: boolean) => ({ always: ["passport_status", "manually_verified"], deferrable: ["first_name", "passport_confirmed_fields"], defer });
  const base = { passport_status: null, manually_verified: false, first_name: "Amina", passport_confirmed_fields: [] };

  it("the first read is a baseline: nothing applied (no re-fired celebration on mount)", () => {
    const step = planLiveRowStep(null, { ...base, manually_verified: true }, cols(false));
    expect([...step.apply]).toEqual([]);
    expect(step.next.manually_verified).toBe(true);
  });

  it("an unchanged poll applies nothing", () => {
    const step = planLiveRowStep(base, { ...base, passport_confirmed_fields: [] }, cols(false));
    expect(step.apply.size).toBe(0);
  });

  it("admin-driven columns apply even while the candidate is typing", () => {
    const step = planLiveRowStep(base, { ...base, passport_status: "approved", first_name: "Amina B" }, cols(true));
    expect([...step.apply]).toEqual(["passport_status"]);
  });

  it("a field change held back while typing is applied on the next quiet poll, not lost", () => {
    const moved = { ...base, first_name: "Amina B", passport_confirmed_fields: ["dob"] };
    const busy = planLiveRowStep(base, moved, cols(true));
    expect(busy.apply.size).toBe(0);
    expect(busy.next.first_name).toBe("Amina");        // snapshot NOT advanced
    const quiet = planLiveRowStep(busy.next, moved, cols(false));
    expect([...quiet.apply].sort()).toEqual(["first_name", "passport_confirmed_fields"]);
    const after = planLiveRowStep(quiet.next, moved, cols(false));
    expect(after.apply.size).toBe(0);                  // applied once, not every tick
  });

  it("an admin change applied during typing is not re-applied on the quiet poll", () => {
    const moved = { ...base, passport_status: "rejected" };
    const busy = planLiveRowStep(base, moved, cols(true));
    expect([...busy.apply]).toEqual(["passport_status"]);
    expect(planLiveRowStep(busy.next, moved, cols(false)).apply.size).toBe(0);
  });

  it("a partial baseline: a column the seed didn't include takes this read as its baseline", () => {
    const step = planLiveRowStep({ passport_status: "pending" }, { ...base, passport_status: "approved", first_name: "Amina" }, cols(false));
    expect([...step.apply]).toEqual(["passport_status"]);
    expect(step.next.first_name).toBe("Amina");
  });

  it("the snapshot holds every watched column, so a row that appears later is diffed", () => {
    const empty = planLiveRowStep(null, {}, cols(false));
    expect(empty.next).toEqual({ passport_status: null, manually_verified: null, first_name: null, passport_confirmed_fields: null });
    const appeared = planLiveRowStep(empty.next, { ...base, manually_verified: true }, cols(false));
    // passport_confirmed_fields: [] is a real value, not "no value" like null.
    expect([...appeared.apply].sort()).toEqual(["first_name", "manually_verified", "passport_confirmed_fields"]);
  });
});

describe("changedKeys — only-on-change semantics for polled rows", () => {
  const KEYS = ["first_name", "passport_status", "passport_confirmed_fields", "manually_verified"] as const;

  it("an identical poll reports nothing (no re-dispatch, no overwrite of unsaved typing)", () => {
    const row = { first_name: "Amina", passport_status: "pending", passport_confirmed_fields: ["dob"], manually_verified: false };
    expect(changedKeys(row, { ...row, passport_confirmed_fields: ["dob"] }, KEYS)).toEqual([]);
  });

  it("reports exactly the columns that moved", () => {
    const a = { first_name: "Amina", passport_status: "pending", passport_confirmed_fields: ["dob"], manually_verified: false };
    const b = { ...a, passport_status: "approved", passport_confirmed_fields: ["dob", "sex"] };
    expect(changedKeys(a, b, KEYS)).toEqual(["passport_status", "passport_confirmed_fields"]);
  });

  it("null and undefined are the same (a row appearing does not flag its null columns)", () => {
    const appeared = { first_name: "Amina", passport_status: null, passport_confirmed_fields: null, manually_verified: undefined };
    expect(changedKeys({}, appeared, KEYS)).toEqual(["first_name"]);
    expect(changedKeys(null, appeared, KEYS)).toEqual(["first_name"]);
  });

  it("ignores columns outside the watched list", () => {
    expect(changedKeys({ cv_draft: 1, first_name: "a" }, { cv_draft: 2, first_name: "a" }, KEYS)).toEqual([]);
  });
});

describe("sameJson", () => {
  it("compares payloads structurally", () => {
    expect(sameJson([{ id: "1", status: "pending" }], [{ id: "1", status: "pending" }])).toBe(true);
    expect(sameJson([{ id: "1", status: "pending" }], [{ id: "1", status: "approved" }])).toBe(false);
    expect(sameJson(null, undefined)).toBe(true);
    expect(sameJson({ a: 1 }, null)).toBe(false);
  });
});
