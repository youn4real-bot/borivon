import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { telegramSilencedWorker, type SilenceEnv } from "@/lib/cronSilence";

/**
 * The cron-failure alert honours the founder's Telegram silence. After the flip
 * the toggle is saved in D1, so the Worker must read it there — reading Supabase
 * would answer the value from before the flip forever. On any doubt: silent.
 */

function d1Binding(answer: () => unknown) {
  const seen: { sql: string; params: unknown[] }[] = [];
  const binding = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          seen.push({ sql, params });
          return { first: async <T,>() => answer() as T | null };
        },
      };
    },
  };
  return { seen, binding };
}

function supabaseFetch(rows: unknown, status = 200) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(rows), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, f };
}

const SB = { NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };

describe("telegramSilencedWorker", () => {
  it("on d1: reads the flag from D1 and never asks Supabase", async () => {
    const sb = supabaseFetch([{ value: "off" }]);
    const on = d1Binding(() => ({ value: "on" }));
    expect(await telegramSilencedWorker({ ...SB, DATA_BACKEND: "d1", BORIVON_DB: on.binding }, sb.f)).toBe(true);
    expect(on.seen).toEqual([{ sql: `SELECT "value" FROM "app_settings" WHERE "key" = ?`, params: ["telegram_silenced"] }]);
    const off = d1Binding(() => ({ value: "off" }));
    expect(await telegramSilencedWorker({ ...SB, DATA_BACKEND: "d1", BORIVON_DB: off.binding }, sb.f)).toBe(false);
    const unset = d1Binding(() => null);
    expect(await telegramSilencedWorker({ ...SB, DATA_BACKEND: "d1", BORIVON_DB: unset.binding }, sb.f)).toBe(false);
    expect(sb.calls).toEqual([]);
  });

  it("on d1: fails closed when D1 cannot be read", async () => {
    const broken = d1Binding(() => { throw new Error("D1_ERROR"); });
    expect(await telegramSilencedWorker({ DATA_BACKEND: "d1", BORIVON_DB: broken.binding })).toBe(true);
    expect(await telegramSilencedWorker({ DATA_BACKEND: "d1" } as SilenceEnv)).toBe(true);
  });

  it("on supabase (the default): reads Supabase as before, failing closed", async () => {
    const on = supabaseFetch([{ value: "on" }]);
    expect(await telegramSilencedWorker({ ...SB }, on.f)).toBe(true);
    expect(on.calls).toEqual(["https://p.supabase.co/rest/v1/app_settings?key=eq.telegram_silenced&select=value"]);
    expect(await telegramSilencedWorker({ ...SB, DATA_BACKEND: "supabase" }, supabaseFetch([]).f)).toBe(false);
    expect(await telegramSilencedWorker({ ...SB }, supabaseFetch({}, 500).f)).toBe(true);
    expect(await telegramSilencedWorker({})).toBe(true);
  });

  it("is what cf-worker.ts uses — no raw Supabase data read is left in the Worker", () => {
    const src = fs.readFileSync("cf-worker.ts", "utf8");
    expect(src).toContain('import { telegramSilencedWorker } from "./lib/cronSilence";');
    expect(src).not.toMatch(/\/rest\/v1\//);
  });
});
