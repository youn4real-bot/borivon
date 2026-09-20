import { describe, it, expect } from "vitest";
import {
  journeyWrite,
  journeyLoad,
  journeyFailureText,
  journeyLoadFailedText,
} from "../lib/journeyOps";

/**
 * The journey checklist used to lie quietly. Ticking a step turned it green
 * and snapped back half a second later with nothing rendered — which reads as
 * a misclick, so people tick it again. Adding a step failed even more quietly:
 * `if (res.ok && j.item)` just did not fire, the text stayed in the input, and
 * the button looked unpressed.
 *
 * These drive the write and read handlers directly. The assertions are about
 * whether a caller can TELL that something failed, and what it should say.
 */

type Item = { id: string; text: string; done: boolean };
const ITEM: Item = { id: "i1", text: "Book the B2 exam", done: true };

function fakeFetch(outcome: { status: number; body?: unknown } | "reject" | "badjson") {
  const calls: { url: string; method?: string; body: unknown; auth?: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url: String(input),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: h.Authorization,
    });
    if (outcome === "reject") throw new TypeError("Failed to fetch");
    if (outcome === "badjson") {
      return { ok: true, status: 200, json: async () => { throw new SyntaxError("<"); } } as unknown as Response;
    }
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      json: async () => outcome.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("journeyWrite", () => {
  it("a 200 with an item hands the canonical row back", async () => {
    const f = fakeFetch({ status: 200, body: { item: ITEM } });
    const res = await journeyWrite<Item>({
      fetchImpl: f.impl, token: "jwt", method: "PATCH",
      body: { candidateId: "c1", id: "i1", done: true },
    });
    expect(res).toEqual({ ok: true, item: ITEM });
    expect(f.calls[0].url).toBe("/api/portal/journey");
    expect(f.calls[0].method).toBe("PATCH");
    expect(f.calls[0].auth).toBe("Bearer jwt");
    expect(f.calls[0].body).toEqual({ candidateId: "c1", id: "i1", done: true });
  });

  it("THE BUG: a 500 is reported, so the revert can be explained", async () => {
    const f = fakeFetch({ status: 500 });
    expect(await journeyWrite({ fetchImpl: f.impl, token: "jwt", method: "PATCH", body: {} }))
      .toEqual({ ok: false, status: 500 });
  });

  it("a 403 keeps its status, so the wording can differ from a glitch", async () => {
    const f = fakeFetch({ status: 403 });
    expect(await journeyWrite({ fetchImpl: f.impl, token: "jwt", method: "PATCH", body: {} }))
      .toEqual({ ok: false, status: 403 });
  });

  it("offline is an outcome, never a thrown error", async () => {
    const f = fakeFetch("reject");
    expect(await journeyWrite({ fetchImpl: f.impl, token: "jwt", method: "POST", body: {} }))
      .toEqual({ ok: false, status: null });
  });

  it("no token sends nothing and claims nothing", async () => {
    const f = fakeFetch({ status: 200, body: { item: ITEM } });
    expect(await journeyWrite({ fetchImpl: f.impl, token: "", method: "POST", body: {} }))
      .toEqual({ ok: false, status: null });
    expect(f.calls).toHaveLength(0);
  });

  it("a 2xx with no body still counts as written (DELETE answers this way)", async () => {
    const f = fakeFetch("badjson");
    expect(await journeyWrite({ fetchImpl: f.impl, token: "jwt", method: "DELETE", body: { id: "i1" } }))
      .toEqual({ ok: true, item: null });
  });

  it("the B2 controls post to their own endpoint", async () => {
    const f = fakeFetch({ status: 200, body: {} });
    await journeyWrite({ fetchImpl: f.impl, token: "jwt", method: "POST", path: "/api/portal/journey/b2", body: { stage: "passed" } });
    expect(f.calls[0].url).toBe("/api/portal/journey/b2");
  });

  it("an ADD that fails is distinguishable from one that succeeded", async () => {
    // The old code's `if (res.ok && j.item)` collapsed both into "do nothing".
    const failed = await journeyWrite<Item>({ fetchImpl: fakeFetch({ status: 500 }).impl, token: "jwt", method: "POST", body: {} });
    const ok = await journeyWrite<Item>({ fetchImpl: fakeFetch({ status: 200, body: { item: ITEM } }).impl, token: "jwt", method: "POST", body: {} });
    expect(failed.ok).toBe(false);
    expect(ok.ok).toBe(true);
  });
});

describe("journeyLoad", () => {
  it("a good read returns the payload", async () => {
    const f = fakeFetch({ status: 200, body: { items: [ITEM], canAdd: true } });
    const r = await journeyLoad({ fetchImpl: f.impl, token: "jwt", candidateId: "c1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ items: [ITEM], canAdd: true });
  });

  it("the candidate id is encoded into the query", async () => {
    const f = fakeFetch({ status: 200, body: {} });
    await journeyLoad({ fetchImpl: f.impl, token: "jwt", candidateId: "a b&c" });
    expect(f.calls[0].url).toBe("/api/portal/journey?candidateId=a%20b%26c");
  });

  it("THE BUG: a failed read is NOT an empty checklist", async () => {
    expect(await journeyLoad({ fetchImpl: fakeFetch({ status: 500 }).impl, token: "jwt", candidateId: "c1" }))
      .toEqual({ ok: false, status: 500 });
    expect(await journeyLoad({ fetchImpl: fakeFetch("reject").impl, token: "jwt", candidateId: "c1" }))
      .toEqual({ ok: false, status: null });
  });

  it("a 200 that will not parse is broken, not empty", async () => {
    expect(await journeyLoad({ fetchImpl: fakeFetch("badjson").impl, token: "jwt", candidateId: "c1" }))
      .toEqual({ ok: false, status: 200 });
  });
});

describe("journeyFailureText — LAW #19, and honest about what to do next", () => {
  for (const lang of ["en", "fr", "de"]) {
    it(`${lang}: every case has words`, () => {
      for (const status of [500, 403, 401, null, 404]) {
        const s = journeyFailureText(status as number | null, lang);
        expect(s.length).toBeGreaterThan(10);
      }
      expect(journeyLoadFailedText(lang).length).toBeGreaterThan(10);
    });
  }

  it("the three languages differ (no silent English fallthrough)", () => {
    const [en, fr, de] = ["en", "fr", "de"].map(l => journeyFailureText(500, l));
    expect(new Set([en, fr, de]).size).toBe(3);
  });

  it("an unknown language falls back to English rather than rendering nothing", () => {
    expect(journeyFailureText(500, "ar")).toBe(journeyFailureText(500, "en"));
  });

  it("403 does NOT tell her to try again — it isn't hers to tick", () => {
    expect(journeyFailureText(403, "en")).not.toMatch(/try again/i);
    expect(journeyFailureText(403, "fr")).not.toMatch(/réessayez/i);
    expect(journeyFailureText(403, "de")).not.toMatch(/erneut versuchen/i);
  });

  it("a dropped connection says so, and a server error invites a retry", () => {
    expect(journeyFailureText(null, "en")).toMatch(/connection/i);
    expect(journeyFailureText(500, "en")).toMatch(/try again/i);
  });
});
