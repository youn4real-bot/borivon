import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withWriteFreeze } from "@/lib/d1/serviceFetch";

/**
 * A lead that arrives during the write freeze. The copy must stay exact (no
 * database write), and the lead must not be lost: the founder is told on
 * Telegram at once, and the answer is the freeze's 503 so the funnel keeps the
 * lead and re-sends it on the visitor's next visit.
 */

const SB = "https://p.supabase.co";
const net: string[] = [];
let frozen = true;
let dupRows: unknown[] = [];

const telegram: string[] = [];
vi.mock("@/lib/telegram", () => ({ tgSend: async (_chat: string, text: string) => { telegram.push(text); } }));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimitDistributed: async () => ({ ok: true, retryAfterSec: 0 }) }));
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => {
    const supabase = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      net.push(`${method} ${String(input).replace(SB, "").split("?")[0]}`);
      if (method === "GET") return new Response(JSON.stringify(dupRows), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    return createClient(SB, "service", { auth: { persistSession: false }, global: { fetch: frozen ? withWriteFreeze(supabase) : supabase } });
  },
}));

const { POST } = await import("@/app/api/leads/route");

function lead(body: Record<string, unknown>) {
  return new NextRequest("https://www.borivon.com/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "accept-language": "de-DE,de;q=0.9" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  net.length = 0;
  telegram.length = 0;
  dupRows = [];
  vi.stubEnv("TELEGRAM_CHAT_ID", "42");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("/api/leads during the write freeze", () => {
  it("writes nothing, tells the founder, and answers the freeze's 503 so the funnel keeps the lead", async () => {
    frozen = true;
    const res = await POST(lead({ kind: "person", email: "nurse@example.ma", name: "Amina", phone: "+212600000000" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("maintenance");
    expect(body.error).toContain("Wartungsarbeiten");
    expect(net).toEqual(["GET /rest/v1/leads"]);                     // the dedupe read only; the insert never left
    expect(telegram).toHaveLength(1);
    expect(telegram[0]).toContain("Maintenance : pas encore enregistré dans le portail");
    expect(telegram[0]).toContain("nurse@example.ma");
  });

  it("a correction to a lead from the last hour is forwarded the same way", async () => {
    frozen = true;
    dupRows = [{ id: "11111111-1111-4111-8111-111111111111" }];
    const res = await POST(lead({ kind: "person", email: "nurse@example.ma", phone: "+212611111111" }));
    expect(res.status).toBe(503);
    expect(net).toEqual(["GET /rest/v1/leads"]);
    expect(telegram).toHaveLength(1);
    expect(telegram[0]).toContain("+212611111111");
  });

  it("with the freeze off, nothing changes: saved, pinged once, ok", async () => {
    frozen = false;
    const res = await POST(lead({ kind: "person", email: "nurse@example.ma", name: "Amina" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(net).toEqual(["GET /rest/v1/leads", "POST /rest/v1/leads"]);
    expect(telegram).toHaveLength(1);
    expect(telegram[0]).not.toContain("Maintenance");
  });
});
