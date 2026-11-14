"use client";

import { useMemo, type CSSProperties } from "react";
import { encodeQr, qrSvgPath, QR_BORDER, QR_DARK, QR_LIGHT } from "@/lib/qr";

/** A QR code drawn in the browser as one SVG path, so the encoded text (a single-use invite link)
 *  never leaves the page. See lib/qr.ts for why no QR web service is used. */
export default function QrCode({ value, label, style }: { value: string; label: string; style?: CSSProperties }) {
  const { n, d } = useMemo(() => {
    const qr = encodeQr(value);
    return { n: qr.size + QR_BORDER * 2, d: qrSvgPath(qr) };
  }, [value]);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges"
      style={{ display: "block", aspectRatio: "1 / 1", ...style }}>
      <rect width={n} height={n} fill={QR_LIGHT} />
      <path d={d} fill={QR_DARK} />
    </svg>
  );
}
