import { describe, it, expect, afterAll } from "vitest";
import { download } from "../storage/verify-r2-copy.mjs";
import { fetchLiveOpenApi } from "../d1/check-drift.mjs";
import { SWITCH_VARS, varEdit, varNotes, dropNewerTables, importArgs, DROP_NEWER_FLAG } from "../d1/cutover.mjs";

/**
 * The scripts the founder runs on switch night, with the site frozen and a
 * clock on him. Each test here is a rehearsal finding: a message that named the
 * wrong cause, a list that had drifted, a refusal with no documented way past.
 */

const res = (status: number, body: string, ok = status < 400) =>
  ({ ok, status, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer }) as unknown as Response;

describe("verify-r2-copy: a failed download is not a mismatch", () => {
  it("names the side and the status when a download fails", async () => {
    const r = await download("https://x/obj", {}, "r2", "documents/a.pdf", async () => res(404, '{"message":"Object not found"}'));
    expect(r.ok).toBe(false);
    expect(r.why).toContain("DOWNLOAD FAILED (r2)");
    expect(r.why).toContain("404");
    expect(r.why).toContain("Object not found");   // the body says WHICH failure it is
    expect(r.why).not.toContain("CONTENT");        // never reported as "the bytes differ"
  });

  it("reports a network error as a failed download too", async () => {
    const r = await download("https://x/obj", {}, "supabase", "k", async () => { throw new Error("fetch failed"); });
    expect(r.ok).toBe(false);
    expect(r.why).toContain("DOWNLOAD FAILED (supabase)");
    expect(r.why).toContain("fetch failed");
  });

  it("returns the bytes when the download really worked", async () => {
    const r = await download("https://x/obj", {}, "supabase", "k", async () => res(200, "hello"));
    expect(r.ok).toBe(true);
    expect(r.bytes?.toString()).toBe("hello");
  });

  it("no longer lets two identical error pages count as 'identical'", async () => {
    // The dangerous half of the old bug: both sides answering the same error
    // hashed the same and were counted a match. Now neither side is hashed.
    const both = await Promise.all(["supabase", "r2"].map((side) =>
      download("https://x/obj", {}, side, "k", async () => res(503, "upstream unavailable"))));
    expect(both.every((d) => !d.ok)).toBe(true);
  });
});

describe("check-drift: the refusal says why", () => {
  // These stub the global fetch; put it back so nothing after them inherits it.
  const realFetch = globalThis.fetch;
  afterAll(() => { globalThis.fetch = realFetch; });
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key-value" };

  it("carries Supabase's own explanation, not a bare status", async () => {
    globalThis.fetch = (async () => res(401, '{"message":"Invalid API key","hint":"Double check your key"}')) as typeof fetch;
    await expect(fetchLiveOpenApi(env)).rejects.toThrow(/HTTP 401[\s\S]*Invalid API key/);
  });

  it("says so when the body is empty, and never prints the key it sent", async () => {
    globalThis.fetch = (async () => res(503, "")) as typeof fetch;
    await expect(fetchLiveOpenApi(env)).rejects.toThrow(/HTTP 503 — \(empty body\)/);
    globalThis.fetch = (async () => res(401, "rejected")) as typeof fetch;
    const err = await fetchLiveOpenApi({ ...env, SUPABASE_SERVICE_ROLE_KEY: "s3cr3t-not-echoed" }).catch((e: Error) => e);
    expect((err as Error).message).toContain("HTTP 401");
    expect((err as Error).message).not.toContain("s3cr3t-not-echoed");
  });
});

describe("cutover: both var lists come from one table", () => {
  it("prints STORAGE_BACKEND in the flip AND the flip-back", () => {
    // The rehearsal bug: the flip-back line was hand-written and omitted it, so
    // rolling back would have left every file on R2 with the database back on
    // Supabase. One table, two directions — they cannot drift apart.
    for (const dir of ["flip", "back"] as const) expect(varEdit(dir)).toContain("STORAGE_BACKEND");
    expect(varEdit("flip")).toContain('"DATA_BACKEND": "d1"');
    expect(varEdit("back")).toContain('"DATA_BACKEND": "supabase"');
    expect(varEdit("flip")).toContain('"STORAGE_BACKEND": "r2"');
    expect(varEdit("back")).toContain('"STORAGE_BACKEND": "supabase"');
    for (const v of SWITCH_VARS) for (const dir of ["flip", "back"] as const) expect(varEdit(dir)).toContain(v.name);
  });

  it("warns, in both directions, that the key is never deleted", () => {
    expect(varNotes("flip").join(" ")).toMatch(/ADD the key/);
    expect(varNotes("back").join(" ")).toMatch(/do NOT delete/);
  });
});

describe("cutover: the way past 'D1 holds rows newer than the export'", () => {
  it("passes the named tables through to the import", () => {
    expect(dropNewerTables([".", `${DROP_NEWER_FLAG}=leads,notifications`])).toEqual(["leads", "notifications"]);
    expect(dropNewerTables([".", DROP_NEWER_FLAG, "leads"])).toEqual(["leads"]);
    expect(importArgs("/repo", "/out", ["leads"])).toEqual(["/repo", "/out", "--accept-newer-in=leads"]);
    // Nothing named → the import runs exactly as it did before.
    expect(importArgs("/repo", "/out", [])).toEqual(["/repo", "/out"]);
    expect(dropNewerTables([".", "--rollback"])).toEqual([]);
  });

  it("refuses the flag with nothing to drop, rather than reading it as 'no tables'", () => {
    // Silently meaning "none" would let the import refuse a second time with the
    // operator certain they had already answered it.
    expect(() => dropNewerTables([".", DROP_NEWER_FLAG])).toThrow(/needs the tables/);
    expect(() => dropNewerTables([".", `${DROP_NEWER_FLAG}=`])).toThrow(/needs the tables/);
    expect(() => dropNewerTables([".", DROP_NEWER_FLAG, "--i-mean-it"])).toThrow(/needs the tables/);
  });
});
