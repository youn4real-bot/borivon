"use client";

/**
 * In-browser DOCX preview.
 *
 * Browsers can't render .docx natively. We use mammoth.js to convert the
 * file's ArrayBuffer to HTML on the client (no server round-trip), then drop
 * the result into a styled scrollable container. Mammoth supports modern
 * .docx; older .doc binaries are not supported (callers should fall back to
 * "download to view" for .doc).
 *
 * Mammoth is dynamically imported so the ~500 KB library is only fetched the
 * first time a candidate or admin previews a Word document.
 *
 * Props:
 *   src — blob URL (created by the parent from the authenticated fetch)
 */

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/states";
import { Download } from "lucide-react";
import { ZoomPanRotateViewer } from "@/components/ZoomPanRotateViewer";

export function DocxViewer({ src, fileName }: { src: string; fileName: string }) {
  const [html, setHtml]       = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);

    (async () => {
      try {
        const blob = await fetch(src).then(r => r.blob());
        const arrayBuffer = await blob.arrayBuffer();
        // Dynamic import so the mammoth + dompurify bundles are only fetched on demand
        const [mammoth, DOMPurify] = await Promise.all([
          import("mammoth/mammoth.browser"),
          import("isomorphic-dompurify"),
        ]);
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        // SECURITY: mammoth output is NOT sanitized — a crafted .docx can
        // produce <a href="javascript:…">, dangerous attrs, etc. Run every
        // converted document through DOMPurify (battle-tested OSS) before
        // injecting via dangerouslySetInnerHTML.
        const safeHtml = DOMPurify.default.sanitize(result.value || "", {
          FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style", "link", "meta"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur",
                        "onchange", "onsubmit", "onkeydown", "onkeyup", "onkeypress",
                        "onmouseenter", "onmouseleave", "formaction", "srcdoc"],
        });
        setHtml(safeHtml || "<p style='opacity:.7'>(empty document)</p>");
      } catch (err) {
        if (cancelled) return;
        console.error("[DocxViewer] convert failed:", err);
        setError("Could not render preview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [src]);

  if (loading) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#525659" }}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !html) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#525659", color: "#fff", padding: "1rem", textAlign: "center" }}>
        <p className="text-[14px] font-semibold mb-2">{error ?? "Preview not available"}</p>
        <p className="text-[12.5px] opacity-80 mb-4">Download the file to open it in your default app.</p>
        <a href={src} download={fileName}
          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold"
          style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)" }}>
          <Download size={13} strokeWidth={1.8} /> Download
        </a>
      </div>
    );
  }

  return (
    <ZoomPanRotateViewer minScale={1}>
      {/* Letter-shaped page so it feels like a real Word doc */}
      <div
        className="bv-docx-page"
        style={{
          width: "780px",
          maxWidth: "90vw",
          maxHeight: "85vh",
          overflow: "auto",
          background: "#fff",
          color: "#1a1a1a",
          padding: "2.5rem 3rem",
          borderRadius: "4px",
          boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
          fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif",
          fontSize: "11pt",
          lineHeight: 1.55,
        }}
        // HTML is DOMPurify-sanitized at the conversion step above (mammoth
        // output is otherwise NOT sanitized — see comment in useEffect).
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style>{`
        .bv-docx-page p              { margin: 0 0 8pt; }
        .bv-docx-page h1             { font-size: 18pt; font-weight: 700; margin: 12pt 0 6pt; }
        .bv-docx-page h2             { font-size: 14pt; font-weight: 700; margin: 10pt 0 4pt; }
        .bv-docx-page h3             { font-size: 12pt; font-weight: 700; margin: 8pt 0 4pt; }
        .bv-docx-page ul, .bv-docx-page ol { margin: 0 0 8pt 22pt; }
        .bv-docx-page li             { margin: 0 0 3pt; }
        .bv-docx-page table          { border-collapse: collapse; margin: 6pt 0; }
        .bv-docx-page td, .bv-docx-page th { border: 1px solid #c8ccd1; padding: 4px 8px; }
        .bv-docx-page img            { max-width: 100%; height: auto; }
        .bv-docx-page a              { color: #1d5cb8; text-decoration: underline; }
      `}</style>
    </ZoomPanRotateViewer>
  );
}
