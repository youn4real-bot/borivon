// Pure-JSX page loader — no hooks, no `"use client"`. Safe to use from
// Next.js `loading.tsx` files (which are Server Components by default).
//
// Same look as <PageLoader> in components/ui/states.tsx (both render <BvLoader/>),
// so navigation feels continuous when the client bundle takes over.
import { BvLoader } from "@/components/ui/BvLoader";

export function ServerPageLoader() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      <BvLoader />
    </main>
  );
}
