import { describe, it, expect } from "vitest";
import {
  savePassportDraft,
  writeLocalDraft,
  flushAndReleaseLocalDraft,
  type DraftStorage,
} from "../lib/passportDraft";

/**
 * A candidate types eighteen passport fields on a phone. Closing the form used
 * to fire a best-effort POST and delete BOTH localStorage keys in the same
 * tick, without reading the response. One failed save — offline in a lift, a
 * 502, an expired JWT — and her only copy was gone, silently.
 *
 * These drive the handler directly: a fake fetch decides the outcome, a Map
 * stands in for localStorage, and the assertions are about what is left on the
 * device afterwards.
 */

const KEYS = { data: "bv-passport-pending-u1", confirmed: "bv-passport-confirmed-u1" };
const DRAFT = { last_name: "BENALI", first_name: "SALMA", passport_no: "AB1234567" };
const CONFIRMED = ["last_name", "passport_no"];

/** localStorage over a Map, plus the two ways a real browser misbehaves. */
function memStorage(seed: Record<string, string> = {}, opts: { failWrites?: boolean; failRemoves?: boolean } = {}): DraftStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      // Safari private mode throws QuotaExceededError on the first setItem.
      if (opts.failWrites) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k) => {
      if (opts.failRemoves) throw new Error("SecurityError");
      map.delete(k);
    },
  };
}

/** A fetch that answers however the test says, and records what it was sent. */
function fakeFetch(outcome: { status: number } | "reject") {
  const calls: { url: string; body: unknown; keepalive: boolean }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
      keepalive: init?.keepalive === true,
    });
    if (outcome === "reject") throw new TypeError("Failed to fetch");
    return { ok: outcome.status >= 200 && outcome.status < 300, status: outcome.status } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("savePassportDraft", () => {
  it("a 200 is a save", async () => {
    const f = fakeFetch({ status: 200 });
    const res = await savePassportDraft({ fetchImpl: f.impl, token: "jwt", data: DRAFT, confirmed: CONFIRMED });
    expect(res).toEqual({ saved: true, status: 200 });
    expect(f.calls[0].url).toBe("/api/portal/passport");
    // The draft flag is what stops this marking the passport submitted.
    expect(f.calls[0].body).toMatchObject({ ...DRAFT, confirmed_fields: CONFIRMED, __draft: true });
  });

  it("a 500 is NOT a save", async () => {
    const f = fakeFetch({ status: 500 });
    expect(await savePassportDraft({ fetchImpl: f.impl, token: "jwt", data: DRAFT, confirmed: [] }))
      .toEqual({ saved: false, status: 500 });
  });

  it("an expired JWT (401) is NOT a save", async () => {
    const f = fakeFetch({ status: 401 });
    expect((await savePassportDraft({ fetchImpl: f.impl, token: "stale", data: DRAFT, confirmed: [] })).saved).toBe(false);
  });

  it("a rejected fetch (offline) is reported, never thrown", async () => {
    const f = fakeFetch("reject");
    expect(await savePassportDraft({ fetchImpl: f.impl, token: "jwt", data: DRAFT, confirmed: [] }))
      .toEqual({ saved: false, status: null });
  });

  it("no token sends nothing and claims nothing", async () => {
    const f = fakeFetch({ status: 200 });
    expect(await savePassportDraft({ fetchImpl: f.impl, token: "", data: DRAFT, confirmed: [] }))
      .toEqual({ saved: false, status: null });
    expect(f.calls).toHaveLength(0);
  });
});

describe("writeLocalDraft", () => {
  it("stores data and checkboxes under their own keys", () => {
    const s = memStorage();
    expect(writeLocalDraft(s, KEYS, DRAFT, CONFIRMED)).toBe(true);
    expect(JSON.parse(s.map.get(KEYS.data)!)).toEqual(DRAFT);
    expect(JSON.parse(s.map.get(KEYS.confirmed)!)).toEqual(CONFIRMED);
  });

  it("a browser that refuses storage reports false instead of throwing", () => {
    const s = memStorage({}, { failWrites: true });
    expect(writeLocalDraft(s, KEYS, DRAFT, CONFIRMED)).toBe(false);
  });
});

describe("flushAndReleaseLocalDraft — her only copy", () => {
  const seeded = () => memStorage({
    [KEYS.data]: JSON.stringify(DRAFT),
    [KEYS.confirmed]: JSON.stringify(CONFIRMED),
  });

  it("server confirms → the local copy is released", async () => {
    const f = fakeFetch({ status: 200 });
    const s = seeded();
    const res = await flushAndReleaseLocalDraft({ fetchImpl: f.impl, token: "jwt", data: DRAFT, confirmed: CONFIRMED, storage: s, keys: KEYS });
    expect(res).toEqual({ saved: true, status: 200, keptLocal: false });
    expect(s.map.size).toBe(0);
  });

  it("THE BUG: a 500 on close must NOT delete her draft", async () => {
    const f = fakeFetch({ status: 500 });
    const s = seeded();
    const res = await flushAndReleaseLocalDraft({ fetchImpl: f.impl, token: "jwt", data: DRAFT, confirmed: CONFIRMED, storage: s, keys: KEYS });
    expect(res.keptLocal).toBe(true);
    expect(JSON.parse(s.map.get(KEYS.data)!)).toEqual(DRAFT);
    expect(JSON.parse(s.map.get(KEYS.confirmed)!)).toEqual(CONFIRMED);
  });

  it("THE BUG: offline on close must NOT delete her draft", async () => {
    const f = fakeFetch("reject");
    const s = seeded();
    const res = await flushAndReleaseLocalDraft({ fetchImpl: f.impl, token: "jwt", data: DRAFT, confirmed: CONFIRMED, storage: s, keys: KEYS });
    expect(res).toEqual({ saved: false, status: null, keptLocal: true });
    expect(s.map.size).toBe(2);
  });

  it("no token on close must NOT delete her draft", async () => {
    const f = fakeFetch({ status: 200 });
    const s = seeded();
    const res = await flushAndReleaseLocalDraft({ fetchImpl: f.impl, token: "", data: DRAFT, confirmed: CONFIRMED, storage: s, keys: KEYS });
    expect(res.keptLocal).toBe(true);
    expect(f.calls).toHaveLength(0);
    expect(s.map.size).toBe(2);
  });

  it("the close POST uses keepalive so it outlives the unmount", async () => {
    const f = fakeFetch({ status: 200 });
    await flushAndReleaseLocalDraft({ fetchImpl: f.impl, token: "jwt", data: DRAFT, confirmed: CONFIRMED, storage: seeded(), keys: KEYS });
    expect(f.calls[0].keepalive).toBe(true);
  });

  it("saved, but the device refuses to forget → still counts as saved", async () => {
    const f = fakeFetch({ status: 200 });
    const s = memStorage({ [KEYS.data]: JSON.stringify(DRAFT) }, { failRemoves: true });
    const res = await flushAndReleaseLocalDraft({ fetchImpl: f.impl, token: "jwt", data: DRAFT, confirmed: CONFIRMED, storage: s, keys: KEYS });
    // The server has it — leaving a stale local copy behind is harmless, and
    // must not be reported to her as "not saved".
    expect(res.keptLocal).toBe(false);
  });
});
