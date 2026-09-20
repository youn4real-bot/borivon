import { describe, it, expect } from "vitest";
import manifest from "../app/manifest";

/**
 * THE HOME-SCREEN ICON MUST NOT BOOT THE ADMIN PANEL ON A NURSE'S PHONE.
 *
 * The PWA manifest shipped `start_url: "/portal/admin"`. Roughly 93 of the ~95
 * people who have Borivon on a home screen are nurses in Morocco on mobile
 * data. Every tap of the icon loaded the heaviest page in the app — a
 * 9,500-line admin client component — for the role check to then bounce her to
 * /portal/dashboard. She paid for the admin bundle, every time, to go somewhere
 * else.
 *
 * /portal is the login page and it already routes by role on mount: admin,
 * sub-admin and org member to /portal/admin, candidate to /portal/dashboard,
 * and signed-out visitors get the login form.
 */
describe("PWA manifest start_url", () => {
  const m = manifest();

  it("opens the role-routing entry point, not a role-specific page", () => {
    expect(m.start_url).toBe("/portal");
  });

  it("never starts on an admin-only route", () => {
    // The exact regression: any /portal/admin* start_url puts the admin bundle
    // on every installed phone regardless of who owns it.
    expect(String(m.start_url).startsWith("/portal/admin")).toBe(false);
    expect(String(m.start_url).startsWith("/portal/org")).toBe(false);
  });

  it("pins an id so the phones that already installed it are not orphaned", () => {
    // With no `id`, a manifest is identified BY its start_url, so moving
    // start_url would read as a brand-new app: the copies already on home
    // screens would keep the old address forever and never see this fix. The id
    // must therefore stay at the address they were installed under.
    expect(m.id).toBe("/portal/admin");
  });

  it("keeps the whole site in scope so the role redirect stays in-app", () => {
    // start_url /portal immediately redirects to /portal/dashboard. If scope
    // were narrowed to /portal the redirect would still be inside it, but any
    // link out (a public profile, the homepage) would kick the user into the
    // browser. Scope stays "/".
    expect(m.scope).toBe("/");
  });
});
