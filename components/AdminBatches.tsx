"use client";

/**
 * Batch selector — just the pills. Picking a batch FILTERS the real candidate list
 * below (the same profile cards, with photos) to that batch's people, ordered
 * least-doc-complete first, so nothing slips. "All" clears it. No second list, no
 * second card style — the batch view IS the normal card list, filtered.
 *
 * It fetches the batch → member mapping (with doc completeness) and reports the
 * ordered member uids up via onSelect; the page drives its list from that.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type Member = { uid: string; batchId: string; pct: number };
type Batch = { id: string; name: string; count: number };
type Resp = { ok: boolean; batches: Batch[]; members: Member[] };

export function AdminBatches({
  accessToken,
  lang,
  onSelect,
}: {
  accessToken: string;
  lang: string;
  /** Ordered member uids of the picked batch (least-complete first), or null for "All". */
  onSelect: (uids: string[] | null) => void;
}) {
  const [data, setData] = useState<Resp | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  const uidsFor = (resp: Resp, batchId: string | null) =>
    batchId === null ? null : resp.members.filter((m) => m.batchId === batchId).map((m) => m.uid);

  const choose = (resp: Resp, batchId: string | null) => { setSel(batchId); onSelect(uidsFor(resp, batchId)); };

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
      onSelect(uidsFor(j, first)); // default to the first batch on entry
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (abortRef.current === ac) { setData({ ok: true, batches: [], members: [] }); onSelect(null); }
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
  if (!data || data.batches.length === 0) return null;

  const pill = (id: string | null, label: string) => {
    const active = sel === id;
    return (
      <button key={id ?? "all"} type="button" onClick={() => choose(data, id)}
        className="px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
        style={{ borderRadius: 999, border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`, background: active ? "var(--gdim)" : "transparent", color: active ? "var(--gold)" : "var(--w3)" }}>
        {label}
      </button>
    );
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {data.batches.map((b) => pill(b.id, `${b.name} ${b.count}`))}
      {pill(null, L("All", "Tous", "Alle"))}
    </div>
  );
}
