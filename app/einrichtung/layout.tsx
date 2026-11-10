import type { Metadata } from "next";

/** The facility platform: never in search engines (it is a private workspace). */
export const metadata: Metadata = {
  title: "Borivon Plattform",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
