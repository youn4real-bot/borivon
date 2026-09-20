import type { MetadataRoute } from "next";

/**
 * PWA manifest — lets anyone "install" Borivon to their phone home screen
 * (Android Chrome / iOS Safari → Add to Home Screen) so it opens like an app,
 * full-screen. Next.js serves this at /manifest.webmanifest and injects the
 * <link rel="manifest"> automatically. (The AI assistant now lives only in the
 * Telegram bot — there is no in-app assistant panel to deep-link into.)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Borivon",
    short_name: "Borivon",
    description: "Borivon — candidates, documents & pipeline.",

    // Identity, pinned deliberately.
    //
    // A manifest with no `id` is identified by its start_url, so changing
    // start_url alone would make every browser treat this as a BRAND NEW app:
    // the copies already on home screens would be orphaned at the old address
    // and never pick the new one up. Pinning `id` to the address they were
    // installed under keeps those installs matched, so they inherit the
    // start_url below on their next manifest refresh. It is a stable
    // identifier, not a destination — nothing navigates here.
    id: "/portal/admin",

    // Everyone's home screen icon used to open /portal/admin.
    //
    // Nurses are ~93 of the ~95 people who have this installed. Tapping the
    // icon booted the heaviest page in the app — a 9,500-line admin client
    // component, on a Moroccan phone, over mobile data — only for the role
    // check to bounce her to her own dashboard. /portal is the login page and
    // it already routes by role: signed-in admin / sub-admin / org member to
    // /portal/admin, signed-in candidate to /portal/dashboard, and anyone
    // signed out gets the login form instead of an admin page they cannot use.
    start_url: "/portal",

    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#09090a",
    theme_color: "#09090a",
    icons: [
      // favicon.png is a 6250×6250 square — browsers downscale to each slot.
      { src: "/favicon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/favicon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/favicon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
