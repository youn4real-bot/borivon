import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The Supabase keep-alive and login backup ride the 06:00 briefing cron. Two
 * ways that could quietly stop working: a skip (Telegram unconfigured, the bot
 * quiet, the briefing switched off) returning before the safety pass runs, or the
 * safety pass failing and taking the founder's briefing down with it.
 */

const h = vi.hoisted(() => ({ order: [] as string[], telegram: true }));

vi.mock("@/lib/supabaseFreePlanSafety", () => ({
  runSupabaseFreePlanSafety: vi.fn(async () => { h.order.push("safety"); return { keepAlive: "ok", backup: "written" }; }),
}));
vi.mock("@/lib/telegram", () => ({
  tgSend: vi.fn(async () => { h.order.push("briefing sent"); }),
  getAdminUserId: async () => "admin",
  telegramConfigured: () => h.telegram,
}));
vi.mock("@/lib/briefing", () => ({ computeBriefing: async () => ({ text: "today", count: 1 }) }));
vi.mock("@/lib/automationSettings", () => ({ isAutomationEnabled: async () => true }));
vi.mock("@/lib/botQuiet", () => ({ isBotQuiet: async () => false }));
vi.mock("@/lib/followupsRun", () => ({ runFollowupChase: async () => ({ sent: false }) }));
vi.mock("@/lib/reminderFire", () => ({ fireDueReminders: async () => ({ fired: 0 }) }));

import { GET } from "@/app/api/cron/briefing/route";
import { runSupabaseFreePlanSafety } from "@/lib/supabaseFreePlanSafety";

const req = (auth?: string) =>
  new Request("https://cron.internal/api/cron/briefing", { headers: auth ? { authorization: auth } : {} }) as unknown as NextRequest;

beforeEach(() => {
  h.order.length = 0;
  h.telegram = true;
  process.env.CRON_SECRET = "s3cret";
  process.env.TELEGRAM_CHAT_ID = "42";
  vi.mocked(runSupabaseFreePlanSafety).mockClear();
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.TELEGRAM_CHAT_ID;
});

describe("briefing cron carries the Supabase safety pass", () => {
  it("runs it first, and runs it even when Telegram is not configured", async () => {
    h.telegram = false;
    const res = await GET(req("Bearer s3cret"));
    expect(await res.json()).toEqual({ skipped: "telegram_not_configured" });
    expect(runSupabaseFreePlanSafety).toHaveBeenCalledTimes(1);

    h.telegram = true;
    h.order.length = 0;
    await GET(req("Bearer s3cret"));
    expect(h.order).toEqual(["safety", "briefing sent"]);
  });

  it("a failing safety pass does not cost the briefing", async () => {
    vi.mocked(runSupabaseFreePlanSafety).mockImplementationOnce(async () => { throw new Error("boom"); });
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: true });
    expect(h.order).toEqual(["briefing sent"]);
  });

  it("an unauthenticated caller cannot trigger a backup", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(403);
    expect(runSupabaseFreePlanSafety).not.toHaveBeenCalled();
  });
});
