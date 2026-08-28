"use client";

/**
 * ADVANCED FILTERS — a Booking.com-style faceted filter, deterministic (no AI).
 * A button (with an active-count badge) opens a modal: facet groups with live
 * per-option counts on the left, the matching real candidates on the right. Tick
 * boxes, watch the count update, click a candidate to open their dossier.
 *
 * All computation is server-side + org-scoped (POST /api/portal/admin/facets).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X as XIcon, ChevronDown, Loader2, SearchX } from "lucide-react";

type Hit = { uid: string; name: string; email: string; photo: string | null; sub: string; stageColor: string; pendingDocs: number };
type FacetOption = { key: string; label: string; count: number; selected: boolean };
type FacetGroup = { key: string; label: string; options: FacetOption[] };
type FacetResult = { ok: boolean; groups: FacetGroup[]; results: Hit[]; total: number; shown: number };
type Selection = Record<string, string[]>;

export function AdminAdvancedFilters({
  accessToken,
  lang,
  onOpen,
}: {
  accessToken: string;
  lang: string;
  onOpen: (uid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>({});
  const [data, setData] = useState<FacetResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);

  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);
  const activeCount = Object.values(selection).reduce((n, arr) => n + arr.length, 0);

  const fetchFacets = useCallback(async (sel: Selection) => {
    if (!accessToken) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const r = await fetch("/api/portal/admin/facets", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ selection: sel, lang }),
        signal: ac.signal,
      });
      const j = (await r.json()) as FacetResult;
      if (abortRef.current === ac) setData(j);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (abortRef.current === ac) setData({ ok: true, groups: [], results: [], total: 0, shown: 0 });
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }, [accessToken, lang]);

  // Load whenever the modal is open and the selection changes.
  useEffect(() => {
    if (!open) return;
    void fetchFacets(selection);
    return () => abortRef.current?.abort();
  }, [open, selection, fetchFacets]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = (groupKey: string, optKey: string) => {
    setSelection((prev) => {
      const cur = prev[groupKey] ?? [];
      const next = cur.includes(optKey) ? cur.filter((k) => k !== optKey) : [...cur, optKey];
      const out = { ...prev };
      if (next.length) out[groupKey] = next; else delete out[groupKey];
      return out;
    });
  };
  const clearAll = () => setSelection({});
  const openCandidate = (uid: string) => { setOpen(false); onOpen(uid); };

  return (
    <>
      {/* The button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold transition-colors"
        style={{
          borderRadius: 10,
          border: `1px solid ${activeCount > 0 ? "var(--border-gold)" : "var(--border)"}`,
          background: activeCount > 0 ? "var(--gdim)" : "var(--card)",
          color: activeCount > 0 ? "var(--gold)" : "var(--w2)",
        }}
      >
        <SlidersHorizontal size={13} strokeWidth={2} />
        {L("Advanced filters", "Filtres avancés", "Erweiterte Filter")}
        {activeCount > 0 && (
          <span className="px-1.5 rounded-full text-[10px] font-bold" style={{ background: "var(--gold)", color: "#1a1205" }}>{activeCount}</span>
        )}
      </button>

      {/* The modal (LAW #36 popup pattern) */}
      {open && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center p-3"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full flex flex-col overflow-hidden"
            style={{ maxWidth: 880, maxHeight: "88vh", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <SlidersHorizontal size={16} strokeWidth={2} style={{ color: "var(--gold)" }} />
              <span className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>{L("Advanced filters", "Filtres avancés", "Erweiterte Filter")}</span>
              <span className="text-[12.5px] font-semibold" style={{ color: "var(--gold)" }}>
                {loading
                  ? "…"
                  : data
                    ? (data.total === 1 ? L("1 candidate", "1 candidat", "1 Kandidat") : L(`${data.total} candidates`, `${data.total} candidats`, `${data.total} Kandidaten`))
                    : ""}
              </span>
              {activeCount > 0 && (
                <button type="button" onClick={clearAll} className="text-[11.5px] font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--w2)", border: "1px solid var(--border)" }}>
                  {L("Clear all", "Tout effacer", "Alle löschen")}
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label={L("Close", "Fermer", "Schließen")} className="ml-auto p-1 rounded-md opacity-70 hover:opacity-100" style={{ color: "var(--w2)" }}>
                <XIcon size={18} strokeWidth={2} />
              </button>
            </div>

            {/* Body: facets (left) + results (right) */}
            <div className="flex flex-col sm:flex-row min-h-0 flex-1">
              {/* Facets */}
              <div className="sm:w-[46%] overflow-y-auto p-3" style={{ borderRight: "1px solid var(--border)" }}>
                {!data && loading && (
                  <div className="flex items-center gap-2 text-[12.5px] py-4" style={{ color: "var(--w3)" }}>
                    <Loader2 size={14} className="animate-spin" strokeWidth={2} /> {L("Loading filters…", "Chargement…", "Lädt…")}
                  </div>
                )}
                {data?.groups.map((g) => {
                  const isCollapsed = collapsed[g.key];
                  const selInGroup = (selection[g.key] ?? []).length;
                  return (
                    <div key={g.key} className="mb-2">
                      <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))} className="w-full flex items-center gap-1.5 py-1 text-left">
                        <ChevronDown size={13} strokeWidth={2.4} style={{ color: "var(--w3)", transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform .12s" }} />
                        <span className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--w2)" }}>{g.label}</span>
                        {selInGroup > 0 && <span className="text-[10px] font-bold px-1.5 rounded-full" style={{ background: "var(--gold)", color: "#1a1205" }}>{selInGroup}</span>}
                      </button>
                      {!isCollapsed && (
                        <div className="flex flex-col gap-0.5 pl-1 pb-1">
                          {g.options.map((o) => (
                            <button
                              key={o.key}
                              type="button"
                              onClick={() => toggle(g.key, o.key)}
                              className="flex items-center gap-2 px-1.5 py-1 text-left rounded-md transition-colors"
                              style={{ background: o.selected ? "var(--gdim)" : "transparent" }}
                            >
                              <span
                                className="inline-flex items-center justify-center flex-shrink-0"
                                style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${o.selected ? "var(--gold)" : "var(--border)"}`, background: o.selected ? "var(--gold)" : "transparent" }}
                              >
                                {o.selected && <span style={{ color: "#1a1205", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                              </span>
                              <span className="text-[12.5px] flex-1 min-w-0 truncate" style={{ color: o.selected ? "var(--w)" : "var(--w2)" }}>{o.label}</span>
                              <span className="text-[11px] tabular-nums" style={{ color: "var(--w3)" }}>{o.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Results */}
              <div className="sm:w-[54%] overflow-y-auto p-3">
                {data && data.results.length === 0 && !loading ? (
                  <div className="flex items-center gap-2 py-6 text-[12.5px]" style={{ color: "var(--w3)" }}>
                    <SearchX size={15} strokeWidth={1.8} />
                    {L("No candidates match these filters.", "Aucun candidat pour ces filtres.", "Keine Treffer für diese Filter.")}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {(data?.results ?? []).map((h) => (
                      <button
                        key={h.uid}
                        type="button"
                        onClick={() => openCandidate(h.uid)}
                        className="flex items-center gap-2.5 p-2 text-left transition-colors"
                        style={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)" }}
                      >
                        {h.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={h.photo} alt="" width={32} height={32} className="rounded-full object-cover" style={{ width: 32, height: 32, flexShrink: 0 }} />
                        ) : (
                          <span className="inline-flex items-center justify-center rounded-full font-semibold" style={{ width: 32, height: 32, flexShrink: 0, background: "var(--bg2)", border: `2px solid ${h.stageColor}`, color: "var(--w2)", fontSize: 12 }}>
                            {(h.name || "?").trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold truncate" style={{ color: "var(--w)" }}>{h.name}</span>
                            {h.pendingDocs > 0 && <span className="px-1.5 rounded-full text-[9.5px] font-bold" style={{ background: "#f59e0b", color: "#1a1205", flexShrink: 0 }}>{h.pendingDocs}</span>}
                          </span>
                          {h.sub && <span className="block text-[11px] truncate" style={{ color: "var(--w3)" }}>{h.sub}</span>}
                        </span>
                      </button>
                    ))}
                    {data && data.total > data.shown && (
                      <span className="py-1 text-[11px]" style={{ color: "var(--w3)" }}>
                        {L(`Showing ${data.shown} of ${data.total} — narrow the filters to see the rest.`, `${data.shown} sur ${data.total} — affinez les filtres.`, `${data.shown} von ${data.total} — Filter verfeinern.`)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
