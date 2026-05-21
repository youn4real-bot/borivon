"use client";

/**
 * Root-layout error boundary. Next.js mounts this when GlobalChrome /
 * LangProvider / ThemeProvider / RootLayout itself crashes — i.e. when
 * the normal app/error.tsx can't help because the providers it relies on
 * never mounted.
 *
 * Because it replaces the entire <html>/<body> tree, we can't use any of
 * the styled primitives (LangContext is dead in here, useLang() would
 * throw). It's deliberately minimal: inline styles, English-only copy,
 * a single "Try again" button. The goal is just to give the user an
 * escape hatch instead of a blank page when the providers themselves
 * are broken.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error.digest ?? "no-digest", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{
        margin: 0,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#09090a",
        color: "#fff",
        padding: "1rem",
      }}>
        <div role="alert" aria-live="assertive" style={{
          textAlign: "center",
          maxWidth: 420,
          padding: "40px 28px",
          background: "#121214",
          border: "1px solid #2a2a30",
          borderRadius: 20,
        }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 13, color: "#9999a3", lineHeight: 1.5, marginBottom: 24 }}>
            The application could not load. Please try again, or visit{" "}
            <a href="https://www.borivon.com" style={{ color: "#e2b54a", textDecoration: "underline" }}>
              borivon.com
            </a>.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#6a6a73", marginBottom: 20, fontFamily: "monospace" }}>
              Error ID: {error.digest}
            </p>
          )}
          <button onClick={() => reset()} style={{
            background: "#e2b54a",
            color: "#131312",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
