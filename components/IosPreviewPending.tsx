"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/states";

/**
 * The placeholder shown while an iOS PDF preview is waiting for its download
 * token — with an escape hatch, which is the entire point.
 *
 * On iPhone the preview cannot render without a `dlt` token (WebKit carries no
 * Authorization header into an iframe). Every call site therefore had a
 * "no token yet" branch that returned a bare <Spinner/> with no timeout and no
 * retry. If the mint had not landed — a Cloudflare cold start, one dropped
 * request on mobile data — that spinner turned forever. She sat looking at a
 * spinning circle over a grey rectangle with nothing to tap, and concluded the
 * portal was broken. That is the "it spins forever" report, verbatim.
 *
 * So: spinner for the first 8 seconds, because a slow-but-working load is
 * normal on Moroccan mobile data and an error shown at 1s would be a lie. After
 * that it is not coming on its own, and she gets told so and gets a button.
 *
 * The retry re-mints AND remounts the frame via the caller's nonce, so a
 * genuinely transient failure recovers on one tap.
 */
export function IosPreviewPending({
  label,
  retryLabel,
  onRetry,
}: {
  /** Already-translated explanation. Caller owns i18n (LAW #19). */
  label: string;
  /** Already-translated button text. */
  retryLabel: string;
  onRetry: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [late, setLate] = useState(false);

  useEffect(() => {
    setLate(false);
    const id = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(id);
  }, [attempt]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "center",
        justifyContent: "center",
        background: "#525659",
      }}
    >
      {!late ? (
        <Spinner size="md" />
      ) : (
        <>
          <p style={{ color: "#fff", fontSize: 12.5, textAlign: "center", padding: "0 24px", margin: 0, lineHeight: 1.5 }}>
            {label}
          </p>
          <button
            type="button"
            onClick={() => { onRetry(); setAttempt((n) => n + 1); }}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: "8px 16px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.25)",
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
              // 44px min touch target (WCAG 2.5.5) — she is on a phone.
              minHeight: 44,
              minWidth: 88,
            }}
          >
            {retryLabel}
          </button>
        </>
      )}
    </div>
  );
}
