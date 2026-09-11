import { describe, it, expect } from "vitest";
import { readAllRows, PAGE_SIZE } from "../lib/readAllRows";

/** A fake PostgREST that caps every response at PAGE_SIZE rows, like the real one. */
function fakeTable(total: number, failAtPage?: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    if (failAtPage !== undefined && calls.length - 1 === failAtPage) return { data: null, error: { message: "boom" } };
    return { data: rows.slice(from, Math.min(to + 1, from + PAGE_SIZE)), error: null };
  };
  return { page, calls };
}

describe("readAllRows", () => {
  it("returns every row past the 1000-row cap", async () => {
    const t = fakeTable(2345);
    const r = await readAllRows<{ id: number }>(t.page);
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(2345);
    expect(r.data!.at(-1)).toEqual({ id: 2344 });
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("makes one request when the table is small", async () => {
    const t = fakeTable(734);
    const r = await readAllRows(t.page);
    expect(r.data).toHaveLength(734);
    expect(t.calls).toHaveLength(1);
  });

  it("asks for one more page when a page is exactly full", async () => {
    const t = fakeTable(1000);
    const r = await readAllRows(t.page);
    expect(r.data).toHaveLength(1000);
    expect(t.calls).toHaveLength(2);
  });

  it("never returns a partial list that looks complete", async () => {
    const t = fakeTable(2500, 1);
    const r = await readAllRows(t.page);
    expect(r.data).toBeNull();
    expect(r.error).toEqual({ message: "boom" });
  });

  it("handles an empty table", async () => {
    const r = await readAllRows(fakeTable(0).page);
    expect(r).toEqual({ data: [], error: null });
  });
});
