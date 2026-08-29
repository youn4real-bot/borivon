"use client";

/**
 * Batch tracker — minimal. The founder's active Germany-track candidates live in
 * batches; this shows, on entry, each batch's people and their DOCUMENT status so
 * nothing slips. Pick a batch (pills), scan the doc status, click to open the file.
 * No cards, no chrome — one strip.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type Member = { uid: string; name: string; batchId: string; missing: number; pending: number; rejected: number; pct: number };
type Batch = { id: string; name: string; count: number };
type Resp = { ok: boolean; batches: Batch[]; members: Member[] };

export function AdminBatches({ accessToken, lang, onOpen }: { accessToken: string; lang: string; onOpen: (uid: string) => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

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
      setSel((s) => s ?? j.batches[0]?.id ?? null);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (abortRef.current === ac) setData({ ok: true, batches: [], members: [] });
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void load(); return () => abortRef.current?.abort(); }, [load]);

  if (loading && !data) {
    return (
      <div className="mb-3 flex items-center gap-2 text-[12px]" style={{ color: "var(--w3)" }}>
        <Loader2 size={13} className="animate-spin" strokeWidth={2} /> {L("Loading batches…", "Chargement des lots…", "Batches werden geladen…")}
      </div>
    );
  }
  if (!data || data.batches.length === 0) return null; // nothing to show → stay clean

  const status = (m: Member): { text: string; color: string } => {
    if (m.missing > 0) return { text: L(`${m.missing} missing`, `${m.missing} manquant(s)`, `${m.missing} fehlen`), color: "#ef4444" };
    if (m.rejected > 0) return { text: L(`${m.rejected} rejected`, `${m.rejected} rejeté(s)`, `${m.rejected} abgelehnt`), color: "#ef4444" };
    if (m.pending > 0) return { text: L(`${m.pending} pending`, `${m.pending} en attente`, `${m.pending} offen`), color: "#f59e0b" };
    return { text: L("complete", "complet", "vollständig"), color: "#16a34a" };
  };

  const members = data.members.filter((m) => m.batchId === sel);

  return (
    <div className="mb-3">
      {/* Batch pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {data.batches.map((b) => {
          const active = b.id === sel;
          return (
            <button key={b.id} type="button" onClick={() => setSel(b.id)}
              className="px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
              style={{ borderRadius: 999, border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`, background: active ? "var(--gdim)" : "transparent", color: active ? "var(--gold)" : "var(--w3)" }}>
              {b.name} <span style={{ opacity: 0.7 }}>{b.count}</span>
            </button>
          );
        })}
      </div>

      {/* Members of the selected batch with document status */}
      <div className="mt-1.5 flex flex-col">
        {members.map((m) => {
          const s = status(m);
          return (
            <button key={m.uid} type="button" onClick={() => onOpen(m.uid)}
              className="flex items-center gap-2 py-1.5 px-1 text-left transition-colors border-b"
              style={{ borderColor: "var(--border)" }}>
              <span className="flex-1 min-w-0 text-[13px] truncate" style={{ color: "var(--w)" }}>{m.name}</span>
              <span className="text-[11px]" style={{ color: "var(--w3)" }}>{m.pct}%</span>
              <span className="inline-flex items-center gap-1 text-[11.5px] whitespace-nowrap" style={{ color: s.color }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: s.color, display: "inline-block" }} />
                {s.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
