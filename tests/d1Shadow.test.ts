import { describe, it, expect } from "vitest";
import { compareBodies, withShadowReads, setShadowReporter } from "../lib/d1/shadow";

/**
 * The shadow comparison must be exact about real differences and quiet about
 * harmless formatting, or the signal drowns. And it must never disturb the
 * response the portal is serving.
 */
describe("compareBodies", () => {
  it("agrees when the rows are the same", () => {
    const rows = [{ id: "a", n: 1, ok: true, j: { x: 1 } }];
    expect(compareBodies("documents", rows, [{ ...rows[0] }])).toBeNull();
  });

  it("ignores timestamp formatting, compares the instant", () => {
    const a = [{ id: "1", at: "2026-09-12T07:01:15.753+00:00" }];
    const b = [{ id: "1", at: "2026-09-12T07:01:15.753000+00:00" }];
    expect(compareBodies("documents", a, b)).toBeNull();
    const c = [{ id: "1", at: "2026-09-12T07:01:15.754+00:00" }];
    expect(compareBodies("documents", a, c)?.kind).toBe("cells");
  });

  it("ignores key order inside objects", () => {
    expect(compareBodies("t", [{ a: 1, b: 2 }], [{ b: 2, a: 1 }])).toBeNull();
  });

  it("reports a row-count difference", () => {
    const d = compareBodies("documents", [{ id: "1" }, { id: "2" }], [{ id: "1" }]);
    expect(d).toEqual({ table: "documents", kind: "rows", detail: "supabase 2 rows, d1 1" });
  });

  it("names the columns that differ, and how often", () => {
    const a = [{ id: "1", status: "approved", note: "x" }, { id: "2", status: "pending", note: "y" }];
    const b = [{ id: "1", status: "rejected", note: "x" }, { id: "2", status: "rejected", note: "y" }];
    const d = compareBodies("documents", a, b);
    expect(d?.kind).toBe("cells");
    expect(d?.detail).toBe("status×2");
  });

  it("never leaks values into the report", () => {
    const d = compareBodies("candidate_profiles", [{ user_id: "u", passport_no: "AB123456" }], [{ user_id: "u", passport_no: "ZZ999999" }]);
    expect(JSON.stringify(d)).not.toContain("AB123456");
    expect(JSON.stringify(d)).not.toContain("ZZ999999");
  });
});

describe("withShadowReads", () => {
  it("returns the base response untouched and leaves its body readable", async () => {
    const body = [{ id: "1" }];
    const base = (async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const wrapped = withShadowReads(base);
    const res = await wrapped("https://x.supabase.co/rest/v1/documents?select=id");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);   // body not consumed by the shadow path
  });

  it("does nothing at all when the sample rate is unset", async () => {
    const seen: unknown[] = [];
    setShadowReporter((d) => seen.push(d));
    const base = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    await withShadowReads(base)("https://x.supabase.co/rest/v1/documents?select=id");
    expect(seen).toEqual([]);
    setShadowReporter(null);
  });
});
