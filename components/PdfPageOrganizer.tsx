"use client";

/**
 * THE DOOR TO THE PAGE ORGANISER — the organiser itself is
 * `PdfPageOrganizerImpl`, unchanged, including its iOS rescues (it is the one
 * PDF surface in the portal that runs pdf.js on a phone, through the LEGACY
 * pdfjs build in lib/pdfjs.ts).
 *
 * Same reason as components/PdfViewer.tsx: `AdminDocPreviewModal` imports the
 * organiser, three "use client" pages import that modal, and Next compiles
 * each of them a second time for SSR — which is how pdfjs-dist ended up in the
 * Cloudflare Worker script. `ssr: false` is what removes it from the server
 * compilation; a plain `await import()` would not.
 *
 * NO LOADING OVERLAY ON PURPOSE. The organiser draws its own full-screen
 * backdrop through a portal, and that backdrop closes on click. A stand-in
 * backdrop here would have no close handler, so a chunk that stalls would trap
 * the admin behind a window that cannot be dismissed. The chunk is small (the
 * heavy part, pdf.js itself, is fetched by the organiser at runtime either
 * way), so the honest fallback is nothing at all for the moment it takes.
 */

import dynamic from "next/dynamic";

export const PdfPageOrganizer = dynamic(
  () => import("@/components/PdfPageOrganizerImpl").then(m => ({ default: m.PdfPageOrganizer })),
  { ssr: false, loading: () => null },
);
