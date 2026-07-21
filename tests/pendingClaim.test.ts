import { describe, it, expect } from "vitest";
import { claimPendingRow, type ClaimDb } from "../lib/assistantWrites";

/**
 * THE DUPLICATE-SEND REGRESSION.
 *
 * The founder hit this live: one instruction, the SAME email sent twice, two
 * "✅ Done" about a minute apart. Root cause was ordering — a staged action was
 * executed FIRST and only marked afterwards, so two runs of the same turn could
 * both read it as 'pending' and both send. A minute apart is Telegram's retry
 * window: a turn that sends but dies before stamping responded_at is redelivered
 * after 65s and re-ran the row, which was still 'pending'.
 *
 * claimPendingRow makes ownership atomic. These tests simulate Postgres's real
 * conditional-update semantics (the WHERE runs against current row state, and
 * only matched rows come back) rather than a fixed stub, so "exactly one wins"
 * is genuinely exercised.
 */

/** Fake table honouring `update … where id=? and status=? returning id`. */
function fakeDb(rows: Record<string, { status: string }>, opts?: { throwOnUpdate?: boolean; errorOnUpdate?: boolean }) {
  const db: ClaimDb = {
    from: () => ({
      update: (patch: { status: string }) => ({
        eq: (_c1: string, id: string) => ({
          eq: (_c2: string, requiredStatus: string) => ({
            select: async () => {
              if (opts?.throwOnUpdate) throw new Error("connection reset");
              if (opts?.errorOnUpdate) return { data: null, error: { message: "boom" } };
              const row = rows[id];
              // The WHERE is evaluated against CURRENT state — this is the atomicity.
              if (!row || row.status !== requiredStatus) return { data: [], error: null };
              row.status = patch.status;
              return { data: [{ id }], error: null };
            },
          }),
        }),
      }),
    }),
  };
  return db;
}

describe("claimPendingRow — exactly one run may execute a staged action", () => {
  it("claims a pending row and flips it to confirmed", async () => {
    const rows = { r1: { status: "pending" } };
    expect(await claimPendingRow(fakeDb(rows), "r1")).toBe("claimed");
    expect(rows.r1.status).toBe("confirmed");
  });

  it("THE BUG: a second attempt on the same row does NOT get to execute", async () => {
    const rows = { r1: { status: "pending" } };
    const db = fakeDb(rows);
    expect(await claimPendingRow(db, "r1")).toBe("claimed");
    // Telegram redelivers the update; the retry must be refused, not re-sent.
    expect(await claimPendingRow(db, "r1")).toBe("taken");
  });

  it("under concurrency exactly ONE of many racers wins", async () => {
    const rows = { r1: { status: "pending" } };
    const db = fakeDb(rows);
    const results = await Promise.all(Array.from({ length: 8 }, () => claimPendingRow(db, "r1")));
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r === "taken")).toHaveLength(7);
  });

  it("refuses a row that was already cancelled or expired", async () => {
    for (const status of ["cancelled", "expired", "confirmed"]) {
      const rows = { r1: { status } };
      expect(await claimPendingRow(fakeDb(rows), "r1"), status).toBe("taken");
    }
  });

  it("refuses a row that doesn't exist", async () => {
    expect(await claimPendingRow(fakeDb({}), "ghost")).toBe("taken");
  });

  it("independent rows don't block each other", async () => {
    const rows = { a: { status: "pending" }, b: { status: "pending" } };
    const db = fakeDb(rows);
    expect(await claimPendingRow(db, "a")).toBe("claimed");
    expect(await claimPendingRow(db, "b")).toBe("claimed");
  });

  it("a DB error reports 'error' (row stays pending → retryable, never double-sent)", async () => {
    const rows = { r1: { status: "pending" } };
    expect(await claimPendingRow(fakeDb(rows, { errorOnUpdate: true }), "r1")).toBe("error");
    expect(rows.r1.status).toBe("pending");
  });

  it("a thrown connection failure reports 'error' rather than escaping", async () => {
    const rows = { r1: { status: "pending" } };
    expect(await claimPendingRow(fakeDb(rows, { throwOnUpdate: true }), "r1")).toBe("error");
    expect(rows.r1.status).toBe("pending");
  });
});
