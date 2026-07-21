import { describe, it, expect } from "vitest";
import { resolveCvBrand } from "../lib/cvRender";

// resolveCvBrand's force short-circuits ("none" / "borivon") return BEFORE any
// Supabase call — so they're pure and testable with no DB/env. This locks the
// "Regenerate agency CV" button's contract: the picker mode can never override
// an explicit force, and Borivon/no-branding forces never hit the org lookup.
describe("resolveCvBrand — forced branding (agency-CV button contract)", () => {
  it("force 'none' → strips all branding, no DB touch", async () => {
    await expect(resolveCvBrand("00000000-0000-0000-0000-000000000000", true, "none"))
      .resolves.toEqual({ noBranding: true });
  });
  it("force 'borivon' → plain Borivon (empty brand), no DB touch", async () => {
    await expect(resolveCvBrand("00000000-0000-0000-0000-000000000000", true, "borivon"))
      .resolves.toEqual({});
  });
  it("force wins even when byAdmin is false (candidate-side self-render can't leak agency)", async () => {
    await expect(resolveCvBrand("00000000-0000-0000-0000-000000000000", false, "none"))
      .resolves.toEqual({ noBranding: true });
    await expect(resolveCvBrand("00000000-0000-0000-0000-000000000000", false, "borivon"))
      .resolves.toEqual({});
  });
  it("no force + not admin → plain Borivon (unchanged legacy behaviour)", async () => {
    await expect(resolveCvBrand("00000000-0000-0000-0000-000000000000", false))
      .resolves.toEqual({});
  });
});
