/**
 * Two typographic zones (founder rule, 2026-10-19):
 *
 *   portal  /portal and everything under it (admins + candidates):
 *           Lexend for ALL text. Only the "Borivon." wordmark stays Playfair.
 *   site    every other page: Playfair headlines + mono labels, like /pflege.
 *
 * The site-only rules live in ONE <style> node. It is added before first paint
 * by an inline script in app/layout.tsx (so no font flicker) and kept in sync on
 * client-side navigation by GlobalChrome. A class or data attribute on <html>
 * cannot carry this: React reconciles <html>'s attributes during hydration and
 * wipes it (same reason the affiliate-host marker injects a style node).
 */

export const SITE_ZONE_ID = "bv-site-zone";

export const SITE_ZONE_CSS =
  "h1,h2,.bv-h1,.bv-h2{font-family:var(--font-heading);font-weight:500!important;letter-spacing:-0.02em}" +
  ".bv-eyebrow,.bv-label{font-family:var(--font-mono);font-weight:500}" +
  ".bv-eyebrow{letter-spacing:.2em}" +
  ".bv-label{font-size:.66rem;letter-spacing:.14em}";

export function isPortalPath(path: string): boolean {
  return path === "/portal" || path.startsWith("/portal/");
}

/** Runs inline in <head>, before first paint. Must stay dependency-free. */
export const SITE_ZONE_BOOT =
  "try{var p=location.pathname;if(!(p==='/portal'||p.indexOf('/portal/')===0)){" +
  "var s=document.createElement('style');s.id=" + JSON.stringify(SITE_ZONE_ID) + ";s.textContent=" + JSON.stringify(SITE_ZONE_CSS) + ";" +
  "(document.head||document.documentElement).appendChild(s);}}catch(e){}";

/** Client navigation: add the node on site pages, remove it inside the portal. */
export function syncSiteZone(path: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(SITE_ZONE_ID);
  if (isPortalPath(path)) { el?.remove(); return; }
  if (el) return;
  const s = document.createElement("style");
  s.id = SITE_ZONE_ID;
  s.textContent = SITE_ZONE_CSS;
  (document.head || document.documentElement).appendChild(s);
}
