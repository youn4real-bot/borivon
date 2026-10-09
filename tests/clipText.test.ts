import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { clipText } from "@/lib/clipText";
import { cleanPublicText } from "@/lib/sanitizeInput";

/**
 * A length cap must never cut an emoji in half. `.slice(0, n)` counts UTF-16
 * units, so an emoji across the limit left a lone surrogate, Postgres' JSON
 * lexer (and the D1 adapter) refused the INSERT with 22P02, and the public lead
 * form answered 500 with the lead lost.
 */

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("clipText", () => {
  it("never ends on half an emoji", () => {
    const s = "a".repeat(9) + "😀"; // the emoji is units 9-10
    expect(clipText(s, 10)).toBe("a".repeat(9));
    expect(clipText(s, 11)).toBe(s);
    expect(LONE.test(clipText(s, 10))).toBe(false);
  });

  it("keeps the old limit and behaviour for plain text", () => {
    expect(clipText("hello world", 5)).toBe("hello");
    expect(clipText("short", 120)).toBe("short");
    expect(clipText("", 3)).toBe("");
  });

  it("drops a lone surrogate that arrived in the input", () => {
    expect(clipText("x\uD83Dy", 10)).toBe("xy");
    expect(clipText("x\uDE00", 10)).toBe("x");
    expect(clipText("ok 😀", 10)).toBe("ok 😀");
  });

  it("cleanPublicText (online-course form, self-report, nudge) is safe at the limit too", () => {
    expect(LONE.test(cleanPublicText("b".repeat(119) + "🙂", 120))).toBe(false);
  });
});

/* ── the public lead form, against a fake PostgREST that refuses what Postgres refuses ── */

const SB = "https://p.supabase.co";
const writes: { status: number; body: string }[] = [];
vi.mock("@/lib/telegram", () => ({ tgSend: async () => {} }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimitDistributed: async () => ({ ok: true, retryAfterSec: 0 }) }));
vi.mock("@/lib/outboundEmail", () => ({ sendOutboundEmail: async () => ({ ok: false, error: "off" }) }));
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => {
    const pg = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      const body = String(init?.body ?? "");
      // JSON.stringify escapes a lone surrogate as \udXXX; a well-formed pair is sent raw.
      if (/\\ud[89a-f][0-9a-f]{2}/i.test(body)) {
        writes.push({ status: 400, body });
        return new Response(JSON.stringify({ code: "22P02", details: "Unicode low surrogate must follow a high surrogate.", hint: null, message: "invalid input syntax for type json" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      writes.push({ status: 201, body });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    return createClient(SB, "service", { auth: { persistSession: false }, global: { fetch: pg } });
  },
}));

const post = (path: string, body: unknown) => new NextRequest(`https://www.borivon.com${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("public lead forms with an emoji at the length limit", () => {
  beforeEach(() => { writes.length = 0; vi.stubEnv("TELEGRAM_CHAT_ID", ""); vi.stubEnv("ADMIN_EMAIL", ""); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("/api/leads stores the lead instead of answering 500", async () => {
    const { POST } = await import("@/app/api/leads/route");
    const res = await POST(post("/api/leads", { kind: "person", email: "nurse@example.ma", name: "x".repeat(119) + "😀", message: "m".repeat(999) + "🙏" }));
    expect(res.status).toBe(200);
    expect(writes.map((w) => w.status)).toEqual([201]);
  });

  it("/api/v2/contact stores the enterprise lead", async () => {
    const { POST } = await import("@/app/api/v2/contact/route");
    const res = await POST(post("/api/v2/contact", { name: "n", email: "a@b.co", company: "c".repeat(159) + "🏥", message: "hi" }));
    expect(res.status).toBe(200);
    expect(writes.map((w) => w.status)).toEqual([201]);
  });
});
