import { describe, it, expect } from "vitest";
import { fetchPhaseSlots, emptyStateKind } from "../lib/dashboardLoad";

/**
 * One hiccup on /api/portal/phase-slots used to make every Bearbeitung and
 * Visum box a nurse had filled disappear behind "Documents being configured."
 * — the same sentence a brand-new account shows. The read answered a 500, the
 * old code folded it into `{ slots: [] }`, and then marked the load complete.
 *
 * These drive the loader directly with a scripted fetch: the only thing under
 * test is whether a failure can still masquerade as an empty account.
 */

type Slot = { id: string; label: string };
type Cat = { id: string; label: string };

const SLOTS_BEA = [{ id: "s1", label: "Anerkennung" }];
const SLOTS_VIS = [{ id: "s2", label: "Termin" }];

/** Answers per URL fragment. A value of "reject" throws like an offline fetch. */
function scriptedFetch(routes: Record<string, { status: number; body?: unknown } | "reject" | "badjson">) {
  const seen: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const key = Object.keys(routes).find(k => url.includes(k));
    const r = key ? routes[key] : { status: 200, body: {} };
    if (r === "reject") throw new TypeError("Failed to fetch");
    if (r === "badjson") {
      return { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response;
    }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} } as Response;
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const HEALTHY = {
  "phase-slots?phase=bearbeitung": { status: 200, body: { slots: SLOTS_BEA } },
  "phase-slots?phase=visum": { status: 200, body: { slots: SLOTS_VIS } },
  "phase-slot-categories?phase=bearbeitung": { status: 200, body: { categories: [{ id: "c1", label: "A" }] } },
  "phase-slot-categories?phase=visum": { status: 200, body: { categories: [] } },
  "phase-doc-order": { status: 200, body: { orders: { visum: ["ezb", "videx"] } } },
} as const;

describe("fetchPhaseSlots", () => {
  it("all healthy → the real lists, categories and order", async () => {
    const f = scriptedFetch({ ...HEALTHY });
    const res = await fetchPhaseSlots<Slot, Cat>(f.impl, "jwt");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bea).toEqual(SLOTS_BEA);
    expect(res.vis).toEqual(SLOTS_VIS);
    expect(res.catsBea).toHaveLength(1);
    expect(res.visumOrder).toEqual(["ezb", "videx"]);
  });

  it("THE BUG: a 500 on the Bearbeitung read is a FAILURE, never an empty phase", async () => {
    const f = scriptedFetch({ ...HEALTHY, "phase-slots?phase=bearbeitung": { status: 500 } });
    const res = await fetchPhaseSlots<Slot, Cat>(f.impl, "jwt");
    expect(res).toEqual({ ok: false, status: 500 });
  });

  it("THE BUG: a 500 on the Visum read is a FAILURE too", async () => {
    const f = scriptedFetch({ ...HEALTHY, "phase-slots?phase=visum": { status: 500 } });
    expect(await fetchPhaseSlots<Slot, Cat>(f.impl, "jwt")).toEqual({ ok: false, status: 500 });
  });

  it("offline → a failure with no status, not an empty phase", async () => {
    const f = scriptedFetch({ ...HEALTHY, "phase-slots?phase=visum": "reject" });
    expect(await fetchPhaseSlots<Slot, Cat>(f.impl, "jwt")).toEqual({ ok: false, status: null });
  });

  it("a 200 whose body will not parse is broken, not empty", async () => {
    const f = scriptedFetch({ ...HEALTHY, "phase-slots?phase=bearbeitung": "badjson" });
    expect(await fetchPhaseSlots<Slot, Cat>(f.impl, "jwt")).toEqual({ ok: false, status: 200 });
  });

  it("an account genuinely with no slots succeeds with empty lists", async () => {
    const f = scriptedFetch({
      ...HEALTHY,
      "phase-slots?phase=bearbeitung": { status: 200, body: { slots: [] } },
      "phase-slots?phase=visum": { status: 200, body: { slots: [] } },
    });
    const res = await fetchPhaseSlots<Slot, Cat>(f.impl, "jwt");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.bea).toEqual([]);
  });

  it("categories failing only flattens the list — her slots still render", async () => {
    const f = scriptedFetch({
      ...HEALTHY,
      "phase-slot-categories?phase=bearbeitung": { status: 500 },
      "phase-slot-categories?phase=visum": "reject",
    });
    const res = await fetchPhaseSlots<Slot, Cat>(f.impl, "jwt");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bea).toEqual(SLOTS_BEA);
    expect(res.catsBea).toEqual([]);
  });

  it("the doc-order read failing only loses the admin's ordering", async () => {
    const f = scriptedFetch({ ...HEALTHY, "phase-doc-order": "reject" });
    const res = await fetchPhaseSlots<Slot, Cat>(f.impl, "jwt");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visumOrder).toBeNull();
  });

  it("no token sends nothing and reports a failure", async () => {
    const f = scriptedFetch({ ...HEALTHY });
    expect(await fetchPhaseSlots<Slot, Cat>(f.impl, "")).toEqual({ ok: false, status: null });
    expect(f.seen).toHaveLength(0);
  });
});

describe("emptyStateKind — empty must not look like broken", () => {
  it("rows on screen → no empty state at all", () => {
    expect(emptyStateKind({ loaded: true, failed: false, itemCount: 3 })).toBe("none");
  });

  it("loaded, no rows → the account is being configured", () => {
    expect(emptyStateKind({ loaded: true, failed: false, itemCount: 0 })).toBe("configuring");
  });

  it("THE BUG: a failed load says FAILED, not 'being configured'", () => {
    expect(emptyStateKind({ loaded: false, failed: true, itemCount: 0 })).toBe("failed");
  });

  it("a failure after an earlier success still says failed", () => {
    expect(emptyStateKind({ loaded: true, failed: true, itemCount: 0 })).toBe("failed");
  });

  it("still loading → say nothing yet", () => {
    expect(emptyStateKind({ loaded: false, failed: false, itemCount: 0 })).toBe("loading");
  });

  it("a failed refresh that left rows on screen keeps them — the strip says the rest", () => {
    expect(emptyStateKind({ loaded: true, failed: true, itemCount: 5 })).toBe("none");
  });
});
