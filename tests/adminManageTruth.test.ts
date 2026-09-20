import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * /portal/admin/manage MUST NOT CLAIM A POWER IT DOES NOT HAVE.
 *
 * Bug 9 of the q3 admin audit. The page said "Assign agents access to specific
 * candidates" and showed Assign / Assigned toggles per candidate, so the
 * founder had every reason to believe that un-assigning a candidate took her
 * away from an agent. It never did.
 *
 * The evidence is lib/admin-auth.ts, which holds the ONLY two functions that
 * gate per-candidate access under LAW #25 -- canActOnCandidate() and
 * getVisibleCandidateScope(). Neither reads sub_admin_assignments. Scope is
 * decided by three things: the is_agency_admin flag, organization_members, and
 * the approved rows in candidate_organizations.
 *
 * The toggles are not dead data -- the assistant reads sub_admin_assignments to
 * answer "who is looking after her" and to hand a caseload from one agent to
 * another -- they were labelled as a permission. The page now says what they
 * are, and states the rule that actually decides access.
 *
 * Making it REAL was the other option and was deliberately not taken: it would
 * add a fourth scoping trigger to the security core of a live portal, and the
 * moment assignments started restricting, every sub-admin with no assignment
 * rows would lose all ~93 candidates at once. That is a founder's decision.
 */

/** Read a file with comments blanked, preserving offsets: the fix carries a
 *  long note that QUOTES the old claim in order to explain why it was wrong,
 *  and a raw scan would match the explanation instead of the copy on screen. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

// ───────────────────────────────────────────────────────────────────────────
describe("/portal/admin/manage does not claim a power it does not have", () => {
  const AUTH = code("lib/admin-auth.ts");
  // Comments blanked: the fix carries a long note that QUOTES the old claim in
  // order to explain why it was wrong, and a raw scan would match the
  // explanation instead of the copy that actually reaches the screen.
  const MANAGE = code("app/portal/admin/manage/page.tsx");

  it("EVIDENCE: the access-control core never reads sub_admin_assignments", () => {
    // This is the whole basis of the decision. canActOnCandidate() and
    // getVisibleCandidateScope() are the only two functions that gate
    // per-candidate access under LAW #25, and the table does not appear in
    // this file at all — so the Assign / Assigned toggles restrict nothing.
    expect(AUTH).toContain("export async function canActOnCandidate");
    expect(AUTH).toContain("export async function getVisibleCandidateScope");
    expect(AUTH, "if assignments ever DO scope access, this page's copy must change with it")
      .not.toContain("sub_admin_assignments");
  });

  it("the page no longer describes the toggles as access", () => {
    expect(MANAGE, "the page claimed to assign ACCESS; it assigns a caseload")
      .not.toContain("Assign agents access to specific candidates");
    expect(MANAGE).not.toContain("Attribuer aux agents l'accès à des candidats spécifiques");
    expect(MANAGE).not.toContain("Agenten Zugang zu bestimmten Kandidaten geben");
  });

  it("the page states what actually decides access, in all three languages", () => {
    for (const lang of ["en", "fr", "de"] as const) {
      const at = MANAGE.indexOf(`  ${lang}: {`);
      expect(at, `the ${lang} block was not found`).toBeGreaterThan(-1);
      const block = MANAGE.slice(at, MANAGE.indexOf("\n  },", at));
      expect(block, `LAW #19: ${lang} needs an accessNote`).toContain("accessNote:");
    }
    // …and it has to be on screen, not merely defined.
    expect(MANAGE).toContain("{T.accessNote}");
  });
});
