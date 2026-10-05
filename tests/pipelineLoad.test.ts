import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchMyPipeline } from "../lib/pipelineLoad";

/**
 * A DROPPED READ MUST NOT RE-LOCK A STAGE THE ADMIN UNLOCKED.
 *
 * A candidate whose Visum or interview stage the founder had explicitly opened
 * tapped it and was told it was shut. /api/portal/pipeline/me
 * answered a 401 with `{ pipeline: null }` — byte-for-byte what a candidate
 * with no pipeline row gets — and the dashboard bootstrap never looked at the
 * status. An hour-old JWT was therefore enough to make every stage look shut.
 * LAW #31/#32: that lock is the supreme admin's discretion alone, so the
 * network silently overruling it is the bug.
 *
 * Two halves, one per side of the wire: the route must not SAY "no pipeline"
 * when it means "I could not tell you", and the loader must not READ a failure
 * as an answer.
 */

type Pipeline = { embassy_unlocked: boolean; recognition_unlocked: boolean };

const UNLOCKED: Pipeline = { embassy_unlocked: true, recognition_unlocked: false };

/** One scripted answer for the single URL this loader ever calls. */
function scriptedFetch(answer:
  | { status: number; body?: unknown }
  | "reject"
  | "badjson"
  | "stall",
) {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (answer === "reject") throw new TypeError("Failed to fetch");
    if (answer === "stall") {
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("The operation was aborted")));
      });
    }
    if (answer === "badjson") {
      return { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response;
    }
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body ?? {},
    } as Response;
  }) as unknown as typeof fetch;
}

describe("fetchMyPipeline — 'no pipeline' and 'I could not find out' are different answers", () => {
  it("a real row comes back as a known value", async () => {
    const res = await fetchMyPipeline<Pipeline>(scriptedFetch({ status: 200, body: { pipeline: UNLOCKED } }), "jwt");
    expect(res).toEqual({ ok: true, pipeline: UNLOCKED });
  });

  it("a 200 with pipeline:null is a KNOWN absence — she really has no row yet", async () => {
    const res = await fetchMyPipeline<Pipeline>(scriptedFetch({ status: 200, body: { pipeline: null } }), "jwt");
    expect(res).toEqual({ ok: true, pipeline: null });
  });

  it("THE BUG: a 401 is a failure, never 'she has no pipeline'", async () => {
    // Even if a future route regressed and put the old body back, the status
    // alone decides — this is the shape that showed the upgrade box.
    const res = await fetchMyPipeline<Pipeline>(scriptedFetch({ status: 401, body: { pipeline: null } }), "jwt");
    expect(res).toEqual({ ok: false, status: 401 });
  });

  it("a 429 (rate limited) and a 500 (db error) are failures too", async () => {
    expect(await fetchMyPipeline<Pipeline>(scriptedFetch({ status: 429, body: { error: "Too many requests" } }), "jwt"))
      .toEqual({ ok: false, status: 429 });
    expect(await fetchMyPipeline<Pipeline>(scriptedFetch({ status: 500, body: { error: "pipeline_read_failed" } }), "jwt"))
      .toEqual({ ok: false, status: 500 });
  });

  it("a 200 whose body has no `pipeline` key is a broken read, not an empty one", async () => {
    expect(await fetchMyPipeline<Pipeline>(scriptedFetch({ status: 200, body: { error: "nope" } }), "jwt"))
      .toEqual({ ok: false, status: 200 });
  });

  it("a 200 that will not parse (an HTML error page) is a broken read", async () => {
    expect(await fetchMyPipeline<Pipeline>(scriptedFetch("badjson"), "jwt")).toEqual({ ok: false, status: 200 });
  });

  it("an offline fetch is a failure with no status", async () => {
    expect(await fetchMyPipeline<Pipeline>(scriptedFetch("reject"), "jwt")).toEqual({ ok: false, status: null });
  });

  it("a stalled read aborts on its deadline instead of parking the bootstrap", async () => {
    expect(await fetchMyPipeline<Pipeline>(scriptedFetch("stall"), "jwt", 10)).toEqual({ ok: false, status: null });
  });

  it("no token is not knowing either — it must never read as 'nothing unlocked'", async () => {
    expect(await fetchMyPipeline<Pipeline>(scriptedFetch({ status: 200, body: { pipeline: UNLOCKED } }), ""))
      .toEqual({ ok: false, status: null });
  });
});

/** Read a file with comments blanked, preserving offsets — every fix here is
 *  commented with the broken line it replaces, so scanning raw text would
 *  match the explanation rather than the code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const ROUTE = code("app/api/portal/pipeline/me/route.ts");
const DASH  = code("app/portal/dashboard/page.tsx");

describe("the route side — an error body never carries a `pipeline` key", () => {
  it("THE BUG: the 401 no longer answers with the same body as 'no pipeline yet'", () => {
    // Every NextResponse.json that goes out with a non-2xx status.
    const errorBodies = [...ROUTE.matchAll(/NextResponse\.json\(\s*(\{[^}]*\})\s*,\s*\{\s*status:\s*(\d{3})/g)]
      .filter(m => Number(m[2]) >= 400)
      .map(m => m[1]);
    expect(errorBodies.length).toBeGreaterThanOrEqual(3); // 401 x2, 429, 500
    // A `pipeline` KEY is what made a 401 read as "she has no pipeline".
    // (An error *code* may well be named pipeline_read_failed — that is a
    // value under `error`, and the client never mistakes it for an answer.)
    for (const body of errorBodies) expect(body).not.toMatch(/\bpipeline\s*:/);
  });

  it("the only body carrying `pipeline` is the one that actually read the row", () => {
    expect(ROUTE).toMatch(/return NextResponse\.json\(\{ pipeline: data \?\? null \}\)/);
  });
});

describe("the dashboard side — it refuses to downgrade her view on an unknown", () => {
  it("THE BUG: the bootstrap no longer folds every failure into pipeline = null", () => {
    // The old shape: `.then(r => r.json()).then(({ pipeline: p }) => setPipeline(p ?? null))`
    expect(DASH).not.toMatch(/\.then\(\s*\(\{\s*pipeline:/);
    expect(DASH).toMatch(/fetchMyPipeline<Pipeline>\(fetch, token\)/);
    // A failed read leaves what is on screen alone. `return false` and not a
    // bare `return`: loadPipeline now reports the verdict to the live poll that
    // replaced the Realtime channel, so a dropped read backs that loop off
    // instead of passing for a healthy tick. It must still return BEFORE any
    // setPipeline — that is the part LAW #31/#32 rests on.
    expect(DASH).toMatch(/if \(!res\.ok\) \{[\s\S]{0,400}?setPipelineLoadFailed\(true\);[\s\S]{0,80}?return false;/);
  });

  it("the stage gate will not bounce her out of a stage while the pipeline is unknown", () => {
    expect(DASH).toMatch(/viewMode !== "docs" && pipelineKnown/);
  });

  it("tapping a stage on an unknown says so instead of calling it locked", () => {
    expect(DASH).toMatch(/setUpgradeReason\(pipelineKnown \? "locked" : "unknown"\)/);
    // And the modal really has a second sentence for it (LAW #19: all three).
    expect(DASH).toMatch(/upgradeReason === "unknown"/);
    expect(DASH).toContain("We couldn't check which stages are open for you right now.");
    expect(DASH).toContain("Wir konnten gerade nicht prüfen, welche Phasen für Sie freigeschaltet sind.");
    expect(DASH).toContain("Nous n'avons pas pu vérifier quelles étapes vous sont ouvertes.");
  });

  it("the journey view is not hidden from her while we do not know", () => {
    expect(DASH).toMatch(/!pipelineKnown \|\| isAdminUnlocked\(viewMode, pipeline\)/);
  });

  // The paid plan was removed on 2026-09-20. The gate now rests on the admin's
  // unlock ALONE (LAW #31/#32) — if a purchasable bypass ever comes back into
  // this file, this is what notices.
  it("no purchasable bypass survives in the stage gate", () => {
    expect(DASH).not.toMatch(/hasPremium/);
    expect(DASH).not.toMatch(/payment_tier/);
  });
});
