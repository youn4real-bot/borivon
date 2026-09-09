import { describe, it, expect } from "vitest";
import { canReadSlotTemplate, type SlotTemplateViewer } from "../lib/slotTemplateAccess";

const CALMAROI = "org-calmaroi";
const OTHER_AGENCY = "org-other";
const KIEL = "emp-kiel";
const LUEBECK = "emp-luebeck";

const viewer = (over: Partial<SlotTemplateViewer> = {}): SlotTemplateViewer => ({
  staff: null,
  employerId: null,
  employerAgencyId: null,
  approvedOrgIds: [],
  ...over,
});

describe("canReadSlotTemplate (LAW #25 / #34)", () => {
  it("HQ staff can read anything", () => {
    expect(canReadSlotTemplate({ orgId: CALMAROI, employerId: KIEL }, viewer({ staff: "all" }))).toBe(true);
  });

  // Every org member gets a sub_admins row, so "is staff" must not mean
  // "sees everything" — otherwise one agency reads a competitor's contracts.
  describe("ORG-SCOPED staff are confined to their own agencies", () => {
    it("can read their OWN agency's template", () => {
      expect(canReadSlotTemplate({ orgId: CALMAROI, employerId: null }, viewer({ staff: [CALMAROI] }))).toBe(true);
    });

    it("CANNOT read a competing agency's template", () => {
      expect(canReadSlotTemplate({ orgId: OTHER_AGENCY, employerId: null }, viewer({ staff: [CALMAROI] }))).toBe(false);
    });

    it("can read a site template belonging to their own agency", () => {
      expect(canReadSlotTemplate(
        { orgId: null, employerId: KIEL, employerAgencyId: CALMAROI },
        viewer({ staff: [CALMAROI] }),
      )).toBe(true);
    });

    it("CANNOT read a site template belonging to another agency", () => {
      expect(canReadSlotTemplate(
        { orgId: null, employerId: KIEL, employerAgencyId: OTHER_AGENCY },
        viewer({ staff: [CALMAROI] }),
      )).toBe(false);
    });

    it("CANNOT read an orphan site template whose agency is unknown", () => {
      // employerAgencyId null must not read as "global" for scoped staff.
      expect(canReadSlotTemplate(
        { orgId: null, employerId: KIEL, employerAgencyId: null },
        viewer({ staff: [CALMAROI] }),
      )).toBe(false);
    });

    it("can still read a truly global template", () => {
      expect(canReadSlotTemplate({ orgId: null, employerId: null }, viewer({ staff: [CALMAROI] }))).toBe(true);
    });
  });

  it("a truly global template (no agency, no site) is readable by any candidate", () => {
    expect(canReadSlotTemplate({ orgId: null, employerId: null }, viewer())).toBe(true);
  });

  // The bug this file exists for: employer-scoped rows keep org_id NULL, so an
  // org-only check treats a site's private paperwork as global.
  it("a SITE template is NOT public just because its org_id is null", () => {
    expect(canReadSlotTemplate({ orgId: null, employerId: KIEL }, viewer())).toBe(false);
  });

  it("a candidate placed at the site can read that site's template", () => {
    expect(canReadSlotTemplate({ orgId: null, employerId: KIEL }, viewer({ employerId: KIEL }))).toBe(true);
  });

  it("a candidate at ANOTHER site of the same agency cannot read a site template", () => {
    expect(canReadSlotTemplate(
      { orgId: null, employerId: KIEL },
      viewer({ employerId: LUEBECK, employerAgencyId: CALMAROI }),
    )).toBe(false);
  });

  it("an agency template is readable via an approved agency link", () => {
    expect(canReadSlotTemplate({ orgId: CALMAROI, employerId: null }, viewer({ approvedOrgIds: [CALMAROI] }))).toBe(true);
  });

  it("an agency template is readable when placed at one of its sites", () => {
    expect(canReadSlotTemplate(
      { orgId: CALMAROI, employerId: null },
      viewer({ employerId: KIEL, employerAgencyId: CALMAROI }),
    )).toBe(true);
  });

  it("another agency's candidate cannot read Calmaroi's template", () => {
    expect(canReadSlotTemplate(
      { orgId: CALMAROI, employerId: null },
      viewer({ approvedOrgIds: [OTHER_AGENCY], employerAgencyId: OTHER_AGENCY }),
    )).toBe(false);
  });

  it("an unplaced, unlinked candidate cannot read a scoped template", () => {
    expect(canReadSlotTemplate({ orgId: CALMAROI, employerId: null }, viewer())).toBe(false);
    expect(canReadSlotTemplate({ orgId: CALMAROI, employerId: KIEL }, viewer())).toBe(false);
  });

  it("null placement never matches a null-scoped field (no null==null loophole)", () => {
    // A candidate with no employer must not satisfy an employer-scoped slot.
    expect(canReadSlotTemplate({ orgId: null, employerId: LUEBECK }, viewer({ employerId: null }))).toBe(false);
  });
});
