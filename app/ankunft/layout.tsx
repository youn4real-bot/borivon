import type { Metadata } from "next";

/** A nurse's arrival plan (private link): never in search engines, no referrer to anyone. */
export const metadata: Metadata = {
  title: "Dein Ankunftsplan · Borivon",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
