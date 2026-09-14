/**
 * Which database answers the service client — the one-flip switch.
 *
 * DATA_BACKEND (a wrangler var) is "supabase" by default. Set to exactly "d1",
 * lib/supabase.ts's service client answers every PostgREST request (/rest/v1
 * reads, writes and RPC) from the D1 copy; auth, storage and realtime keep going
 * to Supabase. Rolling back is setting it back to "supabase" and replaying the
 * write journal (d1/replay-journal.mjs, docs/cutover-runbook.md).
 *
 * Pure and tiny ON PURPOSE: lib/supabase.ts is in the browser bundle, so this
 * file must never import the adapter. The heavy composition lives in
 * lib/d1/serviceFetch.ts and is loaded dynamically, server-side only.
 */
import { writesFrozen } from "@/lib/maintenance";

export type DataBackend = "supabase" | "d1";

type Env = Record<string, string | undefined>;

/**
 * Anything but exactly "d1" is Supabase. A typo ("D1", "d1 ") must fail toward
 * the backend that has been serving the site for years, never toward the new one.
 */
export function dataBackend(env: Env = process.env): DataBackend {
  return env.DATA_BACKEND === "d1" ? "d1" : "supabase";
}

export type ServicePlan = {
  backend: DataBackend;
  /** Shadow reads against D1 — only meaningful while Supabase is the backend. */
  shadow: boolean;
  /** MAINTENANCE_WRITES="1": refuse data writes at the client too (see lib/maintenance.ts). */
  freeze: boolean;
};

function shadowOn(env: Env): boolean {
  const raw = Number(env.SHADOW_D1_RATE ?? "0");
  return Number.isFinite(raw) && raw > 0;
}

/**
 * What the service client's fetch has to be, or null for "plain fetch" —
 * which is exactly today's live behaviour with every flag at its default, so
 * merging this changes nothing until a var is flipped.
 *
 * Shadow reads are skipped on D1: they compare Supabase's answer with D1's, and
 * once D1 IS the answer there is nothing to compare against — it would just be
 * D1 checking itself at extra cost.
 */
export function servicePlan(env: Env = process.env, isBrowser = typeof window !== "undefined"): ServicePlan | null {
  // The browser never gets the service client's fetch: the anon `supabase`
  // client is the only one a component can use, and the adapter (with its
  // server-only D1 binding) must never reach the client bundle.
  if (isBrowser) return null;
  const backend = dataBackend(env);
  const plan: ServicePlan = {
    backend,
    shadow: backend === "supabase" && shadowOn(env),
    freeze: writesFrozen(env),
  };
  return plan.backend === "supabase" && !plan.shadow && !plan.freeze ? null : plan;
}
