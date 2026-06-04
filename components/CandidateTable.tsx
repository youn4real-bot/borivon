"use client";

/**
 * Unified candidate BOARD — the "everyone × everything in one view" surface.
 *
 * One row per candidate, one column per dimension (person, journey progress, B2,
 * documents, flags). Sort by any column → answers "who needs attention", "who's
 * furthest in B2", "who's least document-ready" in one click, no separate tabs
 * or filter pills. Click a row → the peek popup. Built on TanStack Table
 * (headless, battle-tested) — we bring our own minimal styling.
 */

import { useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  createColumnHelper, type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronUp, ChevronDown, AlertTriangle, BadgeCheck } from "lucide-react";
import { JOURNEY_PRESETS } from "@/lib/candidateJourney";
import { B2_STAGES, b2StageColor, b2StageLabel, normalizeB2Stage, B2_FAILED_COLOR } from "@/lib/b2Journey";
import { specialtyLabel } from "@/lib/nurseSpecialties";

const HEALTH_COLOR: Record<string, string> = {
  blocked: "#ef4444", overdue: "#f97316", due_soon: "#f59e0b", on_track: "#16a34a", done: "#6b7280",
};
const B2_POS: Record<string, number> = Object.fromEntries(B2_STAGES.map((s, i) => [s.key, i]));

export type TableRow = {
  userId: string; name: string; photo: string | null;
  status: { progress: number; doneCount: number; totalPresets: number; health: string; current: { key: string } | null };
  b2Stage?: string; b2Failed?: boolean;
  facts?: { specialty: string | null };
  docPack?: { collected: number; total: number };
  followUp?: { needed: boolean };
  sellable?: { sellable: boolean };
};

function initials(n: string) {
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
}

export function CandidateTable({ rows, lang, onPick }: { rows: TableRow[]; lang: string; onPick: (id: string) => void }) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(() => {
    const ch = createColumnHelper<TableRow>();
    const pl = (key: string | undefined) => {
      if (!key) return "—";
      const p = JOURNEY_PRESETS.find((x) => x.key === key);
      return p ? (p.label[(lang as "en" | "fr" | "de")] ?? p.label.en) : key;
    };
    return [
      ch.accessor((r) => r.name, {
        id: "person", header: () => T("Candidate", "Kandidat", "Candidat"),
        cell: (info) => {
          const r = info.row.original; const hc = HEALTH_COLOR[r.status.health] ?? "#6b7280";
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {r.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.photo} alt="" style={{ width: 34, height: 34, borderRadius: 999, objectFit: "cover", border: `2px solid ${hc}`, flexShrink: 0 }} />
              ) : (
                <span style={{ width: 34, height: 34, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: "var(--gdim)", color: "var(--gold)", border: `2px solid ${hc}`, flexShrink: 0 }}>{initials(r.name)}</span>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "var(--w3)" }}>{r.facts?.specialty ? specialtyLabel(r.facts.specialty, lang) : "—"}</div>
              </div>
            </div>
          );
        },
      }),
      ch.accessor((r) => r.status.progress, {
        id: "journey", header: () => T("Journey", "Reise", "Parcours"),
        cell: (info) => {
          const r = info.row.original; const hc = HEALTH_COLOR[r.status.health] ?? "#6b7280"; const pct = Math.round(r.status.progress * 100);
          return (
            <div style={{ minWidth: 130 }}>
              <div style={{ fontSize: 11.5, color: "var(--w2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160, marginBottom: 3 }}>
                {r.status.health === "done" ? T("Arrived 🇩🇪", "Angekommen 🇩🇪", "Arrivé 🇩🇪") : pl(r.status.current?.key)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--border)", overflow: "hidden", minWidth: 64 }}><div style={{ width: `${pct}%`, height: "100%", background: hc }} /></div>
                <span style={{ fontSize: 10.5, color: "var(--w3)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{r.status.doneCount}/{r.status.totalPresets}</span>
              </div>
            </div>
          );
        },
      }),
      ch.accessor((r) => B2_POS[normalizeB2Stage(r.b2Stage)] ?? 0, {
        id: "b2", header: () => T("B2 German", "B2 Deutsch", "B2 allemand"),
        cell: (info) => {
          const r = info.row.original; const s = normalizeB2Stage(r.b2Stage);
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 120 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: b2StageColor(s), flexShrink: 0, boxShadow: r.b2Failed ? `0 0 0 2px ${B2_FAILED_COLOR}` : undefined }} />
              <span style={{ fontSize: 12, color: "var(--w2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{b2StageLabel(s, lang)}</span>
            </div>
          );
        },
      }),
      ch.accessor((r) => r.docPack?.collected ?? 0, {
        id: "docs", header: () => T("Docs", "Dok.", "Docs"),
        cell: (info) => {
          const r = info.row.original;
          if (!r.docPack) return <span style={{ color: "var(--w3)" }}>—</span>;
          const pct = r.docPack.total ? Math.round((r.docPack.collected / r.docPack.total) * 100) : 0;
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 88 }}>
              <div style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--border)", overflow: "hidden", minWidth: 48 }}><div style={{ width: `${pct}%`, height: "100%", background: "var(--gold)" }} /></div>
              <span style={{ fontSize: 10.5, color: "var(--w3)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{r.docPack.collected}/{r.docPack.total}</span>
            </div>
          );
        },
      }),
      ch.accessor((r) => (r.followUp?.needed ? 2 : 0) + (r.sellable?.sellable ? 1 : 0), {
        id: "flags", header: () => T("Flags", "Flags", "Indic."),
        cell: (info) => {
          const r = info.row.original;
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              {r.followUp?.needed && <AlertTriangle size={15} style={{ color: "#f59e0b" }} aria-label={T("Needs follow-up", "Nachfassen", "À relancer")} />}
              {r.sellable?.sellable && <BadgeCheck size={15} style={{ color: "var(--gold)" }} aria-label={T("Ready to sell", "Verkaufsbereit", "Prêt")} />}
              {!r.followUp?.needed && !r.sellable?.sellable && <span style={{ color: "var(--w3)" }}>—</span>}
            </div>
          );
        },
      }),
    ];
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({
    data: rows, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="bv-card" style={{ padding: 0, overflow: "hidden" }}>
      <style>{`.bv-cand-row{transition:background .12s ease, box-shadow .12s ease}.bv-cand-row:hover{background:var(--gdim);box-shadow:inset 2px 0 0 var(--gold)}`}</style>
      {/* Header strip — count + sort hint. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--w)", letterSpacing: -0.2 }}>
          {rows.length} {rows.length === 1 ? T("candidate", "Kandidat", "candidat") : T("candidates", "Kandidaten", "candidats")}
        </span>
        <span style={{ fontSize: 11, color: "var(--w3)" }}>{T("Tap a column to sort", "Spalte tippen zum Sortieren", "Cliquez un en-tête pour trier")}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ background: "var(--bg2)" }}>
                {hg.headers.map((h) => {
                  const sort = h.column.getIsSorted();
                  return (
                    <th key={h.id} onClick={h.column.getToggleSortingHandler()}
                      style={{ textAlign: "left", padding: "10px 14px", fontSize: 10.5, fontWeight: 700, color: sort ? "var(--gold)" : "var(--w3)", textTransform: "uppercase", letterSpacing: 0.5, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sort === "asc" ? <ChevronUp size={12} /> : sort === "desc" ? <ChevronDown size={12} /> : <ArrowUpDown size={11} style={{ opacity: 0.22 }} />}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} onClick={() => onPick(row.original.userId)} className="bv-cand-row"
                style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ padding: "11px 14px", verticalAlign: "middle" }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--w3)", fontSize: 13, padding: "2rem 0" }}>{T("No candidates yet.", "Noch keine Kandidaten.", "Aucun candidat.")}</p>
      )}
    </div>
  );
}
