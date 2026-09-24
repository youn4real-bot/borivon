"use client";

/**
 * THE DOOR TO THE PDF VIEWER — the viewer itself is `PdfViewerImpl`.
 *
 * Every caller still writes `import { PdfViewer } from "@/components/PdfViewer"`
 * and renders it with the same props; nothing about the viewer changed. What
 * changed is that this file resolves it through `next/dynamic` with
 * `ssr: false`, which keeps pdfjs-dist out of the SERVER build.
 *
 * WHY A SINGLE DOOR AND NOT ONE dynamic() PER CALL SITE. Nine modules import
 * the viewer and four "use client" pages reach it (admin, admin/pipeline and
 * dashboard through AdminDocPreviewModal / EmbedPdfViewer / PdfSignModal, plus
 * motivationsschreiben directly). Next compiles a client page a SECOND time for
 * SSR, so pdfjs-dist rode into the Worker script through whichever page still
 * had a static edge — MEASURED at 1.68 MB of Worker script (chunks/5361.js
 * 1,205,959 B + chunks/7677.js 471,799 B) plus the 1,205,338 B worker asset
 * webpack emitted beside them. One surviving edge keeps all of it, so the win
 * is all-or-nothing: a single door cannot be missed, nine call-site edits can.
 *
 * `ssr: false` is the part that does the work, and only it: a bare
 * `await import()` still emits the module into the server compilation (that is
 * measurably true of the dashboard's pdf-lib imports). Nothing is lost — the
 * viewer paints onto a canvas and has never rendered on the server.
 *
 * The iOS rescues are untouched: they live in `lib/pdfjs.ts` (legacy build,
 * no Promise.withResolvers) and in `PdfViewerImpl` itself.
 */

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/states";

export type { PageOverlayInfo, PageOverlayFn } from "@/components/PdfViewerImpl";

export const PdfViewer = dynamic(
  () => import("@/components/PdfViewerImpl").then(m => ({ default: m.PdfViewer })),
  {
    ssr: false,
    // The viewer opens on its own spinner while it fetches the PDF; this one
    // covers the chunk arriving first, so the two read as one wait. No status
    // text — LAW #4 keeps state in colour and icon.
    loading: () => <div className="h-full flex items-center justify-center"><Spinner size="md" /></div>,
  },
);
