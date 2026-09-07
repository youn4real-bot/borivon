import { describe, it, expect } from "vitest";
import { planEarningReconciliation, type EarningRow } from "@/lib/affiliates";

/** Build inputs with sensible defaults; override per test. */
function plan(over: {
  affByUser?: [string, string][];
  arrived?: string[];
  comm?: [string, { amount: number; active: boolean }][];
  existing?: EarningRow[];
}) {
  return planEarningReconciliation({
    affByUser: new Map(over.affByUser ?? []),
    arrivedSet: new Set(over.arrived ?? []),
    comm: new Map(over.comm ?? []),
    existing: over.existing ?? [],
  });
}
const row = (o: Partial<EarningRow> & { id: string }): EarningRow => ({
  affiliate_id: "a1", candidate_user_id: "u1", amount_eur: 100, status: "owed", ...o,
});

describe("planEarningReconciliation — inserts", () => {
  it("creates an owed earning for a new arrived+referred candidate of an active affiliate", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 100, active: true }]], existing: [] });
    expect(p.toInsert).toEqual([{ affiliate_id: "a1", candidate_user_id: "u1", amount_eur: 100, status: "owed" }]);
    expect(p.toOwed).toEqual([]); expect(p.toRefresh).toEqual([]); expect(p.toVoid).toEqual([]);
  });
  it("does NOT create for an inactive affiliate", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 100, active: false }]], existing: [] });
    expect(p.toInsert).toEqual([]);
  });
  it("does NOT create for an arrived candidate with no affiliate mapping", () => {
    const p = plan({ affByUser: [], arrived: ["u1"], comm: [["a1", { amount: 100, active: true }]], existing: [] });
    expect(p.toInsert).toEqual([]);
  });
});

describe("planEarningReconciliation — void (reversed / de-attributed)", () => {
  it("voids an owed row whose candidate is no longer arrived (reversed placement)", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: [], comm: [["a1", { amount: 100, active: true }]], existing: [row({ id: "e1", status: "owed" })] });
    expect(p.toVoid).toEqual(["e1"]);
    expect(p.toInsert).toEqual([]); expect(p.toOwed).toEqual([]);
  });
  it("voids an owed row whose attribution was removed (not referred anymore)", () => {
    const p = plan({ affByUser: [], arrived: [], comm: [["a1", { amount: 100, active: true }]], existing: [row({ id: "e1", status: "owed" })] });
    expect(p.toVoid).toEqual(["e1"]);
  });
  it("NEVER voids a paid row, even when reversed", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: [], comm: [["a1", { amount: 100, active: true }]], existing: [row({ id: "e1", status: "paid" })] });
    expect(p.toVoid).toEqual([]);
  });
  it("does NOT void an inactive affiliate's already-earned owed row (still arrived+referred)", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 100, active: false }]], existing: [row({ id: "e1", status: "owed" })] });
    expect(p.toVoid).toEqual([]);   // protected: arrived+referred → qualified
    expect(p.toInsert).toEqual([]); // but inactive → no new work
    expect(p.toOwed).toEqual([]);
  });
});

describe("planEarningReconciliation — revive on re-arrival", () => {
  it("revives a void row back to owed when the candidate is placed again", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 100, active: true }]], existing: [row({ id: "e1", status: "void", amount_eur: 100 })] });
    expect(p.toOwed).toEqual(["e1"]);
    expect(p.toRefresh).toEqual([]); // amount already non-zero
    expect(p.toVoid).toEqual([]); expect(p.toInsert).toEqual([]);
  });
  it("revives AND refreshes a €0 void row", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 250, active: true }]], existing: [row({ id: "e1", status: "void", amount_eur: 0 })] });
    expect(p.toOwed).toEqual(["e1"]);
    expect(p.toRefresh).toEqual([{ id: "e1", amount: 250 }]);
  });
});

describe("planEarningReconciliation — €0 refresh on owed", () => {
  it("refreshes a €0 owed row when commission is now > 0", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 500, active: true }]], existing: [row({ id: "e1", status: "owed", amount_eur: 0 })] });
    expect(p.toRefresh).toEqual([{ id: "e1", amount: 500 }]);
    expect(p.toOwed).toEqual([]); expect(p.toVoid).toEqual([]); expect(p.toInsert).toEqual([]);
  });
  it("does NOT refresh a non-zero owed row", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 500, active: true }]], existing: [row({ id: "e1", status: "owed", amount_eur: 100 })] });
    expect(p.toRefresh).toEqual([]);
  });
  it("does NOT refresh a €0 PAID row", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 500, active: true }]], existing: [row({ id: "e1", status: "paid", amount_eur: 0 })] });
    expect(p.toRefresh).toEqual([]);
  });
});

describe("planEarningReconciliation — mixed & idempotency", () => {
  it("is a no-op when an active owed row is still qualified and non-zero", () => {
    const p = plan({ affByUser: [["u1", "a1"]], arrived: ["u1"], comm: [["a1", { amount: 100, active: true }]], existing: [row({ id: "e1", status: "owed", amount_eur: 100 })] });
    expect(p).toEqual({ toInsert: [], toOwed: [], toRefresh: [], toVoid: [] });
  });
  it("handles several affiliates/candidates at once", () => {
    const p = plan({
      affByUser: [["u1", "a1"], ["u2", "a1"], ["u3", "a2"]],
      arrived: ["u1", "u3"], // u2 not arrived
      comm: [["a1", { amount: 100, active: true }], ["a2", { amount: 200, active: true }]],
      existing: [
        row({ id: "e1", affiliate_id: "a1", candidate_user_id: "u1", status: "owed", amount_eur: 100 }), // stays
        row({ id: "e2", affiliate_id: "a1", candidate_user_id: "u2", status: "owed", amount_eur: 100 }), // u2 not arrived → void
      ],
    });
    expect(p.toInsert).toEqual([{ affiliate_id: "a2", candidate_user_id: "u3", amount_eur: 200, status: "owed" }]); // u3 new
    expect(p.toVoid).toEqual(["e2"]);
    expect(p.toOwed).toEqual([]); expect(p.toRefresh).toEqual([]);
  });
});
