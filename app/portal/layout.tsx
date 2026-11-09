import type { Metadata } from "next";
import { preconnect } from "react-dom";

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
  // Logged-in app only (not the public pages): open the connection to the login service early.
  // Supabase is a listed processor; Google profile photos load here anyway for Google sign-ins.
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supa) preconnect(supa, { crossOrigin: "anonymous" });
  preconnect("https://lh3.googleusercontent.com", { crossOrigin: "anonymous" });
  return <>{children}</>;
}
