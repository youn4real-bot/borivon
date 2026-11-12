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
  // Open the connection to the login service early (Supabase is a listed processor).
  // No preconnect to Google: /portal is also the public login page, and a preconnect alone hands
  // the visitor's IP to Google before anyone signed in (2026-11-10). Profile photos still load
  // normally after a Google sign-in.
  const supa = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supa) preconnect(supa, { crossOrigin: "anonymous" });
  // Wake the server while the page's JavaScript is still downloading (founder 2026-11-12: "loading is slow").
  // The portal page itself now comes straight from the edge; only its data calls need the worker, and a cold
  // worker costs 1-3 s. This tiny ping starts that cold start at once, so it overlaps the download instead of
  // following it. Own origin only, no data, nothing stored.
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "try{fetch('/api/health',{cache:'no-store',keepalive:true}).catch(function(){})}catch(e){}" }} />
      {children}
    </>
  );
}
