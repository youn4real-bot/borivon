import { describe, it, expect } from "vitest";
import { isPlaceableLead, PLACEABLE_LEAD_KINDS } from "@/lib/leadKinds";

/**
 * Regression: the Leads page and /api/portal/admin/lead-to-pool both gated on
 * `kind === "nurse"`, a kind only the booking flow and the bot mint. The website
 * funnel emits person / work / org / fachkraefte / general, so "Add to pool" was
 * never rendered for a single real lead and the conversion endpoint would have
 * rejected every one of them.
 *
 * The live table had eleven rows and no "nurse" among them — including
 * kind="work", field="pflege": a nurse who could not be added to the pool.
 */
describe("isPlaceableLead", () => {
  it("accepts an individual who wants to work in Germany", () => {
    // The real 28 July lead: kind "work", details { field: "pflege" }.
    expect(isPlaceableLead("work")).toBe(true);
  });

  it("accepts the German-course individual and the legacy booking kind", () => {
    expect(isPlaceableLead("person")).toBe(true);
    expect(isPlaceableLead("nurse")).toBe(true);
  });

  it("rejects an EMPLOYER asking for staff", () => {
    // "fachkraefte" carries sector / positions / city — the live example row is
    // literally name "Test Klinik", positions "5 nurses". Converting one would
    // create a portal account for a hospital and file it as someone we place.
    expect(isPlaceableLead("fachkraefte")).toBe(false);
  });

  it("rejects organisations and unclassified messages", () => {
    expect(isPlaceableLead("org")).toBe(false);
    expect(isPlaceableLead("general")).toBe(false);
  });

  it("is not fooled by casing or padding from hand-entered rows", () => {
    expect(isPlaceableLead("  Work ")).toBe(true);
    expect(isPlaceableLead("NURSE")).toBe(true);
  });

  it("treats missing or unknown kinds as not placeable", () => {
    for (const v of [null, undefined, "", "klinik", "employer"]) {
      expect(isPlaceableLead(v)).toBe(false);
    }
  });

  it("keeps counterparty kinds out of the allow-list itself", () => {
    // Guards against someone widening the constant without thinking: an
    // employer kind appearing here is the whole failure mode this prevents.
    for (const bad of ["org", "fachkraefte", "general"]) {
      expect(PLACEABLE_LEAD_KINDS).not.toContain(bad);
    }
  });
});
