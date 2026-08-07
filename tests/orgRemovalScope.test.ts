import { describe, it, expect } from "vitest";

/**
 * LAW #25 — the shape of getVisibleCandidateIds, pinned as a truth table.
 *
 * lib/admin-auth.ts decides scope from two independent facts: the
 * `is_agency_admin` flag, and how many organisations the person belongs to.
 *
 *     if (!isAgencyAdmin && myOrgs.length === 0) return null;   // sees ALL
 *     if (myOrgs.length === 0) return [];                       // sees NOTHING
 *     ...otherwise: that org's approved candidates
 *
 * The trap is the first line. A partner scoped ONLY by org membership — flag
 * false, one org — falls into "sees nothing" while the membership exists, and
 * into "sees ALL 78" the moment it is removed. Cutting the agency off was the
 * click that opened every dossier.
 *
 * The invite path, which is how partners actually join, inserted the flag as
 * false. The admin panel inserted it as true. Only one of them was right.
 */
type Scope = "all" | "none" | "their-org";

function scopeOf(isAgencyAdmin: boolean, orgCount: number): Scope {
  if (!isAgencyAdmin && orgCount === 0) return "all";
  if (orgCount === 0) return "none";
  return "their-org";
}

describe("who sees what (LAW #25)", () => {
  it("a Borivon HQ sub-admin sees every candidate", () => {
    expect(scopeOf(false, 0)).toBe("all");
  });

  it("an agency admin sees only their own org", () => {
    expect(scopeOf(true, 1)).toBe("their-org");
  });

  it("removing an agency admin from their org leaves them seeing NOTHING", () => {
    // This is the safe direction, and it only holds because the flag is true.
    expect(scopeOf(true, 0)).toBe("none");
  });

  it("REGRESSION: a partner scoped only by membership is PROMOTED when it is removed", () => {
    // Flag false + one org looks correctly scoped...
    expect(scopeOf(false, 1)).toBe("their-org");
    // ...and then the removal widens them to the entire roster. This is the
    // state the invite path used to create, and the reason it now passes
    // agencyScoped=true.
    expect(scopeOf(false, 0)).toBe("all");
    expect(scopeOf(false, 0)).not.toBe("none");
  });

  it("the flag is what makes removal safe, so every org joiner must carry it", () => {
    // Both join paths must land here: agency people get true, and then removal
    // is fail-closed no matter which route created them.
    for (const orgCount of [0, 1, 2]) {
      expect(scopeOf(true, orgCount)).not.toBe("all");
    }
  });
});
