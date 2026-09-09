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
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, closestCenter, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RotateCw, Trash2, Undo2, X as XIcon } from "lucide-react";
import { Spinner } from "@/components/ui/states";
import { pdfLoadOptions } from "@/lib/pdfjs";

type Page = { from: number; rotate: number; removed: boolean; thumb: string | null };

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    cancelled.current = false;
    (async () => {
      try {
        const res = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new Error("load");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const pdfjsLib = await import("pdfjs-dist");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url,
          ).toString();
        }
        const pdf = await pdfjsLib.getDocument(pdfLoadOptions(url)).promise;
        const out: Page[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled.current) break;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(220 / base.width, 300 / base.height);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (ctx) await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          out.push({ from: i - 1, rotate: 0, removed: false, thumb: canvas.toDataURL("image/jpeg", 0.7) });
        }
        URL.revokeObjectURL(url);
        if (!cancelled.current) { setPages(out); setLoading(false); }
      } catch {
        if (!cancelled.current) { setError(L("Could not open this PDF.", "PDF konnte nicht geöffnet werden.", "Impossible d'ouvrir ce PDF.")); setLoading(false); }
      }
    })();
    return () => { cancelled.current = true; };
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
                        <div className="rounded-xl overflow-hidden relative"
                          style={{
                            background: "var(--bg2)",
                            border: `1px solid ${p.removed ? "var(--danger-border)" : "var(--border)"}`,
                            opacity: p.removed ? 0.45 : 1,
                          }}>
                          <div className="flex items-center justify-center p-2" style={{ minHeight: 150 }}>
                            {p.thumb && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.thumb} alt={`Seite ${p.from + 1}`}
                                style={{ maxWidth: "100%", maxHeight: 190, transform: `rotate(${p.rotate}deg)`, transition: "transform .18s var(--ease)" }} />
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
            {error ?? `${kept.length} ${L("pages kept", "Seiten behalten", "pages gardées")}${pages.length !== kept.length ? ` · ${pages.length - kept.length} ${L("removed", "entfernt", "retirées")}` : ""}`}
          </p>
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 rounded-xl text-[12.5px] font-semibold"
            style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)", cursor: "pointer" }}>
            {L("Cancel", "Abbrechen", "Annuler")}
          </button>
          <button onClick={save} disabled={saving || loading || !dirty}
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
