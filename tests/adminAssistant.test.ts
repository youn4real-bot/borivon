import { describe, it, expect } from "vitest";
import { ASSISTANT_READ_TOOLS, WRITE_TOOL_NAMES, collectCandidateIds, readToolKeysForScope } from "@/lib/assistantReadOnly";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

describe("read-only assistant tool allowlist", () => {
  it("never intersects the write-tool set (the safety invariant)", () => {
    const writes = new Set(WRITE_TOOL_NAMES);
    const leaked = ASSISTANT_READ_TOOLS.filter((t) => writes.has(t));
    expect(leaked).toEqual([]);
  });

  it("has no duplicate entries", () => {
    expect(new Set(ASSISTANT_READ_TOOLS).size).toBe(ASSISTANT_READ_TOOLS.length);
  });

  it("includes the tools needed to answer 'what does X still need'", () => {
    for (const t of ["getCandidateChecklist", "getCandidateDossier", "getCandidatePipeline", "listCandidateDocuments"]) {
      expect(ASSISTANT_READ_TOOLS).toContain(t);
    }
  });

  it("excludes the obvious write tools", () => {
    for (const t of ["reviewDocument", "sendCandidateMessage", "editCandidateProfileField", "deleteCandidateAccount", "assignEmployer"]) {
      expect(ASSISTANT_READ_TOOLS).not.toContain(t);
    }
  });
});

describe("readToolKeysForScope — scope partition (the LAW #25 fix)", () => {
  it("a BOUNDED org-admin gets ONLY per-candidate tools — no roster reads, no briefing", () => {
    const keys = readToolKeysForScope({ role: "sub_admin", visibleIds: ["cand-1", "cand-2"] });
    // Per-candidate tools present…
    expect(keys).toContain("getCandidateChecklist");
    expect(keys).toContain("searchCandidates");
    // …but NO roster/aggregate reads that could surface out-of-scope names/PII…
    expect(keys).not.toContain("getTodayBriefing");   // the critical leak
    expect(keys).not.toContain("listStuckCandidates");
    expect(keys).not.toContain("listAllCandidates");
    expect(keys).not.toContain("findDocumentsAcrossCandidates");
  });

  it("an all-seeing HQ sub-admin gets roster reads but NOT the founder's briefing", () => {
    const keys = readToolKeysForScope({ role: "sub_admin", visibleIds: null });
    expect(keys).toContain("listStuckCandidates");
    expect(keys).toContain("findDocumentsAcrossCandidates");
    expect(keys).not.toContain("getTodayBriefing"); // leaks the founder's calendar → supreme only
  });

  it("the supreme admin gets everything, including the briefing", () => {
    const keys = readToolKeysForScope({ role: "admin", visibleIds: null });
    expect(keys).toContain("getTodayBriefing");
    expect(keys).toContain("getCandidateChecklist");
    expect(keys).toContain("listStuckCandidates");
    // and never a write
    const writes = new Set(WRITE_TOOL_NAMES);
    expect(keys.filter((k) => writes.has(k))).toEqual([]);
  });
});

describe("collectCandidateIds", () => {
  it("harvests ids from tool CALL args and tool RESULTS", () => {
    const result = {
      steps: [
        { toolCalls: [{ input: { candidateUserId: U1 } }], toolResults: [] },
        { toolCalls: [], toolResults: [{ output: { candidate: { candidateUserId: U2, name: "Bob" } } }] },
        { toolCalls: [], toolResults: [{ result: { candidates: [{ candidateUserId: U3 }, { candidateUserId: U1 }] } }] },
      ],
    };
    expect(collectCandidateIds(result).sort()).toEqual([U1, U2, U3].sort());
  });

  it("ignores non-UUID values and unrelated keys (e.g. the admin's own userId)", () => {
    const result = {
      steps: [
        { toolResults: [{ output: { candidateUserId: "not-a-uuid" } }] },
        { toolCalls: [{ input: { userId: U2 } }] }, // wrong key → not collected
      ],
    };
    expect(collectCandidateIds(result)).toEqual([]);
  });

  it("is safe on empty / malformed shapes", () => {
    expect(collectCandidateIds(null)).toEqual([]);
    expect(collectCandidateIds({})).toEqual([]);
    expect(collectCandidateIds({ steps: [] })).toEqual([]);
    expect(collectCandidateIds({ steps: [{}] })).toEqual([]);
  });
});
