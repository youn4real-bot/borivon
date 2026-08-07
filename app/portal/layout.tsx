import type { Metadata } from "next";

/**
 * Portal layout — providers + navbar + bug button live in the root layout
 * (app/layout.tsx) via <GlobalChrome>, so this is a pass-through.
 *
 * We do set a title template here so every portal page gets "… | Borivon Portal"
 * instead of the root "… | Borivon".
 */
export const metadata: Metadata = {
  title: {
    template: "%s | Borivon Portal",
    default: "Borivon Portal",
  },
  // The portal is a logged-in application, not content. It inherited the root
  // layout's `index, follow`, so the login screen and every dashboard URL under
  // it were being offered to Google — nothing there is useful in a search
  // result, and a candidate landing on a bare login page from Google is a worse
  // first touch than the homepage. Overrides the root for this whole subtree.
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
