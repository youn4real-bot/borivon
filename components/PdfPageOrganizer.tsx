"use client";

/**
 * PDF PAGE ORGANISER — drag pages into the right order, turn the sideways ones,
 * drop the blank sheet, save. The saved file replaces the document everywhere
 * (portal, agency Drive folder, partner API).
 *
 * Deliberately small: a thumbnail grid, drag to reorder, a turn button and a
 * remove toggle per page. Nothing else — the point is fixing a bad scan in ten
 * seconds, not building an editor.
 *
 * Thumbnails render through pdfLoadOptions (lib/pdfjs) like every other viewer
 * here: without its wasmUrl, pages built from CCITTFax scans — which is exactly
 * what a shuffled scan usually is — render blank.
 *
 * THIS IS THE ONE PLACE IN THE PORTAL THAT RUNS pdf.js ON A PHONE. Every other
 * PDF surface sends iPhones to the native engine (isIOSDevice → IosPdfFrame),
 * because an iframe cannot give us thumbnails. So it loads the library through
 * `loadPdfjs()`, which picks the legacy build and keeps the parser off a web
 * worker on iOS — see lib/pdfjs.ts for what each of those rescues.
 *
 * The scan itself is written for the weakest device that will ever run it:
 *
 *  • the grid appears as soon as the PAGE COUNT is known, and each thumbnail
 *    lands as it is drawn — a spinner that does not move for twenty seconds
 *    reads as "frozen" and gets the window closed;
 *  • ONE canvas is reused for every page and released at the end. iOS gives a
 *    tab a fixed canvas-memory budget; forty detached canvases hit it;
 *  • the loop yields between pages so WebKit can paint and reclaim;
 *  • each page is RELEASED the moment it is drawn. Measured over 296 real
 *    portal PDFs, holding them instead sums the decode down the document —
 *    p95 246 MB, worst 354 MB — where releasing makes the peak the worst SINGLE
 *    page: p95 123 MB, worst 133 MB, nothing over 150 MB (lib/pdfThumbBudget);
 *  • only pages that are ON SCREEN are drawn, after a small head start. Once
 *    each page is released, memory no longer depends on the page count — what a
 *    long document costs is TIME (2.8 s median, 20.8 s worst for ≤6 pages on a
 *    desktop CPU; a phone is several times slower). So the answer to a long
 *    document is to draw what someone is looking at, not to refuse pages past a
 *    number: every page keeps its tile, and scrolling to it draws it;
 *  • A PAGE THAT WILL NOT DRAW IS NOT A BROKEN WINDOW. The worst single page in
 *    the corpus wants 133 MB by itself, which is exactly the allocation a phone
 *    refuses — so a failed page leaves its number in place and the other pages,
 *    the ordering and the save all keep working. Only failing to learn the page
 *    count is fatal, because without it there is no list.
 *
 * And when it fails, it says WHICH step failed. One message for "the file would
 * not download", "this browser cannot run the PDF engine" and "the pages would
 * not draw" is one message too few: the first is a token, the second is a
 * phone, the third is the file, and only the person reading the screen can tell
 * us which one it was.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RotateCw, Trash2, Undo2, X as XIcon } from "lucide-react";
import { Spinner } from "@/components/ui/states";
import { currentPdfWorkerPlan, loadPdfjs, pdfLoadOptions } from "@/lib/pdfjs";
import { isIOSDevice } from "@/lib/platform";
import { createThumbQueue, eagerThumbCount, thumbScale } from "@/lib/pdfThumbBudget";

type Page = { from: number; rotate: number; removed: boolean; thumb: string | null };

/** Which step was in flight when it broke — the error text depends on it. */
type Stage = "fetch" | "engine" | "read";

/**
 * Draws its children, and reports once they have come within a screen of the
 * viewport — that is when the page behind them is worth decoding.
 *
 * Without IntersectionObserver (jsdom, ancient WebKit) it reports immediately:
 * drawing everything is the old behaviour, which works, just less sparingly.
 */
function WhenVisible({ index, onVisible, children }: {
  index: number;
  /** Must be stable (useCallback) — the observer is rebuilt when it changes. */
  onVisible: (index: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver !== "function") { onVisible(index); return; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); onVisible(index); }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [index, onVisible]);
  return <div ref={ref}>{children}</div>;
}

function SortablePage({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        cursor: "grab",
        touchAction: "none",
      }}>
      {children}
    </div>
  );
}

export function PdfPageOrganizer({
  docId, fetchUrl, accessToken, label, lang, onClose, onSaved,
}: {
  docId: string;
  /** Where the current bytes come from (same URL the preview uses). */
  fetchUrl: string;
  accessToken: string;
  label: string;
  lang: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const L = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  /** Thumbnails queued or in flight. The list is already usable while this runs. */
  const [scanning, setScanning] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  // The open document, the one canvas every page is drawn on, and the queue
  // that keeps exactly one decode in flight. All live past the load effect now,
  // because pages are drawn on demand as they scroll into view.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const queueRef = useRef(createThumbQueue());
  const blobUrlRef = useRef<string | null>(null);
  /** Pages already drawn or attempted — never decode the same page twice. */
  const takenRef = useRef<Set<number>>(new Set());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  /**
   * Draw one page's thumbnail. Queued, so only one page is ever decoded; every
   * failure stays local to the tile (see the header) — the window, the ordering
   * and the save survive a page that will not draw.
   */
  const drawPage = useCallback((index: number) => {
    if (takenRef.current.has(index)) return;
    takenRef.current.add(index);
    setScanning(n => n + 1);
    queueRef.current.push(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let page: any = null;
      try {
        const pdf = docRef.current;
        if (!pdf || cancelled.current) return;
        page = await pdf.getPage(index + 1);
        if (cancelled.current) return;
        const base = page.getViewport({ scale: 1 });
        const narrow = typeof window !== "undefined" && window.innerWidth < 520;
        const viewport = page.getViewport({ scale: thumbScale(base.width, base.height, { narrow }) });
        const canvas = canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;                       // no 2d context → number tile, not an error screen
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (cancelled.current) return;
        const thumb = canvas.toDataURL("image/jpeg", 0.65);
        setPages(prev => prev.map(p => (p.from === index ? { ...p, thumb } : p)));
      } catch (e) {
        // One page, one picture. Everything else about this document still works.
        console.error(`[pdf-organizer] page ${index + 1} would not draw:`, e);
      } finally {
        // Release the page BEFORE the next one is decoded — this is the whole
        // memory story (lib/pdfThumbBudget): it makes the peak the worst single
        // page instead of the sum of every page.
        try { page?.cleanup?.(); } catch { /* already gone */ }
        if (!cancelled.current) setScanning(n => Math.max(0, n - 1));
        // Let WebKit paint the new tile and reclaim the bitmap before the next.
        await new Promise(r => setTimeout(r, 0));
      }
    });
  }, []);

  useEffect(() => {
    cancelled.current = false;
    let stage: Stage = "fetch";
    (async () => {
      let url = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pdf: any = null;
      try {
        const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        url = URL.createObjectURL(blob);

        stage = "engine";
        const pdfjsLib = await loadPdfjs();

        stage = "read";
        pdf = await pdfjsLib.getDocument(pdfLoadOptions(url)).promise;
        if (cancelled.current) return;

        // Show the grid the moment we know how many pages there are. From here
        // on nothing is fatal: the list exists, so the window is usable even if
        // not one thumbnail ever arrives.
        const count: number = pdf.numPages;
        docRef.current = pdf;
        setPages(Array.from({ length: count }, (_, i) => ({ from: i, rotate: 0, removed: false, thumb: null })));
        setLoading(false);

        // A head start, then the rest as they scroll into view. Small on iOS,
        // which shows two tiles at a time and kills the tab rather than
        // reporting the allocation it refused.
        const head = eagerThumbCount(count, { ios: isIOSDevice() });
        for (let i = 0; i < head; i++) drawPage(i);
      } catch (e) {
        const err = e as { name?: string; message?: string } | null;
        // Always in the console with the step and the worker plan — the visible
        // text is one line; this is what a developer needs when the founder
        // forwards a screenshot from a phone nobody here can open.
        console.error(`[pdf-organizer] failed at "${stage}" (worker: ${currentPdfWorkerPlan() ?? "none"}):`, e);
        // A missing platform API surfaces as a TypeError no matter which step
        // it lands in — that is the browser, not the file.
        const kind: Stage = stage === "read" && err?.name === "TypeError" ? "engine" : stage;
        const detail = err?.name ? ` (${err.name})` : "";
        const text =
          kind === "fetch"
            ? L("Could not download this file.", "Datei konnte nicht geladen werden.", "Impossible de télécharger ce fichier.")
            : kind === "engine"
              ? L("This browser cannot open PDFs here — update it, or use a computer.",
                  "Dieser Browser kann hier keine PDFs öffnen — bitte aktualisieren oder einen Computer verwenden.",
                  "Ce navigateur ne peut pas ouvrir les PDF ici — mettez-le à jour ou utilisez un ordinateur.")
              : L("Could not read the pages of this PDF.", "Die Seiten dieses PDFs konnten nicht gelesen werden.", "Impossible de lire les pages de ce PDF.");
        if (!cancelled.current) { setError(text + detail); setLoading(false); setScanning(0); }
        // Nothing to keep open: the document never got far enough to be read.
        try { pdf?.destroy?.(); } catch { /* already gone */ }
        if (url) URL.revokeObjectURL(url);
        return;
      }
      // Success: the document and its blob URL stay alive until the window is
      // closed, because pdf.js reads from that URL every time a page scrolls
      // into view and asks to be drawn. Teardown is the cleanup below.
      blobUrlRef.current = url;
    })();
    return () => {
      cancelled.current = true;
      // Destroy the document (this is also what frees pdf.js's worker-global
      // image cache — page.cleanup() never touches that one), then the canvas
      // backing store, then the blob.
      try { docRef.current?.destroy?.(); } catch { /* already gone */ }
      docRef.current = null;
      const c = canvasRef.current;
      if (c) { c.width = 0; c.height = 0; canvasRef.current = null; }
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
      takenRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl, accessToken]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = pages.findIndex(p => String(p.from) === String(active.id));
    const to = pages.findIndex(p => String(p.from) === String(over.id));
    if (from === -1 || to === -1) return;
    setPages(arrayMove(pages, from, to));
  };

  const kept = pages.filter(p => !p.removed);
  const dirty = pages.some((p, i) => p.from !== i || p.rotate !== 0 || p.removed);

  async function save() {
    if (kept.length === 0) {
      setError(L("Keep at least one page.", "Mindestens eine Seite behalten.", "Gardez au moins une page."));
      return;
    }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/portal/admin/pdf-pages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ docId, order: kept.map(p => ({ from: p.from, rotate: p.rotate })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error || L("Could not save.", "Speichern fehlgeschlagen.", "Échec de l'enregistrement.")); return; }
      onSaved();
      onClose();
    } catch {
      setError(L("Network error.", "Netzwerkfehler.", "Erreur réseau."));
    } finally { setSaving(false); }
  }

  if (typeof window === "undefined") return null;

  const status = error
    ? error
    : scanning > 0
      ? L("Drawing pages…", "Seiten werden gezeichnet…", "Dessin des pages…")
      : `${kept.length} ${L("pages kept", "Seiten behalten", "pages gardées")}`
        + (pages.length !== kept.length ? ` · ${pages.length - kept.length} ${L("removed", "entfernt", "retirées")}` : "");

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
      onClick={() => { if (!saving) onClose(); }}>
      <div className="w-full max-w-4xl rounded-[20px] flex flex-col overflow-hidden"
        style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", maxHeight: "calc(100dvh - 58px - 96px)" }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold truncate" style={{ color: "var(--w)" }}>{label}</p>
            <p className="text-[10.5px]" style={{ color: "var(--w3)" }}>
              {L("Drag pages to reorder · turn or remove them · then save",
                 "Seiten ziehen zum Sortieren · drehen oder entfernen · dann speichern",
                 "Glissez pour réordonner · tourner ou retirer · puis enregistrer")}
            </p>
          </div>
          <button onClick={onClose} disabled={saving}
            className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full" style={{ color: "var(--w2)" }}>
            <XIcon size={15} strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          {loading ? (
            <div className="py-16 flex flex-col items-center gap-3">
              <Spinner size="sm" />
              <p className="text-[11.5px]" style={{ color: "var(--w3)" }}>
                {L("Reading pages…", "Seiten werden gelesen…", "Lecture des pages…")}
              </p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={pages.map(p => String(p.from))} strategy={rectSortingStrategy}>
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                  {pages.map((p, idx) => {
                    const position = kept.findIndex(k => k.from === p.from) + 1;
                    return (
                      <SortablePage key={p.from} id={String(p.from)}>
                        <WhenVisible index={p.from} onVisible={drawPage}>
                        <div className="rounded-xl overflow-hidden relative"
                          style={{
                            background: "var(--bg2)",
                            border: `1px solid ${p.removed ? "var(--danger-border)" : "var(--border)"}`,
                            opacity: p.removed ? 0.45 : 1,
                          }}>
                          <div className="flex items-center justify-center p-2" style={{ minHeight: 150 }}>
                            {p.thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.thumb} alt={`Seite ${p.from + 1}`}
                                style={{ maxWidth: "100%", maxHeight: 190, transform: `rotate(${p.rotate}deg)`, transition: "transform .18s var(--ease)" }} />
                            ) : (
                              // Not drawn yet, still in the queue, or a page that
                              // would not draw at all. The tile holds its place
                              // in the order either way — the number is enough
                              // to reorder by, and removing it from the list
                              // would remove the page from the file on save.
                              <span className="text-[22px] font-semibold tabular-nums" style={{ color: "var(--w3)", opacity: 0.5 }}>
                                {p.from + 1}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 px-2 py-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                            <span className="text-[10.5px] font-semibold tabular-nums flex-1"
                              style={{ color: p.removed ? "var(--danger)" : "var(--w3)" }}>
                              {p.removed
                                ? L("removed", "entfernt", "retirée")
                                : `${position} · ${L("was", "war", "était")} ${p.from + 1}`}
                            </span>
                            <button
                              onPointerDown={e => e.stopPropagation()}
                              onClick={() => setPages(prev => prev.map((x, i) => i === idx ? { ...x, rotate: (x.rotate + 90) % 360 } : x))}
                              disabled={p.removed}
                              title={L("Turn", "Drehen", "Tourner")}
                              className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full disabled:opacity-30"
                              style={{ color: "var(--w2)" }}>
                              <RotateCw size={12} strokeWidth={1.8} />
                            </button>
                            <button
                              onPointerDown={e => e.stopPropagation()}
                              onClick={() => setPages(prev => prev.map((x, i) => i === idx ? { ...x, removed: !x.removed } : x))}
                              title={p.removed ? L("Keep", "Behalten", "Garder") : L("Remove", "Entfernen", "Retirer")}
                              className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full"
                              style={{ color: p.removed ? "var(--gold)" : "var(--danger)" }}>
                              {p.removed ? <Undo2 size={12} strokeWidth={1.8} /> : <Trash2 size={12} strokeWidth={1.8} />}
                            </button>
                          </div>
                        </div>
                        </WhenVisible>
                      </SortablePage>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-[11px] flex-1" style={{ color: error ? "var(--danger)" : "var(--w3)" }}>
            {status}
          </p>
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-xl text-[12.5px] font-semibold"
            style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)", cursor: "pointer" }}>
            {L("Cancel", "Abbrechen", "Annuler")}
          </button>
          <button onClick={save} disabled={saving || loading || scanning > 0 || !dirty}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-[12.5px] font-semibold disabled:opacity-50"
            style={{ background: "var(--gold)", color: "#131312", border: "none", cursor: "pointer" }}>
            {saving && <Spinner size="xs" color="#131312" />}
            {L("Save", "Speichern", "Enregistrer")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
