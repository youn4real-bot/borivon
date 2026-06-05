"use client";

/**
 * Pipeline funnel — a bird's-eye read of WHERE everyone sits. One bar per
 * journey station = how many candidates are currently at it (their next
 * not-done step), with the chase count (⏳ stuck) surfaced in red so the
 * bottlenecks pop. Read-only overview; click a person on the Board/Map to act.
 */

import { useMemo, type CSSProperties } from "react";
import { SEQUENTIAL_PRESETS } from "@/lib/candidateJourney";

type FunnelRow = {
  status: { current: { key: string } | null; health: string };
  stuck?: { stuck: boolean };
};

export function PipelineFunnel({ rows, lang }: { rows: FunnelRow[]; lang: string }) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const presets = useMemo(() => SEQUENTIAL_PRESETS.slice().sort((a, b) => a.position - b.position), []);

  const { buckets, doneCount, maxCount, stuckTotal } = useMemo(() => {
    const b = new Map<string, { count: number; stuck: number }>();
    for (const p of presets) b.set(p.key, { count: 0, stuck: 0 });
    let done = 0;
    let stuckT = 0;
    for (const r of rows) {
      if (r.stuck?.stuck) stuckT++;
      if (r.status.health === "done" || !r.status.current) { done++; continue; }
      const e = b.get(r.status.current.key);
      if (e) { e.count++; if (r.stuck?.stuck) e.stuck++; }
    }
    const max = Math.max(1, done, ...[...b.values()].map((v) => v.count));
    return { buckets: b, doneCount: done, maxCount: max, stuckTotal: stuckT };
  }, [rows, presets]);

  const track: CSSProperties = { flex: 1, height: 24, borderRadius: 7, background: "var(--bg2)", border: "1px solid var(--border)", overflow: "hidden", position: "relative" };
  const lbl: CSSProperties = { width: 170, flexShrink: 0, fontSize: 12, lineHeight: 1.2 };
  const num: CSSProperties = { position: "absolute", left: 9, top: 0, height: "100%", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "var(--w)" };

  const Bar = ({ count, stuck, color }: { count: number; stuck: number; color: string }) => (
    <div style={track}>
      <div style={{ width: `${Math.round((count / maxCount) * 100)}%`, height: "100%", background: color, transition: "width .35s var(--ease-out)" }} />
      <span style={num}>
        {count}
        {stuck > 0 && <span style={{ color: "#ef4444", fontWeight: 800 }}>⏳{stuck}</span>}
      </span>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-semibold" style={{ color: "var(--w3)" }}>
          {T("Where everyone sits", "Wo alle stehen", "Où en est chacun")}
        </span>
        {stuckTotal > 0 && (
          <span className="text-[11.5px] font-bold inline-flex items-center gap-1" style={{ color: "#ef4444" }}>
            ⏳ {stuckTotal} {T("to chase", "nachhaken", "à relancer")}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {presets.map((p) => {
          const e = buckets.get(p.key)!;
          return (
            <div key={p.key} className="flex items-center gap-3">
              <span className="truncate" style={{ ...lbl, color: e.count ? "var(--w2)" : "var(--w3)", fontWeight: e.count ? 600 : 400 }}>
                {p.label[(lang as "en" | "fr" | "de")] ?? p.label.en}
              </span>
              <Bar count={e.count} stuck={e.stuck} color="color-mix(in srgb, var(--gold) 32%, transparent)" />
            </div>
          );
        })}
        <div className="flex items-center gap-3 pt-2 mt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="truncate font-semibold" style={{ ...lbl, color: "var(--success)" }}>🎉 {T("Arrived", "Angekommen", "Arrivés")}</span>
          <Bar count={doneCount} stuck={0} color="color-mix(in srgb, var(--success) 32%, transparent)" />
        </div>
      </div>
    </div>
  );
}
