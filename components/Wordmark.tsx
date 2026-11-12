// The ONE Borivon logo, everywhere (founder 2026-11-12: "go across every space that has my logo
// and just have one logo" — the homepage one). Exactly content/pflege/bv.css `.logo`:
//   "Borivon" in EB Garamond italic 500, letter-spacing -.01em;
//   the dot upright and bold (the homepage's <b> default), gold.
// PDFs draw the same logo from public/brand/wordmark.pdf (lib/pdflib/render.ts drawWordmark).
// Pure JSX, no hooks: usable from server and client components alike.
import type React from "react";

export function Wordmark({
  size = "1.65rem",
  color = "var(--w)",
  dot = "var(--gold)",
  className,
  style,
}: {
  /** font size of the logo, e.g. "1.65rem" (the homepage header) or 24 (px) */
  size?: string | number;
  color?: string;
  dot?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{
        fontFamily: "var(--font-serif), \"EB Garamond\", Georgia, serif",
        fontStyle: "italic",
        fontWeight: 500,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: "-.01em",
        color,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      Borivon<b style={{ fontStyle: "normal", fontWeight: 700, color: dot }}>.</b>
    </span>
  );
}
