import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Feature-level parity: run REAL portal features against Supabase and against
 * the D1 copy through the adapter, and demand the same answer.
 *
 * The query-level test proves individual calls; this proves whole features —
 * dozens of chained queries, joins done in JS, schema-tolerant fallbacks and
 * all. If the adapter got a filter, a null, a boolean or an ordering subtly
 * wrong, the feature output diverges here even when every single query looked
 * fine.
 *
 * READ-ONLY: only compute* functions, which never write. Auth lookups pass
 * through to Supabase in both runs (the adapter only answers /rest/v1).
 *
 * Skipped unless RUN_D1_PARITY=1:
 *   RUN_D1_PARITY=1 npx vitest run tests/d1FeatureParity.test.ts
 */
const ENABLED = process.env.RUN_D1_PARITY === "1";

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  process.env.D1_DATABASE_ID ??= "ffb9dcff-a501-4dc2-a94a-e5301e2595f0";
}

/** A frozen "now" so anything time-based is identical in both runs. */
const NOW = Date.UTC(2026, 8, 12, 9, 0, 0);

async function clientFor(useD1: boolean): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!useD1) return createClient(url, key);
  const { makeBvFetch } = await import("../lib/d1/bvFetch");
  return createClient(url, key, { global: { fetch: makeBvFetch() } });
}

/** Load a module with lib/supabase swapped for a client of our choosing. */
async function withBackend<T>(useD1: boolean, run: () => Promise<T>): Promise<T> {
  const client = await clientFor(useD1);
  vi.resetModules();
  vi.doMock("@/lib/supabase", () => ({
    supabase: client,
    getServiceSupabase: () => client,
    getAnonVerifyClient: () => client,
    getAuthSchemaClient: () => client,
  }));
  try {
    return await run();
  } finally {
    vi.doUnmock("@/lib/supabase");
  }
}

describe.skipIf(!ENABLED)("features answer the same on both backends", () => {
  it("chase list (who needs chasing, and why)", async () => {
    loadEnv();
    const viaD1 = await withBackend(true, async () => (await import("@/lib/chaseList")).computeChaseList(NOW));
    const viaSupabase = await withBackend(false, async () => (await import("@/lib/chaseList")).computeChaseList(NOW));
    expect(viaD1).toEqual(viaSupabase);
    expect(viaSupabase.length).toBeGreaterThan(0); // a feature returning nothing would compare equal for the wrong reason
  }, 300_000);

  it("document reminders (who would be emailed, and about what)", async () => {
    loadEnv();
    const strip = (r: { due: unknown[]; ok: boolean; tableReady: boolean }) => ({ ok: r.ok, tableReady: r.tableReady, due: r.due });
    const viaD1 = await withBackend(true, async () => strip(await (await import("@/lib/docRemindersRun")).computeDueReminders(NOW)));
    const viaSupabase = await withBackend(false, async () => strip(await (await import("@/lib/docRemindersRun")).computeDueReminders(NOW)));
    expect(viaD1).toEqual(viaSupabase);
  }, 300_000);

  it("candidate search universe (every facet the admin filters on)", async () => {
    loadEnv();
    const scope = { role: "admin" as const, email: process.env.ADMIN_EMAIL ?? "", userId: "", visibleIds: null };
    const viaD1 = await withBackend(true, async () => (await import("@/lib/candidateSearchData")).assembleSearchableCandidates(scope));
    const viaSupabase = await withBackend(false, async () => (await import("@/lib/candidateSearchData")).assembleSearchableCandidates(scope));
    expect(viaD1).toEqual(viaSupabase);
    expect(viaSupabase.length).toBeGreaterThan(0);
  }, 300_000);

  it("stuck candidates (the auto-chase signal)", async () => {
    loadEnv();
    const viaD1 = await withBackend(true, async () => (await import("@/lib/autoChase")).computeStuckCandidates({ includeRejectedDocs: true }));
    const viaSupabase = await withBackend(false, async () => (await import("@/lib/autoChase")).computeStuckCandidates({ includeRejectedDocs: true }));
    expect(viaD1).toEqual(viaSupabase);
  }, 300_000);
});
