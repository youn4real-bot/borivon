import type { MetadataRoute } from "next";

/**
 * PWA manifest — lets the admin "install" Borivon to their phone home screen
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
    start_url: "/portal/admin",
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
