import { describe, it, expect } from "vitest";
import { extractTokens, estimateCostUsd, periodStartMs } from "@/lib/usage";

describe("usage helpers", () => {
  it("extractTokens reads the AI SDK v6 shape", () => {
    expect(extractTokens({ inputTokens: 1200, outputTokens: 340, totalTokens: 1540 })).toEqual({ input: 1200, output: 340 });
  });
  it("extractTokens reads the older promptTokens/completionTokens shape", () => {
    expect(extractTokens({ promptTokens: 50, completionTokens: 10 })).toEqual({ input: 50, output: 10 });
  });
  it("extractTokens is safe on junk / missing", () => {
    expect(extractTokens(undefined)).toEqual({ input: 0, output: 0 });
    expect(extractTokens({ foo: "bar" })).toEqual({ input: 0, output: 0 });
    expect(extractTokens({ inputTokens: -5 })).toEqual({ input: 0, output: 0 }); // never negative
  });
  it("estimateCostUsd uses Flash input/output rates", () => {
    // 1M input + 1M output = $0.30 + $2.50 = $2.80
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBe(2.8);
    expect(estimateCostUsd(0, 0)).toBe(0);
  });
  it("periodStartMs: today = UTC midnight, week/month roll back", () => {
    const now = Date.parse("2026-06-15T18:30:00.000Z");
    expect(new Date(periodStartMs("today", now)).toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(periodStartMs("week", now)).toBe(now - 7 * 86_400_000);
    expect(periodStartMs("month", now)).toBe(now - 30 * 86_400_000);
  });
});
