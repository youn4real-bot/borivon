"use client";

/**
 * THE DOOR TO THE DOCX PREVIEW — the viewer itself is `DocxViewerImpl`.
 *
 * Same shape as components/PdfViewer.tsx, and the same reason. `DocxViewerImpl`
 * converts a Word file to HTML with mammoth, in the browser, from a blob URL
 * the parent already fetched — there is nothing it could ever render on the
 * server. But it is imported statically by AdminDocPreviewModal and by the
 * candidate dashboard, both "use client" pages that Next compiles a SECOND
 * time for SSR, so mammoth rode into the Cloudflare Worker script:
 * MEASURED at chunks/7733.js, 490,276 B of the server build.
 *
 * Its `import("mammoth/mammoth.browser")` being lazy already is NOT enough —
 * that only decides when the browser fetches it. An async edge is still an
 * edge, and webpack emits the module into the server compilation all the same.
 * `ssr: false` is what removes it from that graph.
 *
 * The fallback is the same spinner the viewer shows while it converts, so the
 * chunk arriving and the conversion read as one wait.
 */

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui/states";

export const DocxViewer = dynamic(
  () => import("@/components/DocxViewerImpl").then(m => ({ default: m.DocxViewer })),
  {
    ssr: false,
    loading: () => <div className="h-full flex items-center justify-center"><Spinner size="md" /></div>,
  },
);
