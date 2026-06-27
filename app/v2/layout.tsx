/**
 * /v2 marketing-site shell. The global GlobalChrome Navbar is suppressed on
 * /v2/* (see components/GlobalChrome.tsx) so this self-contained premium nav +
 * footer is the only chrome here. Theme/Lang providers from the root layout
 * still wrap us, so the in-nav language + theme controls persist site-wide.
 */
import { V2Nav, V2Footer } from "./_nav";
import { Atmosphere, ScrollProgress } from "./_components";
import SmoothScroll from "./SmoothScroll";

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
