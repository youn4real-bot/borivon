"use client";

/**
 * Batch tracker — minimal, and the SINGLE candidate list when a batch is picked
 * (no double list). The founder's active Germany-track candidates live in batches;
 * this shows each batch's people with their DOCUMENT status so nothing slips. Pick
 * a batch → its candidates (as profile rows) replace the general list; pick "All" →
 * the general list returns. Click a row → open that candidate's file.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type Member = { uid: string; name: string; email: string; photo: string | null; batchId: string; missing: number; pending: number; rejected: number; pct: number };
type Batch = { id: string; name: string; count: number };
type Resp = { ok: boolean; batches: Batch[]; members: Member[] };

export function AdminBatches({
  accessToken,
  lang,
  onOpen,
  onActiveChange,
}: {
  accessToken: string;
  lang: string;
  onOpen: (uid: string) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [data, setData] = useState<Resp | null>(null);
  const [sel, setSel] = useState<string | null>(null); // batchId, or null = "All"
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  // Report whether a batch view is active (a real batch selected) so the page hides
  // its general list — one candidate list on screen at a time.
  const setSelection = (id: string | null) => { setSel(id); onActiveChange?.(id !== null); };

  const load = useCallback(async () => {
    if (!accessToken) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const r = await fetch("/api/portal/admin/batches-track", { headers: { Authorization: `Bearer ${accessToken}` }, signal: ac.signal });
      const j = (await r.json()) as Resp;
      if (abortRef.current !== ac) return;
      setData(j);
      const first = j.batches[0]?.id ?? null;
      setSel(first);
      onActiveChange?.(first !== null);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (abortRef.current === ac) { setData({ ok: true, batches: [], members: [] }); onActiveChange?.(false); }
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); return () => abortRef.current?.abort(); }, [load]);

  if (loading && !data) {
    return (
      <div className="mb-3 flex items-center gap-2 text-[12px]" style={{ color: "var(--w3)" }}>
        <Loader2 size={13} className="animate-spin" strokeWidth={2} /> {L("Loading batches…", "Chargement des lots…", "Batches werden geladen…")}
      </div>
    );
  }
  if (!data || data.batches.length === 0) return null; // no batches → stay clean, general list shows

  const status = (m: Member): { text: string; color: string } => {
    if (m.missing > 0) return { text: L(`${m.missing} missing`, `${m.missing} manquant(s)`, `${m.missing} fehlen`), color: "#ef4444" };
    if (m.rejected > 0) return { text: L(`${m.rejected} rejected`, `${m.rejected} rejeté(s)`, `${m.rejected} abgelehnt`), color: "#ef4444" };
    if (m.pending > 0) return { text: L(`${m.pending} pending`, `${m.pending} en attente`, `${m.pending} offen`), color: "#f59e0b" };
    return { text: L("complete", "complet", "vollständig"), color: "#16a34a" };
  };

  const members = sel ? data.members.filter((m) => m.batchId === sel) : [];

  const pill = (id: string | null, label: string) => {
    const active = sel === id;
    return (
      <button key={id ?? "all"} type="button" onClick={() => setSelection(id)}
        className="px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
        style={{ borderRadius: 999, border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`, background: active ? "var(--gdim)" : "transparent", color: active ? "var(--gold)" : "var(--w3)" }}>
        {label}
      </button>
    );
  };

  return (
    <div className="mb-3">
      {/* Batch pills + "All" (All returns the general list) */}
      <div className="flex flex-wrap items-center gap-1.5">
        {data.batches.map((b) => pill(b.id, `${b.name} ${b.count}`))}
        {pill(null, L("All", "Tous", "Alle"))}
      </div>

      {/* Selected batch → its candidates as profile rows (the only list on screen) */}
      {sel && (
        <div className="mt-1.5 flex flex-col">
          {members.map((m) => {
            const s = status(m);
            return (
              <button key={m.uid} type="button" onClick={() => onOpen(m.uid)}
                className="flex items-center gap-2.5 py-1.5 px-1 text-left transition-colors border-b"
                style={{ borderColor: "var(--border)" }}>
                {m.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photo} alt="" width={30} height={30} className="rounded-full object-cover" style={{ width: 30, height: 30, flexShrink: 0 }} />
                ) : (
                  <span className="inline-flex items-center justify-center rounded-full font-semibold" style={{ width: 30, height: 30, flexShrink: 0, background: "var(--card)", border: "1px solid var(--border)", color: "var(--w2)", fontSize: 12 }}>
                    {(m.name || "?").trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium truncate" style={{ color: "var(--w)" }}>{m.name}</span>
                  <span className="block text-[11px] truncate" style={{ color: "var(--w3)" }}>{m.email}</span>
                </span>
                <span className="text-[11px]" style={{ color: "var(--w3)" }}>{m.pct}%</span>
                <span className="inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap" style={{ color: s.color }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: s.color, display: "inline-block" }} />
                  {s.text}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
