import type { Metadata } from "next";

/**
 * Public candidate profile (/<firstname>-<id>) — pass-through layout that exists
 * only to carry metadata, because page.tsx is a client component and cannot
 * export any.
 *
 * NOINDEX, deliberately. These pages render a nurse's real name, city, country,
 * nationality and photo. They were reachable before, but the root layout put a
 * canonical to the homepage on every URL of the site, so Google was being told
 * to show borivon.com instead of any of them. Removing that broken canonical
 * (it was suppressing the pages the founder actually wants ranked) would, on its
 * own, have quietly made every candidate's personal page eligible for search
 * results — a change to how his candidates' data is exposed that nobody asked
 * for.
 *
 * `follow` stays true so links out of the page still pass value.
 *
 * If these profiles are MEANT to be findable on Google — they carry a
 * verification badge, so that may well be the intent — flip `index` to true
 * here. That is a one-line, deliberate decision rather than a side effect.
 */
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
    googleBot: { index: false, follow: true },
  },
};

export default function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
