/**
 * /v2 marketing-site shell. The global GlobalChrome Navbar is suppressed on
 * /v2/* (see components/GlobalChrome.tsx) so this self-contained premium nav +
 * footer is the only chrome here. Theme/Lang providers from the root layout
 * still wrap us, so the in-nav language + theme controls persist site-wide.
 */
import type { Metadata } from "next";
import { V2Nav, V2Footer } from "./_nav";
import { Atmosphere, ScrollProgress } from "./_components";
import SmoothScroll from "./SmoothScroll";

// Enterprise metadata for ALL /v2 routes — overrides the root (B2C / Casablanca /
// "school" / A1-B2) SEO so sharing a /v2 link advertises the right thing.
export const metadata: Metadata = {
  title: "Borivon · Professional German for teams",
  description: "Borivon is the institute that gets your teams speaking professional German with clients, partners and markets in Germany, Austria and Switzerland. Online, AI-powered, speaking from the first lesson.",
  openGraph: {
    title: "Borivon · Professional German for teams",
    description: "Get your teams speaking professional German with German-speaking clients, partners and markets. Online, AI-powered, speaking-first.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Borivon · Professional German for teams",
    description: "Professional German for enterprise teams. Online, AI-powered, speaking-first.",
  },
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <SmoothScroll>
      <div style={{ background: "var(--bg)", color: "var(--w)", minHeight: "100dvh" }}>
        <Atmosphere />
        <ScrollProgress />
        <V2Nav />
        <main id="bv-main">{children}</main>
        <V2Footer />
      </div>
    </SmoothScroll>
  );
}
