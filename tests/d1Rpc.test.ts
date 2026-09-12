import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { callRpc, rpcName, isRpcError } from "../lib/d1/pgrest/rpc";
import type { D1Answer } from "../lib/d1/client";

/**
 * The database functions the portal calls. Two things must hold: the answer
 * has the shape the call sites already branch on, and the work happens in ONE
 * statement — D1 has no interactive transactions, and these functions exist
 * precisely because the operation must be atomic.
 */
function fakeRunner(rows: Record<string, unknown>[][] = [[]]) {
  const seen: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const run = async (sql: string, params: unknown[] = []): Promise<D1Answer> => {
    seen.push({ sql, params });
    return { results: rows[Math.min(i++, rows.length - 1)] ?? [], meta: {} };
  };
  return { run, seen };
}

describe("rpcName", () => {
  it("recognises an rpc call and ignores a table read", () => {
    expect(rpcName("https://x.supabase.co/rest/v1/rpc/rl_hit")).toBe("rl_hit");
    expect(rpcName("https://x.supabase.co/rest/v1/documents?select=id")).toBeNull();
  });
});

describe("rl_hit", () => {
  it("counts inside the window and says when it resets", async () => {
    const { run, seen } = fakeRunner([[{ count: 7 }]]);
    const out = await callRpc("rl_hit", { p_key: "ip:1.2.3.4|book", p_window_ms: 60_000, p_now_ms: 1_800_000_123 }, run);
    expect(isRpcError(out)).toBe(false);
    if (isRpcError(out)) return;
    expect(out.body).toEqual([{ new_count: 7, reset_ms: 1_800_060_000 }]);
    // window_start is floored to the window, exactly as the plpgsql does
    expect(seen.at(-1)!.params).toEqual(["ip:1.2.3.4|book", 1_800_000_000]);
    // one statement does the insert-or-increment AND returns the new count
    expect(seen.at(-1)!.sql).toMatch(/ON CONFLICT[\s\S]*DO UPDATE[\s\S]*RETURNING/i);
  });

  it("refuses a nonsense window instead of dividing by zero", async () => {
    const { run } = fakeRunner();
    const out = await callRpc("rl_hit", { p_key: "k", p_window_ms: 0, p_now_ms: 1 }, run);
    expect(isRpcError(out) && out.status).toBe(400);
  });
});

describe("claim_upload_key", () => {
  it("returns the new array when the key was claimed", async () => {
    const { run, seen } = fakeRunner([[{ uploaded_keys: '["passport","diploma"]' }]]);
    const out = await callRpc("claim_upload_key", { p_link_id: "L1", p_key: "diploma" }, run);
    if (isRpcError(out)) throw new Error("unexpected error");
    expect(out.body).toEqual(["passport", "diploma"]);
    // the guard against a double claim is part of the same UPDATE
    expect(seen[0].sql).toMatch(/UPDATE[\s\S]*NOT EXISTS[\s\S]*RETURNING/i);
    expect(seen[0].sql).toMatch(/used_at" IS NULL[\s\S]*revoked_at" IS NULL/);
  });

  it("returns null when nothing was claimed", async () => {
    const { run } = fakeRunner([[]]);
    const out = await callRpc("claim_upload_key", { p_link_id: "L1", p_key: "diploma" }, run);
    if (isRpcError(out)) throw new Error("unexpected error");
    expect(out.body).toBeNull();
  });
});

describe("release_upload_key", () => {
  it("removes one key and answers 204", async () => {
    const { run, seen } = fakeRunner();
    const out = await callRpc("release_upload_key", { p_link_id: "L1", p_key: "diploma" }, run);
    if (isRpcError(out)) throw new Error("unexpected error");
    expect(out.status).toBe(204);
    expect(seen[0].sql).toMatch(/json_each[\s\S]*<> \?/);
    expect(seen[0].sql).not.toMatch(/DELETE/i);
  });
});

describe("functions that belong to the auth move", () => {
  it.each(["app_delete_user", "admin_force_logout", "made_up_function"])("%s answers PGRST202, the way a missing function does", async (name) => {
    const { run } = fakeRunner();
    const out = await callRpc(name, {}, run);
    expect(isRpcError(out)).toBe(true);
    if (!isRpcError(out)) return;
    expect(out.code).toBe("PGRST202");
    expect(out.status).toBe(404);
  });
});

/**
 * End to end against the real D1 copy: the counter really increments, and a
 * second claim of the same key really does nothing. Everything created is
 * removed again so the copy still matches Supabase row for row.
 *
 *   RUN_D1_PARITY=1 npx vitest run tests/d1Rpc.test.ts
 */
const ENABLED = process.env.RUN_D1_PARITY === "1";
const LINK_ID = "00000000-0000-4000-8000-0000000000rp".replace(/[^0-9a-f-]/g, "0");
let db: SupabaseClient;

describe.skipIf(!ENABLED)("the functions against the real copy", () => {
  beforeAll(async () => {
    for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i < 1 || line.startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
    process.env.D1_DATABASE_ID ??= "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";
    const { getD1 } = await import("../lib/d1/client");
    const { makeBvFetch } = await import("../lib/d1/bvFetch");
    const runner = await getD1();
    if (!runner) throw new Error("no D1 runner — refusing to run");
    db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      global: {
        fetch: makeBvFetch({
          runner,
          passthrough: (async () => { throw new Error("blocked: this test must never reach Supabase") }) as unknown as typeof fetch,
        }),
      },
    });
    await db.from("upload_links").insert({
      id: LINK_ID,
      token_hash: crypto.randomBytes(16).toString("hex"),
      candidate_user_id: "00000000-0000-4000-8000-00000000d1d1",
      doc_keys: ["passport"],
      uploaded_keys: [],
    });
  });

  afterAll(async () => {
    if (db) await db.from("upload_links").delete().eq("id", LINK_ID);
  });

  it("rl_hit increments the same bucket", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const first = await db.rpc("rl_hit", { p_key: key, p_window_ms: 60_000, p_now_ms: Date.now() });
    const second = await db.rpc("rl_hit", { p_key: key, p_window_ms: 60_000, p_now_ms: Date.now() });
    expect(first.error).toBeNull();
    expect((first.data as { new_count: number }[])[0].new_count).toBe(1);
    expect((second.data as { new_count: number }[])[0].new_count).toBe(2);
    expect((second.data as { reset_ms: number }[])[0].reset_ms).toBeGreaterThan(Date.now() - 60_000);
  });

  it("claim_upload_key claims once and only once, and release takes it back", async () => {
    const claim = await db.rpc("claim_upload_key", { p_link_id: LINK_ID, p_key: "passport" });
    expect(claim.error).toBeNull();
    expect(claim.data).toEqual(["passport"]);

    const again = await db.rpc("claim_upload_key", { p_link_id: LINK_ID, p_key: "passport" });
    expect(again.error).toBeNull();
    expect(again.data).toBeNull();                       // already claimed → no-op

    const release = await db.rpc("release_upload_key", { p_link_id: LINK_ID, p_key: "passport" });
    expect(release.error).toBeNull();
    const after = await db.from("upload_links").select("uploaded_keys").eq("id", LINK_ID).single();
    expect(after.data!.uploaded_keys).toEqual([]);
  });
});
