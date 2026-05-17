// Pure-JSX page loader — no hooks, no `"use client"`. Safe to use from
// Next.js `loading.tsx` files (which are Server Components by default).
//
// The visual is intentionally identical to <PageLoader> in components/ui/
// states.tsx so navigation feels continuous when the client bundle takes
// over.
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
      <div
        aria-label="Loading"
        role="status"
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "2px solid transparent",
          borderTopColor: "var(--gold)",
          animation: "bvSpin 0.8s linear infinite",
        }}
      />
      <style>{`@keyframes bvSpin{to{transform:rotate(360deg)}}`}</style>
    </main>
  );
}
