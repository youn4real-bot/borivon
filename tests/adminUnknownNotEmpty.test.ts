import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

process.env.ADMIN_EMAIL = "admin@borivon.com";

/**
 * A FAILED READ IS NOT AN EMPTY SET.
 *
 * Bug 6 of the q3 admin audit, and the clearest case of the shape the audit
 * named: a read that fails into a blank, and the blank is then treated as the
 * truth.
 *
 * The founder types into the search bar, or opens Advanced Filters, and is told
 * -- calmly, in the product's own voice -- that nothing matches. The candidate
 * directory had not loaded. lib/candidateSearchData.ts walks Supabase auth to
 * learn who exists; when that walk failed it returned [], [] filtered to [],
 * and the panel rendered "0 candidates" over 93 nurses nothing had counted.
 * Every layer agreed, because on the wire a failed read and an empty roster
 * were the same response.
 *
 * The fix gives the set a way to say "I do not know"
 * (assembleSearchableCandidateSet), makes both routes answer 503 READ_FAILED
 * with matched/total NULL rather than 0, and gives both clients a distinct
 * unknown state carrying the only thing that can change it: a retry.
 *
 * The assembler is driven directly against a stubbed Supabase with a genuinely
 * failing auth walk. The routes and the two React components are checked by
 * shape -- this suite runs in plain Node with no jsdom -- the approach
 * tests/adminSilentAnswers.test.ts takes. Every assertion was mutation-checked:
 * reverting the fix fails it.
 */
// ── Supabase stub, shared by the behavioural blocks ────────────────────────
const h = vi.hoisted(() => ({
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  /** Error returned by auth.admin.listUsers, per page. null = fine. */
  listUsersError: null as unknown,
  /** Set true to make listUsers THROW instead of returning an error. */
  listUsersThrows: false,
  authUsers: [] as Array<{ id: string; email: string; user_metadata?: Record<string, unknown>; created_at?: string }>,
}));

vi.mock("@/lib/supabase", () => {
  const qb = (result: { data: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "or", "ilike", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte", "range", "contains", "insert", "update", "upsert", "delete"]) {
      b[m] = () => b;
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.single = () => Promise.resolve(result);
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return b;
  };
  return {
    getServiceSupabase: () => ({
      from: (t: string) => qb(h.tables[t] ?? { data: null, error: null }),
      auth: {
        admin: {
          listUsers: async ({ page }: { page: number; perPage: number }) => {
            if (h.listUsersThrows) throw new Error("network blip");
            if (h.listUsersError) return { data: { users: [] }, error: h.listUsersError };
            return { data: { users: page === 1 ? h.authUsers : [] }, error: null };
          },
        },
      },
    }),
    getAnonVerifyClient: () => ({ auth: { getUser: vi.fn() } }),
  };
});

import { assembleSearchableCandidateSet, assembleSearchableCandidates } from "../lib/candidateSearchData";
import type { AssistantScope } from "../lib/assistantScope";

const scopeAll = { visibleIds: null } as unknown as AssistantScope;

beforeEach(() => {
  h.tables = {};
  h.listUsersError = null;
  h.listUsersThrows = false;
  h.authUsers = [];
});

/** Read a file with comments blanked, preserving offsets — every fix here is
 *  commented with the failure it prevents, so scanning raw text would match the
 *  explanation instead of the code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

// ───────────────────────────────────────────────────────────────────────────
// BUG 6 — the candidate set knows whether it is a fact or a floor
// ───────────────────────────────────────────────────────────────────────────
describe("an unreadable candidate directory is unknown, not 'nobody'", () => {
  it("a completed walk that finds nobody is a TRUSTWORTHY empty", async () => {
    h.authUsers = [];
    const set = await assembleSearchableCandidateSet(scopeAll);
    expect(set.ok, "the read worked; there is genuinely no one").toBe(true);
    expect(set.candidates).toEqual([]);
  });

  it("an ERROR from the auth walk makes the set unknown", async () => {
    // The exact live failure: listUsers answers an error on page 1, the map
    // stays empty, and the old code returned [] — indistinguishable from the
    // case above, and then rendered as "no candidates match".
    h.listUsersError = { message: "auth service unavailable" };
    const set = await assembleSearchableCandidateSet(scopeAll);
    expect(set.ok, "a failed directory read must NOT report a clean empty set").toBe(false);
    if (!set.ok) expect(set.reason).toBe("directory_unavailable");
  });

  it("a THROWN auth walk makes the set unknown too", async () => {
    // supabase-js re-throws non-AuthError failures (a network blip), which the
    // assembler catches. Catching it is right; reporting success is not.
    h.listUsersThrows = true;
    const set = await assembleSearchableCandidateSet(scopeAll);
    expect(set.ok).toBe(false);
  });

  it("a locked-out caller is a KNOWN empty — no retry could change it", async () => {
    // LAW #25: visibleIds === [] means this admin genuinely sees nobody. That
    // must stay ok:true, or the panel offers a retry button that can never help.
    const set = await assembleSearchableCandidateSet({ visibleIds: [] } as unknown as AssistantScope);
    expect(set.ok).toBe(true);
    expect(set.candidates).toEqual([]);
  });

  it("the legacy wrapper still returns a bare array for /needs and the D1 parity test", async () => {
    h.listUsersError = { message: "boom" };
    const legacy = await assembleSearchableCandidates(scopeAll);
    expect(Array.isArray(legacy), "assembleSearchableCandidates must keep its old shape").toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG 6 — and the two routes refuse to turn that floor into a number
// ───────────────────────────────────────────────────────────────────────────
describe("search and facets report unknown instead of counting a floor", () => {
  const SEARCH = code("app/api/portal/admin/search/route.ts");
  const FACETS = code("app/api/portal/admin/facets/route.ts");

  it("both routes ask for the set that can say 'unknown'", () => {
    for (const [name, src] of [["search", SEARCH], ["facets", FACETS]] as const) {
      expect(src, `${name} must use assembleSearchableCandidateSet`)
        .toContain("assembleSearchableCandidateSet");
    }
  });

  it("search stops before filtering when the set is not a fact", () => {
    expect(SEARCH).toMatch(/if\s*\(\s*!set\.ok\s*\)/);
    expect(SEARCH).toContain('code: "READ_FAILED"');
    expect(SEARCH).toContain("status: 503");
  });

  it("neither route reports a count it never took", () => {
    // matched/total must be null on a failure, never 0 — "0 candidates" is a
    // claim about 93 nurses, and nothing had counted them.
    expect(SEARCH, "search must not answer matched:0 on a failed read").toContain("matched: null, total: null");
    expect(FACETS, "facets must not answer total:0 on a failed read").toContain("total: null, shown: null");
  });

  it("the facets catch no longer reports ok:TRUE over a crash", () => {
    // It literally returned { ok: true, groups: [], results: [], total: 0 }.
    expect(FACETS, "a crash must never be reported as a successful empty result")
      .not.toMatch(/ok:\s*true,\s*groups:\s*\[\]/);
    expect(FACETS).toContain('code: "READ_FAILED"');
  });

  it("the search catch is a 503, not a 200 dressed as a finished search", () => {
    const at = SEARCH.lastIndexOf("} catch (e) {");
    expect(at, "the catch block was not found").toBeGreaterThan(-1);
    const tail = SEARCH.slice(at);
    expect(tail, "the unexpected-failure path must not answer 200").not.toContain("status: 200");
    expect(tail).toContain("status: 503");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG 6 — and the two clients show it as unknown, WITH a way to ask again
// ───────────────────────────────────────────────────────────────────────────
describe("the admin sees 'not checked' and a retry, not a calm zero", () => {
  const FILTERS = code("components/AdminAdvancedFilters.tsx");
  const SEARCHBAR = code("components/AdminSmartSearch.tsx");

  it("the filters panel has a distinct unknown state", () => {
    expect(FILTERS).toContain('kind: "unknown"');
  });

  it("a dropped connection sets UNKNOWN, never a fabricated empty result", () => {
    // The catch used to build `{ ok: true, groups: [], total: 0 }` out of thin
    // air, so a dead connection on Moroccan mobile data rendered as the
    // finished, authoritative answer "0 candidates". Asserted on the catch
    // BLOCK, not on the old literal: an earlier version of this test only
    // forbade the exact string `setData({ ok: true`, and a mutant that wrote
    // the same lie through the new state shape sailed straight past it.
    const at = FILTERS.indexOf("} catch (e) {");
    expect(at, "the catch block was not found").toBeGreaterThan(-1);
    const body = FILTERS.slice(at, FILTERS.indexOf("} finally {", at));
    expect(body, "the catch must mark the set unknown").toContain('kind: "unknown"');
    expect(body, "the catch must not report a successful result of any shape")
      .not.toMatch(/kind:\s*"ok"|ok:\s*true/);
  });

  it("the filters panel checks the HTTP status as well as the body", () => {
    // `await r.json()` alone parsed a 503 body and rendered it as counts.
    expect(FILTERS).toMatch(/!r\.ok\s*\|\|\s*!j\s*\|\|\s*j\.ok === false/);
  });

  it("the filters panel never says 'no candidates match' while unknown", () => {
    const at = FILTERS.indexOf("No candidates match these filters.");
    expect(at, "the empty-results line was not found").toBeGreaterThan(-1);
    // The unknown branch must be tested BEFORE the empty-results branch, or the
    // sentence that caused this bug renders over an unknown set.
    const unknownAt = FILTERS.indexOf("unknown && !loading ?");
    expect(unknownAt, "the unknown branch must come first").toBeGreaterThan(-1);
    expect(unknownAt).toBeLessThan(at);
  });

  it("both clients offer a retry, in all three languages (LAW #19)", () => {
    for (const [name, src] of [["filters", FILTERS], ["search bar", SEARCHBAR]] as const) {
      expect(src, `${name} must offer a retry`).toContain('L("Try again", "Réessayer", "Erneut versuchen")');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG 5 — a slot write that failed is never reported as saved
