import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Mock the Supabase service client so we control the rl_hit() RPC result.
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => ({ rpc: (...a: unknown[]) => h.rpc(...a) }),
}));

import { enforceRateLimit, enforceUserRateLimit, requestIp } from "../lib/rateLimit";

const reqWith = (headers: Record<string, string>): NextRequest =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as unknown as NextRequest);

beforeEach(() => h.rpc.mockReset());

describe("enforceRateLimit (in-process, IP-keyed)", () => {
  it("allows up to the limit, then 429s with a Retry-After", () => {
    const req = reqWith({ "x-real-ip": "1.2.3.9" });
    const opts = { limit: 3, windowMs: 60_000 };
    expect(enforceRateLimit(req, "t-inproc", opts).ok).toBe(true);
    expect(enforceRateLimit(req, "t-inproc", opts).ok).toBe(true);
    expect(enforceRateLimit(req, "t-inproc", opts).ok).toBe(true);
    const blocked = enforceRateLimit(req, "t-inproc", opts);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("enforceUserRateLimit (Postgres-backed shared counter, per identity)", () => {
  it("denies once the shared counter exceeds the limit", async () => {
    h.rpc.mockResolvedValue({ data: [{ new_count: 11, reset_ms: Date.now() + 30_000 }], error: null });
    const r = await enforceUserRateLimit("gen", "u:user1", { limit: 10, windowMs: 60_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("allows while under the limit", async () => {
    h.rpc.mockResolvedValue({ data: [{ new_count: 2, reset_ms: Date.now() + 30_000 }], error: null });
    const r = await enforceUserRateLimit("gen", "u:user2", { limit: 10, windowMs: 60_000 });
    expect(r.ok).toBe(true);
  });

  it("FAILS OPEN to the in-process limiter when the RPC errors (table not migrated)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "function public.rl_hit does not exist" } });
    const r = await enforceUserRateLimit("gen-failopen", "u:user3", { limit: 5, windowMs: 60_000 });
    expect(r.ok).toBe(true); // fell back to in-process; first hit allowed (never breaks legit traffic)
  });
});

describe("requestIp (trusted IP extraction)", () => {
  it("prefers the un-spoofable x-vercel-forwarded-for", () => {
    expect(requestIp(reqWith({ "x-vercel-forwarded-for": "9.9.9.9, 1.1.1.1" }))).toBe("9.9.9.9");
  });
  it("falls back to x-real-ip", () => {
    expect(requestIp(reqWith({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
  });
  it("uses cf-connecting-ip on Cloudflare Workers (un-spoofable edge IP)", () => {
    expect(requestIp(reqWith({ "cf-connecting-ip": "7.7.7.7" }))).toBe("7.7.7.7");
  });
  it("prefers cf-connecting-ip over the client-influenceable x-forwarded-for", () => {
    expect(requestIp(reqWith({ "cf-connecting-ip": "7.7.7.7", "x-forwarded-for": "6.6.6.6, 5.5.5.5" }))).toBe("7.7.7.7");
  });
});
