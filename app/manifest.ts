import type { MetadataRoute } from "next";

/**
 * PWA manifest — lets the admin "install" Borivon to their phone home screen
 * (Android Chrome / iOS Safari → Add to Home Screen) so it opens like an app,
 * full-screen, straight into the AI assistant (start_url carries ?assistant=1,
 * which AdminAssistantPanel reads to auto-open). Next.js serves this at
 * /manifest.webmanifest and injects the <link rel="manifest"> automatically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Borivon",
    short_name: "Borivon",
    description: "Borivon — candidates, documents & your AI assistant.",
    start_url: "/portal/admin?assistant=1",
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
