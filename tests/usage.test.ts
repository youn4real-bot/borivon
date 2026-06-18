import { describe, it, expect } from "vitest";
import { extractTokens, estimateCostUsd, periodStartMs } from "@/lib/usage";

describe("usage helpers", () => {
  it("extractTokens reads the AI SDK v6 shape", () => {
    expect(extractTokens({ inputTokens: 1200, outputTokens: 340, totalTokens: 1540 })).toEqual({ input: 1200, output: 340, cacheRead: 0, cacheWrite: 0 });
  });
  it("extractTokens reads the older promptTokens/completionTokens shape", () => {
    expect(extractTokens({ promptTokens: 50, completionTokens: 10 })).toEqual({ input: 50, output: 10, cacheRead: 0, cacheWrite: 0 });
  });
  it("extractTokens is safe on junk / missing", () => {
    expect(extractTokens(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(extractTokens({ foo: "bar" })).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(extractTokens({ inputTokens: -5 })).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }); // never negative
  });
  it("extractTokens reads the prompt-cache split from inputTokenDetails", () => {
    expect(
      extractTokens({ inputTokens: 18000, outputTokens: 200, inputTokenDetails: { cacheReadTokens: 16000, cacheWriteTokens: 0, noCacheTokens: 2000 } }),
    ).toEqual({ input: 18000, output: 200, cacheRead: 16000, cacheWrite: 0 });
  });
  it("estimateCostUsd prices at the primary brain (Gemini Pro $1.25/$10)", () => {
    // 1M input + 1M output = $1.25 + $10.00 = $11.25 (update if PRIMARY_BRAIN changes)
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBe(11.25);
    expect(estimateCostUsd(0, 0)).toBe(0);
  });
  it("estimateCostUsd prices cache reads ~0.1x and writes 1.25x", () => {
    // 1M input all served from cache → 1M * $1.25 * 0.1 = $0.125 ≈ $0.13
    expect(estimateCostUsd(1_000_000, 0, 1_000_000, 0)).toBe(0.13);
    // 1M input all cache-write → 1M * $1.25 * 1.25 = $1.5625 ≈ $1.56
    expect(estimateCostUsd(1_000_000, 0, 0, 1_000_000)).toBe(1.56);
  });
  it("periodStartMs: today = UTC midnight, week/month roll back", () => {
    const now = Date.parse("2026-06-15T18:30:00.000Z");
    expect(new Date(periodStartMs("today", now)).toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(periodStartMs("week", now)).toBe(now - 7 * 86_400_000);
    expect(periodStartMs("month", now)).toBe(now - 30 * 86_400_000);
  });
});
