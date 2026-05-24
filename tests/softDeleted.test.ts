import { describe, it, expect } from "vitest";
import { isSoftDeletedAuthUser } from "../lib/softDeleted";

// Privacy: a soft-deleted ("ghost") account must never surface in any
// admin-facing list. Every enumeration runs rows through this.
describe("isSoftDeletedAuthUser", () => {
  it("flags user_metadata.deleted", () => {
    expect(isSoftDeletedAuthUser({ user_metadata: { deleted: true } })).toBe(true);
  });

  it("flags raw_user_meta_data.deleted", () => {
    expect(isSoftDeletedAuthUser({ raw_user_meta_data: { deleted: true } })).toBe(true);
  });

  it("flags the scrambled deleted email (case-insensitive)", () => {
    expect(isSoftDeletedAuthUser({ email: "deleted+abc123@borivon.invalid" })).toBe(true);
    expect(isSoftDeletedAuthUser({ email: "DELETED+ABC@Borivon.Invalid" })).toBe(true);
  });

  it("flags an account banned into the future", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isSoftDeletedAuthUser({ banned_until: future })).toBe(true);
  });

  it("does NOT flag an expired ban", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isSoftDeletedAuthUser({ banned_until: past })).toBe(false);
  });

  it("does NOT flag a normal active user", () => {
    expect(isSoftDeletedAuthUser({ email: "real@example.com", user_metadata: {} })).toBe(false);
  });

  it("handles null / undefined / empty safely", () => {
    expect(isSoftDeletedAuthUser(null)).toBe(false);
    expect(isSoftDeletedAuthUser(undefined)).toBe(false);
    expect(isSoftDeletedAuthUser({})).toBe(false);
  });
});
