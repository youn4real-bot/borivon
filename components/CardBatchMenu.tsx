"use client";

/**
 * Per-card batch control (supreme admin only) — move a candidate to another
 * batch or remove them from their batch, right from the dashboard list. Tiny
 * icon button → fixed-position dropdown (so it escapes the list's overflow).
 * Writes go through the page's onAssign (PATCH /api/portal/batches, optimistic).
 */

import { useState } from "react";
import { Boxes, Check, X as XIcon } from "lucide-react";

type Batch = { id: string; name: string; count: number };

export function CardBatchMenu({
  uid,
  currentBatchId,
  batches,
  lang,
  onAssign,
}: {
  uid: string;
  currentBatchId: string | null;
  batches: Batch[];
  lang: string;
  onAssign: (uid: string, batchId: string | null) => void;
}) {
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const open = pos !== null;

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setPos(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };

  const pick = (batchId: string | null) => {
    setPos(null);
    if ((currentBatchId ?? null) !== (batchId ?? null)) onAssign(uid, batchId);
  };

  const inBatch = !!currentBatchId;

  return (
    <>
      <button
        onClick={toggle}
        aria-label={L("Batch", "Lot", "Batch")}
        aria-expanded={open}
        title={L("Move to a batch", "Déplacer vers un lot", "In einen Batch verschieben")}
        className="w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 transition-colors"
        style={{
          color: inBatch ? "var(--gold)" : "var(--w3)",
          background: inBatch ? "var(--gdim)" : "transparent",
          border: inBatch ? "1px solid var(--border-gold)" : "none",
        }}>
        <Boxes size={14} strokeWidth={1.8} />
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-[1090]" onClick={(e) => { e.stopPropagation(); setPos(null); }} />
          <div
            className="fixed z-[1100] py-1 bv-enter"
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos!.top, right: pos!.right, minWidth: 200, maxWidth: 260, maxHeight: 320, overflowY: "auto", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}>
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--w3)" }}>
              {L("Move to batch", "Déplacer vers", "Verschieben nach")}
            </div>
            {batches.map((b) => {
              const active = b.id === currentBatchId;
              return (
                <button key={b.id} type="button" onClick={() => pick(b.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors bv-row-hover"
                  style={{ color: active ? "var(--gold)" : "var(--w)" }}>
                  <span className="flex-1 truncate">{b.name.replace(/_/g, " ")}</span>
                  {active && <Check size={13} strokeWidth={2.4} style={{ color: "var(--gold)", flexShrink: 0 }} />}
                </button>
              );
            })}
            {inBatch && (
              <>
                <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
                <button type="button" onClick={() => pick(null)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] transition-colors bv-row-hover"
                  style={{ color: "var(--danger)" }}>
                  <XIcon size={13} strokeWidth={2.2} className="flex-shrink-0" />
                  {L("Remove from batch", "Retirer du lot", "Aus Batch entfernen")}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
