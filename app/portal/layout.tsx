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
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
