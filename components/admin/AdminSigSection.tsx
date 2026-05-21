"use client";

/**
 * AdminSigSection — admin's handwritten-signature uploader + crop UI
 * for the signature stamping flow (LAW #29). Used inside the admin
 * candidate panel to capture / re-use the admin's signature on signed
 * PDFs.
 *
 * Extracted from app/portal/admin/page.tsx (2026-05). Self-contained:
 *   - Props are the only dependency on the parent state.
 *   - SIG_PARTY_META stays local because no other surface uses it.
 *   - Background-removal call lives in the parent (this component only
 *     receives the data: URL via `sig` prop + `bgRemoving` flag).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Upload } from "lucide-react";

const SIG_PARTY_META = {
  admin: { accent: "#5b9bd5", bg: "rgba(91,155,213,0.08)", border: "rgba(91,155,213,0.3)", storageKey: "borivon_admin_sig" },
};

export function AdminSigSection({
  lang, sig, wantSave, bgRemoving,
  onSig, onWantSave, onUpload, onDropFile,
}: {
  lang: string;
  party?: "admin";
  sig: string | null;
  wantSave: boolean;
  bgRemoving: boolean;
  onSig: (s: string | null) => void;
  onWantSave: (v: boolean) => void;
  onUpload: () => void;
  onDropFile: (file: File) => void;
}) {
  const lbl = (en: string, fr: string, de: string) => lang === "fr" ? fr : lang === "de" ? de : en;
  const meta = SIG_PARTY_META.admin;
  const title = lbl("Your signature (Admin)", "Votre signature (Admin)", "Ihre Unterschrift (Admin)");
  const [dragOver, setDragOver] = useState(false);

  // Crop state
  const [cropMode, setCropMode]         = useState(false);
  const [cropDrag, setCropDrag]         = useState<{ sx: number; sy: number; ex: number; ey: number } | null>(null);
  const [cropDragging, setCropDragging] = useState(false);
  const cropImgRef       = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  // Saved sig — reactive so "Use Saved" always reflects the latest saved value
  const [savedSig, setSavedSig] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(meta.storageKey) : null
  );
  // Auto-sync: when sig changes and wantSave is on, persist immediately so
  // "Use Saved" on the next sign request loads the freshest sig (not a stale one).
  useEffect(() => {
    if (wantSave && sig) {
      localStorage.setItem(meta.storageKey, sig);
      setSavedSig(sig);
    }
  }, [sig, wantSave, meta.storageKey]);

  function applyCrop() {
    if (!cropDrag || !cropImgRef.current || !cropContainerRef.current || !sig) return;
    const cw = cropContainerRef.current.offsetWidth;
    const ch = cropContainerRef.current.offsetHeight;
    const img = cropImgRef.current;
    const scaleX = img.naturalWidth / cw;
    const scaleY = img.naturalHeight / ch;
    const x = Math.max(0, Math.round(Math.min(cropDrag.sx, cropDrag.ex) * scaleX));
    const y = Math.max(0, Math.round(Math.min(cropDrag.sy, cropDrag.ey) * scaleY));
    const w = Math.min(img.naturalWidth - x, Math.round(Math.abs(cropDrag.ex - cropDrag.sx) * scaleX));
    const h = Math.min(img.naturalHeight - y, Math.round(Math.abs(cropDrag.ey - cropDrag.sy) * scaleY));
    if (w < 5 || h < 5) return;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, w, h);
    onSig(canvas.toDataURL("image/png"));
    setCropMode(false); setCropDrag(null);
  }

  const cropPortal = cropMode && sig ? createPortal(
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-4"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={e => { if (e.target === e.currentTarget) { setCropMode(false); setCropDrag(null); } }}>
      <p className="text-[12px] font-semibold select-none" style={{ color: "rgba(255,255,255,0.6)" }}>
        {lbl("Drag to select crop area", "Faites glisser pour sélectionner", "Bereich ziehen zum Zuschneiden")}
      </p>
      <div ref={cropContainerRef} className="relative select-none"
        style={{ cursor: "crosshair", background: "#fff" }}
        onMouseDown={e => {
          const r = cropContainerRef.current!.getBoundingClientRect();
          const sx = e.clientX - r.left, sy = e.clientY - r.top;
          setCropDrag({ sx, sy, ex: sx, ey: sy }); setCropDragging(true);
        }}
        onMouseMove={e => {
          if (!cropDragging) return;
          const r = cropContainerRef.current!.getBoundingClientRect();
          setCropDrag(d => d ? { ...d, ex: e.clientX - r.left, ey: e.clientY - r.top } : null);
        }}
        onMouseUp={() => setCropDragging(false)}
        onMouseLeave={() => setCropDragging(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={cropImgRef} src={sig} alt="crop" draggable={false}
          style={{ display: "block", maxWidth: "80vw", maxHeight: "65vh", userSelect: "none", pointerEvents: "none" }} />
        {cropDrag && (
          <div style={{
            position: "absolute",
            left: Math.min(cropDrag.sx, cropDrag.ex), top: Math.min(cropDrag.sy, cropDrag.ey),
            width: Math.abs(cropDrag.ex - cropDrag.sx), height: Math.abs(cropDrag.ey - cropDrag.sy),
            border: "2px solid #fff", background: "rgba(255,255,255,0.08)",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)", pointerEvents: "none",
          }} />
        )}
      </div>
      <div className="flex gap-3">
        <button onClick={applyCrop}
          disabled={!cropDrag || Math.abs(cropDrag.ex - cropDrag.sx) < 5 || Math.abs(cropDrag.ey - cropDrag.sy) < 5}
          className="px-6 py-2 rounded-full text-[12.5px] font-semibold disabled:opacity-40 transition-opacity hover:opacity-80"
          style={{ background: meta.accent, color: "#fff" }}>
          {lbl("Apply crop", "Appliquer", "Zuschneiden")}
        </button>
        <button onClick={() => { setCropMode(false); setCropDrag(null); }}
          className="px-6 py-2 rounded-full text-[12.5px] font-semibold transition-opacity hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>
          {lbl("Cancel", "Annuler", "Abbrechen")}
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
    <div className="rounded-2xl p-4 space-y-3" style={{ background: meta.bg, border: `1.5px solid ${meta.border}` }}>
        <p className="text-[11.5px] font-semibold" style={{ color: meta.accent }}>
          ✍ {title}
        </p>

        {/* Upload dropzone — shown when no sig yet */}
        {!sig && (
          <>
          {savedSig && (
            <button type="button"
              onClick={() => onSig(savedSig)}
              className="w-full py-2 text-[12px] font-semibold rounded-xl transition-opacity hover:opacity-80"
              style={{ background: "rgba(91,155,213,0.14)", color: meta.accent, border: `1.5px solid ${meta.border}` }}>
              ✓ {lbl("Use saved", "Utiliser enregistrée", "Gespeicherte nutzen")}
            </button>
          )}
          <div
            onClick={() => { if (!bgRemoving) onUpload(); }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file && file.type.startsWith("image/")) onDropFile(file);
            }}
            className="rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
            style={{
              minHeight: 110,
              border: `2px dashed ${dragOver ? meta.accent : meta.border}`,
              background: dragOver ? meta.bg : "#fff",
            }}
          >
            {bgRemoving ? (
              <span className="w-5 h-5 rounded-full border-2 border-current border-t-transparent animate-spin" style={{ color: meta.accent }} />
            ) : (
              <>
                <Upload size={20} strokeWidth={1.5} style={{ color: meta.accent, opacity: 0.7 }} />
                <p className="text-[12px] text-center px-4" style={{ color: "var(--w3)" }}>
                  {lbl("Drop signature photo or click to upload", "Déposez ou cliquez pour importer", "Unterschrift ablegen oder klicken")}
                </p>
              </>
            )}
          </div>
          </>
        )}

        {/* Action buttons when sig exists */}
        {sig && !bgRemoving && (
          <div className="flex items-center gap-2 flex-wrap">
            {savedSig && sig !== savedSig && (
              <button
                type="button"
                onClick={() => onSig(savedSig)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
                style={{ background: meta.bg, color: meta.accent, border: `1px solid ${meta.border}` }}>
                {lbl("Use saved", "Utiliser enregistrée", "Gespeicherte nutzen")}
              </button>
            )}
            <button
              type="button"
              onClick={onUpload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: meta.bg, color: meta.accent, border: `1px solid ${meta.border}` }}>
              <Upload size={11} strokeWidth={2} />
              {lbl("Replace", "Remplacer", "Ersetzen")}
            </button>
            <button
              type="button"
              onClick={() => { setCropMode(true); setCropDrag(null); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: meta.bg, color: meta.accent, border: `1px solid ${meta.border}` }}>
              ✂ {lbl("Crop", "Recadrer", "Zuschneiden")}
            </button>
            <button
              type="button"
              onClick={() => onSig(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: meta.bg, color: meta.accent, border: `1px solid ${meta.border}` }}>
              ✕ {lbl("Clear", "Effacer", "Löschen")}
            </button>
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={wantSave}
            onChange={e => {
              onWantSave(e.target.checked);
              if (e.target.checked && sig) { localStorage.setItem(meta.storageKey, sig); setSavedSig(sig); }
              else if (!e.target.checked) { localStorage.removeItem(meta.storageKey); setSavedSig(null); }
            }}
            className="rounded"
            style={{ accentColor: meta.accent }}
          />
          <span className="text-[11px]" style={{ color: "var(--w3)" }}>
            {lbl("Save for next time", "Enregistrer pour la prochaine fois", "Für nächstes Mal speichern")}
          </span>
        </label>
    </div>
    {cropPortal}
    </>
  );
}
