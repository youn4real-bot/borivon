"use client";

/**
 * Custom PDF viewer built on pdfjs-dist (the same engine Google Drive uses).
 *
 * Two-phase zoom (matches Drive's feel):
 *  1. During a pinch, apply CSS scale to the pages wrapper around the cursor
 *     position — pure GPU work, no canvas re-paint, no layout reflow.
 *  2. 180 ms after the last wheel tick, "commit": bake the gesture multiplier
 *     into the real `scale` state so each canvas re-renders at the new
 *     resolution, then sync the scroll position so the cursor stays anchored
 *     over the same PDF point.
 *
 * Scroll anchor math:
 *   We anchor to the canvas DOM element that was under the cursor at gesture
 *   start. After commit, we clear the CSS transform, read the canvas's real
 *   layout position (getBoundingClientRect), and set scroll so that
 *   canvas-local pixel (canvas_ox × effectiveF) lands exactly under the cursor.
 *   Using the canvas element (not the wrapper) avoids the padding/gap mismatch
 *   that caused jumps: CSS transform scales everything, real layout only scales
 *   canvas pixels.
 *
 * Zero-flash canvas re-render:
 *   Canvas backing-buffer is managed manually (not via React props) so we can
 *   snapshot the old content before resize and draw it scaled as a placeholder.
 *   New pdfjs renders happen on an off-screen canvas; the result is copied in
 *   one drawImage call — the on-screen canvas never goes white.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { Spinner } from "@/components/ui/states";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfDoc = any;
type NaturalSize = { w: number; h: number };

const MIN_SCALE = 0.4;
const MAX_SCALE = 5.0;
const STEP      = 0.2;

export type PageOverlayInfo = {
  pageNum: number;     // 1-indexed
  dispW: number;       // displayed width in CSS px
  dispH: number;       // displayed height in CSS px
  rotation: number;    // total rotation applied (0/90/180/270)
  scale: number;       // current scale factor
};
export type PageOverlayFn = (info: PageOverlayInfo) => React.ReactNode;

// ─────────────────────────────────────────────────────────────────────────────
// PdfViewer
// ─────────────────────────────────────────────────────────────────────────────

export function PdfViewer({
  src,
  onRotate,
  pageOverlay,
  onPagesLoaded,
  hideRotate,
}: {
  src: string;
  /** Fired once per rotate click (always +90°). Parent persists the delta. */
  onRotate?: () => void;
  /** Render absolute-positioned content on top of each page. */
  pageOverlay?: PageOverlayFn;
  /** Fired once after PDF loads with total page count. */
  onPagesLoaded?: (count: number) => void;
  /** Hide rotate button (e.g. zone picker — rotation breaks coord mapping). */
  hideRotate?: boolean;
}) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const pagesWrapRef  = useRef<HTMLDivElement>(null);

  const scaleRef        = useRef(1.0);
  const gestureRef      = useRef(1.0); // CSS-only multiplier during a pinch

  const gestureStartRef = useRef<{
    cx: number; cy: number;          // cursor relative to container viewport
    ox: number; oy: number;          // cursor relative to wrapper (for transform-origin)
    anchorEl:  HTMLCanvasElement | null;
    canvas_ox: number; canvas_oy: number; // cursor relative to anchor canvas
  } | null>(null);

  // Stores everything useLayoutEffect needs to correct scroll after commit.
  // We use effectiveF (= finalScale / prevScale) not the raw gesture F so that
  // scale-clamping at MIN/MAX doesn't corrupt the anchor calculation.
  const pendingScrollRef = useRef<{
    effectiveF: number;
    cx: number; cy: number;
    ox: number; oy: number;
    anchorEl:  HTMLCanvasElement | null;
    canvas_ox: number; canvas_oy: number;
  } | null>(null);

  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef         = useRef(0);
  const pdfRef         = useRef<PdfDoc>(null);

  const [pdf, setPdf]             = useState<PdfDoc>(null);
  const [pageSizes, setPageSizes] = useState<NaturalSize[]>([]);
  const [intrinsicRotations, setIntrinsicRotations] = useState<number[]>([]);
  const [scale, setScale]         = useState(1.0);
  const [rotation, setRotation]   = useState(0);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);

  scaleRef.current = scale;

  // ── Load PDF + pre-fetch every page's natural size ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setPdf(null);
    setPageSizes([]);
    setIntrinsicRotations([]);
    setScale(1.0);
    setRotation(0);

    let destroy: (() => void) | null = null;

    import("pdfjs-dist").then(pdfjsLib => {
      if (cancelled) return;

      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }

      const task = pdfjsLib.getDocument({ url: src });
      destroy = () => task.destroy().catch(() => {});

      task.promise
        .then(async (doc: PdfDoc) => {
          if (cancelled) { doc.destroy(); return; }
          pdfRef.current?.destroy();
          pdfRef.current = doc;

          const sizes: NaturalSize[] = [];
          const intrinsics: number[] = [];
          for (let i = 1; i <= doc.numPages; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const page = await doc.getPage(i);
            if (cancelled) return;
            // Capture each page's intrinsic rotation so server-baked rotation
            // (set via pdf-lib setRotation) is honored when rendering.
            // naturalSize is the UNROTATED dimensions — PdfPage's isLandscape
            // logic swaps W/H based on the total rotation passed in.
            const intr = ((page.rotate ?? 0) % 360 + 360) % 360;
            intrinsics.push(intr);
            const vp = page.getViewport({ scale: 1.0, rotation: 0 });
            sizes.push({ w: vp.width, h: vp.height });
          }

          if (cancelled) return;
          setPdf(doc);
          setPageSizes(sizes);
          setIntrinsicRotations(intrinsics);
          setLoading(false);
          onPagesLoaded?.(doc.numPages);
        })
        .catch(() => {
          if (!cancelled) { setError(true); setLoading(false); }
        });
    });

    return () => { cancelled = true; destroy?.(); };
  }, [src]);

  useEffect(() => () => { pdfRef.current?.destroy(); }, []);

  // ── Trackpad pinch / ctrl-scroll zoom ──────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const applyTransform = () => {
      const wrap = pagesWrapRef.current;
      if (!wrap) return;
      wrap.style.transform  = `scale(${gestureRef.current})`;
      wrap.style.willChange = "transform";
    };

    const commit = () => {
      const start = gestureStartRef.current;
      if (!start) return;

      const rawF       = gestureRef.current;
      const prevScale  = scaleRef.current;
      const finalScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prevScale * rawF));
      // effectiveF accounts for clamping at MIN/MAX — raw F would drift if the
      // gesture tried to push past the limit.
      const effectiveF = finalScale / prevScale;

      pendingScrollRef.current = {
        effectiveF,
        cx: start.cx, cy: start.cy,
        ox: start.ox, oy: start.oy,
        anchorEl:  start.anchorEl,
        canvas_ox: start.canvas_ox,
        canvas_oy: start.canvas_oy,
      };
      gestureStartRef.current = null;
      gestureRef.current      = 1.0;

      setScale(finalScale);
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      if (!gestureStartRef.current) {
        // ── First tick of a fresh gesture ──────────────────────────────────
        const containerRect = el.getBoundingClientRect();
        const wrap = pagesWrapRef.current;
        const cx = e.clientX - containerRect.left;
        const cy = e.clientY - containerRect.top;

        // transform-origin: cursor position in wrapper-local space
        let ox = cx, oy = cy;
        if (wrap) {
          const wrapRect = wrap.getBoundingClientRect();
          ox = e.clientX - wrapRect.left;
          oy = e.clientY - wrapRect.top;
          wrap.style.transformOrigin = `${ox}px ${oy}px`;
        }

        // Anchor to the canvas element under the cursor.
        // CSS transform scales padding/gaps too but real layout doesn't, so
        // the scroll formula must be relative to the canvas, not the wrapper.
        // elementsFromPoint walks the stack — overlay divs (zone picker) sit
        // above the canvas, so plain elementFromPoint would miss it.
        const hits = document.elementsFromPoint(e.clientX, e.clientY);
        const anchorEl = (hits.find(el => el instanceof HTMLCanvasElement) as HTMLCanvasElement | undefined) ?? null;
        let canvas_ox = 0, canvas_oy = 0;
        if (anchorEl) {
          const cr = anchorEl.getBoundingClientRect();
          canvas_ox = e.clientX - cr.left;
          canvas_oy = e.clientY - cr.top;
        }

        gestureStartRef.current = { cx, cy, ox, oy, anchorEl, canvas_ox, canvas_oy };
      }

      const curVisual  = scaleRef.current * gestureRef.current;
      const factor     = Math.exp(-e.deltaY * 0.01);
      const nextVisual = Math.max(MIN_SCALE, Math.min(MAX_SCALE, curVisual * factor));
      if (nextVisual === curVisual) return;

      gestureRef.current = nextVisual / scaleRef.current;

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(applyTransform);

      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      commitTimerRef.current = setTimeout(commit, 180);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Scroll correction after scale commits ───────────────────────────────────
  // Runs after React's commit phase (canvas CSS sizes updated) but before paint.
  // We clear the CSS transform first so getBoundingClientRect is layout-accurate,
  // then anchor scroll so the cursor stays over the same canvas pixel.
  useLayoutEffect(() => {
    if (!pendingScrollRef.current) return;
    const el   = containerRef.current;
    const wrap = pagesWrapRef.current;
    if (!el || !wrap) { pendingScrollRef.current = null; return; }

    const { effectiveF, cx, cy, ox, oy, anchorEl, canvas_ox, canvas_oy } =
      pendingScrollRef.current;
    pendingScrollRef.current = null;

    // Clear transform first — makes getBoundingClientRect reflect real layout.
    wrap.style.transform       = "";
    wrap.style.transformOrigin = "";
    wrap.style.willChange      = "";

    const containerRect = el.getBoundingClientRect();

    if (anchorEl) {
      // Canvas-pixel anchor (most accurate).
      // The PDF point at canvas-local (canvas_ox, canvas_oy) at old scale is
      // now at canvas-local (canvas_ox × effectiveF, canvas_oy × effectiveF).
      // Convert canvas viewport position to scroll-space, add scaled offset,
      // subtract cursor-in-container → target scroll.
      const cr        = anchorEl.getBoundingClientRect();
      const canvas_sx = cr.left - containerRect.left + el.scrollLeft;
      const canvas_sy = cr.top  - containerRect.top  + el.scrollTop;
      el.scrollLeft   = Math.max(0, canvas_sx + canvas_ox * effectiveF - cx);
      el.scrollTop    = Math.max(0, canvas_sy + canvas_oy * effectiveF - cy);
    } else {
      // Fallback: wrapper-relative (small error from non-scaling padding/gap).
      const wrapRect = wrap.getBoundingClientRect();
      el.scrollLeft  = Math.max(0, wrapRect.left - containerRect.left + el.scrollLeft + ox * effectiveF - cx);
      el.scrollTop   = Math.max(0, wrapRect.top  - containerRect.top  + el.scrollTop  + oy * effectiveF - cy);
    }
  }, [scale]);

  const zoomOut = () => setScale(s => Math.max(MIN_SCALE, Math.round((s - STEP) * 10) / 10));
  const zoomIn  = () => setScale(s => Math.min(MAX_SCALE, Math.round((s + STEP) * 10) / 10));
  const rotate  = () => {
    setRotation(r => (r + 90) % 360);
    onRotate?.();
  };

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", background: "#525659" }}>

      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain" }}
      >
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Spinner size="md" />
          </div>
        )}
        {!loading && error && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Preview not available</p>
          </div>
        )}
        {!loading && !error && pdf && pageSizes.length > 0 && (
          <div ref={pagesWrapRef} style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "16px 12px 96px",
            gap: 12,
            width: "fit-content",
            minWidth: "100%",
            margin: "0 auto",
          }}>
            {pageSizes.map((size, i) => (
              <PdfPage
                key={i}
                pdf={pdf}
                pageNum={i + 1}
                naturalSize={size}
                scale={scale}
                rotation={(rotation + (intrinsicRotations[i] ?? 0)) % 360}
                overlay={pageOverlay}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Toolbar ── */}
      {!loading && !error && pdf && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: "6px 8px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
            whiteSpace: "nowrap",
          }}
        >
          <ToolBtn onClick={zoomOut} label="Zoom out"><ZoomOut size={15} strokeWidth={1.8} /></ToolBtn>
          <span style={{ fontSize: 11, fontWeight: 600, minWidth: 38, textAlign: "center", color: "var(--w3)", userSelect: "none" }}>
            {Math.round(scale * 100)}%
          </span>
          <ToolBtn onClick={zoomIn} label="Zoom in"><ZoomIn size={15} strokeWidth={1.8} /></ToolBtn>
          {!hideRotate && (
            <>
              <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} />
              <ToolBtn onClick={rotate} label="Rotate"><RotateCw size={15} strokeWidth={1.8} /></ToolBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ToolBtn
// ─────────────────────────────────────────────────────────────────────────────

function ToolBtn({
  onClick, label, children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 32, height: 32,
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "none", background: "transparent", borderRadius: 8,
        color: "var(--w2)", cursor: "pointer", transition: "background 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg2)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PdfPage
// ─────────────────────────────────────────────────────────────────────────────

function PdfPage({
  pdf, pageNum, naturalSize, scale, rotation, overlay,
}: {
  pdf: PdfDoc;
  pageNum: number;
  naturalSize: NaturalSize;
  scale: number;
  rotation: number;
  overlay?: PageOverlayFn;
}) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [dpr] = useState(() =>
    typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1,
  );

  const isLandscape = ((rotation / 90) | 0) % 2 === 1;
  const baseW = isLandscape ? naturalSize.h : naturalSize.w;
  const baseH = isLandscape ? naturalSize.w : naturalSize.h;
  const dispW = Math.round(baseW * scale);
  const dispH = Math.round(baseH * scale);
  const canvW = Math.round(dispW * dpr);
  const canvH = Math.round(dispH * dpr);

  // ── Manual canvas sizing with snapshot preservation ─────────────────────
  // We do NOT pass width/height as React props so React never clears the
  // canvas backing buffer. Instead we resize here, snapshot the old pixels
  // first and draw them scaled — the canvas never goes blank/white while the
  // async pdfjs re-render is in flight.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width === canvW && canvas.height === canvH) return;

    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0 || canvas.height === 0) {
      // First mount or degenerate — just set dimensions.
      canvas.width  = canvW;
      canvas.height = canvH;
      return;
    }

    // Copy current content before resize clears the backing buffer.
    const snap = document.createElement("canvas");
    snap.width  = canvas.width;
    snap.height = canvas.height;
    snap.getContext("2d")!.drawImage(canvas, 0, 0);

    canvas.width  = canvW;
    canvas.height = canvH;

    // Draw scaled snapshot as placeholder — better than blank white while the
    // new pdfjs render completes asynchronously.
    ctx.drawImage(snap, 0, 0, canvW, canvH);
  }, [canvW, canvH]);

  // ── Off-screen render → atomic swap ────────────────────────────────────
  // Render to a hidden canvas, then copy in one drawImage call so the
  // on-screen canvas never shows a white-flash mid-render (the "shuttle").
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdf.getPage(pageNum).then((page: any) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: scale * dpr, rotation });

      const offscreen    = document.createElement("canvas");
      offscreen.width  = canvW;
      offscreen.height = canvH;
      const offCtx = offscreen.getContext("2d");
      if (!offCtx || cancelled) return;

      renderTaskRef.current?.cancel();
      const task = page.render({ canvasContext: offCtx, viewport });
      renderTaskRef.current = task;

      task.promise.then(() => {
        if (cancelled) return;
        const c   = canvasRef.current;
        const ctx = c?.getContext("2d");
        // Guard against a scale change that happened while we were rendering.
        if (!c || !ctx || c.width !== canvW || c.height !== canvH) return;
        // Atomic copy — no intermediate white frame.
        ctx.drawImage(offscreen, 0, 0);
      }).catch(() => {});
    });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pdf, pageNum, scale, rotation, dpr, canvW, canvH]);

  const overlayNode = overlay?.({ pageNum, dispW, dispH, rotation, scale });

  return (
    <div style={{ position: "relative", width: dispW, height: dispH }}>
      <canvas
        ref={canvasRef}
        // width / height intentionally omitted — managed by useLayoutEffect above.
        style={{
          display: "block",
          width:  `${dispW}px`,
          height: `${dispH}px`,
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          borderRadius: 2,
        }}
      />
      {overlayNode != null && (
        <div style={{ position: "absolute", inset: 0 }}>
          {overlayNode}
        </div>
      )}
    </div>
  );
}
