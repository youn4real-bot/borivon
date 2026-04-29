"use client";

/**
 * Per-route error boundary for /portal/admin.
 *
 * Surfaces the actual exception inline (instead of the generic Vercel
 * "Application error" overlay) so we can diagnose client-side crashes
 * without a debugger or sourcemaps.
 */

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to browser console in case a power user has it open.
    // eslint-disable-next-line no-console
    console.error("[/portal/admin error]", error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="max-w-xl w-full p-6 rounded-2xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] mb-2"
          style={{ color: "#e05252" }}>
          Admin page error
        </p>
        <h1 className="text-base font-semibold mb-3" style={{ color: "var(--w)" }}>
          {error.message || "An unknown error occurred"}
        </h1>
        {error.stack && (
          <pre className="text-[11px] leading-relaxed p-3 rounded-lg whitespace-pre-wrap break-words mb-3"
            style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)", maxHeight: "40vh", overflow: "auto" }}>
            {error.stack}
          </pre>
        )}
        {error.digest && (
          <p className="text-[10px]" style={{ color: "var(--w3)" }}>
            Digest: <code>{error.digest}</code>
          </p>
        )}
        <div className="mt-4 flex items-center gap-2">
          <button onClick={reset}
            className="text-[12.5px] font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-90"
            style={{ background: "var(--gold)", color: "#131312" }}>
            Try again
          </button>
          <a href="/portal/dashboard"
            className="text-[12.5px] font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
