"use client";

/**
 * "NEEDS YOU" — the proactive triage panel pinned to the top of the admin
 * dashboard. It answers "is everything okay / what needs me" the moment the page
 * loads, so the founder stops searching and guessing. Every line is a real,
 * in-scope candidate (GET /api/portal/admin/needs, scoped server-side); clicking
 * one opens their dossier.
 *
 * Since the Telegram bot is muted, THIS is the push channel — it's simply there
 * when he looks, no pinging.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, RotateCw, ChevronDown, Check, Loader2 } from "lucide-react";

type NeedItem = { uid: string; name: string; detail: string };
type NeedGroup = { key: string; label: string; tone: "red" | "orange" | "gold" | "blue" | "neutral"; items: NeedItem[]; overflow: number };
type NeedsResponse = { ok: boolean; groups: NeedGroup[]; total: number };

const TONE: Record<NeedGroup["tone"], string> = {
  red: "#ef4444",
  orange: "#f59e0b",
  gold: "var(--gold)",
  blue: "#3b82f6",
  neutral: "var(--w3)",
};

export function AdminNeedsPanel({
  accessToken,
  lang,
  onOpen,
}: {
  accessToken: string;
  lang: string;
  onOpen: (uid: string) => void;
}) {
  const [data, setData] = useState<NeedsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);

  const L = (en: string, fr: string, de: string) => (lang === "fr" ? fr : lang === "de" ? de : en);

  const load = useCallback(async () => {
    if (!accessToken) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/admin/needs?lang=${encodeURIComponent(lang)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: ac.signal,
      });
      if (!r.ok) { if (abortRef.current === ac) setData({ ok: true, groups: [], total: 0 }); return; }
      const j = (await r.json()) as NeedsResponse;
      if (abortRef.current === ac) setData(j);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (abortRef.current === ac) setData({ ok: true, groups: [], total: 0 });
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }, [accessToken, lang]);

  useEffect(() => { void load(); return () => abortRef.current?.abort(); }, [load]);

  // First load: a quiet skeleton, so nothing jumps.
  if (loading && !data) {
    return (
      <div className="mb-3 flex items-center gap-2 px-3 py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--w3)" }}>
        <Loader2 size={14} className="animate-spin" strokeWidth={2} />
        <span className="text-[12.5px]">{L("Checking what needs you…", "Vérification de ce qui vous attend…", "Prüfe, was Sie brauchen…")}</span>
      </div>
    );
  }
  if (!data) return null;

  const empty = data.total === 0;

  return (
    <div
      className="mb-3"
      style={{ background: "var(--card)", border: `1px solid ${empty ? "var(--border)" : "var(--border-gold)"}`, borderRadius: 12, padding: 12 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <ClipboardList size={16} strokeWidth={1.9} style={{ color: empty ? "var(--w3)" : "var(--gold)", flexShrink: 0 }} />
        <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>
          {L("Needs you", "À faire", "Zu erledigen")}
        </span>
        {!empty && (
          <span className="px-1.5 rounded-full text-[10px] font-bold" style={{ background: "var(--gold)", color: "#1a1205" }}>
            {data.total}
          </span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          aria-label={L("Refresh", "Actualiser", "Aktualisieren")}
          className="ml-auto p-1 rounded-md transition-opacity hover:opacity-100 opacity-60"
          style={{ color: "var(--w3)" }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" strokeWidth={2.2} /> : <RotateCw size={13} strokeWidth={2.2} />}
        </button>
      </div>

      {empty ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--w2)" }}>
          <Check size={14} strokeWidth={2.4} style={{ color: "#16a34a" }} />
          {L("You're all caught up — nothing needs you right now.", "Tout est à jour — rien ne vous attend pour l'instant.", "Alles erledigt — im Moment nichts zu tun.")}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {data.groups.map((g) => {
            const isCollapsed = collapsed[g.key];
            return (
              <div key={g.key} style={{ borderLeft: `2px solid ${TONE[g.tone]}`, paddingLeft: 8 }}>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                  className="w-full flex items-center gap-1.5 py-0.5 text-left"
                >
                  <ChevronDown size={13} strokeWidth={2.4} style={{ color: "var(--w3)", transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform .12s" }} />
                  <span className="text-[12px] font-semibold" style={{ color: "var(--w)" }}>{g.label}</span>
                  <span className="text-[11px] font-bold" style={{ color: TONE[g.tone] }}>{g.items.length + g.overflow}</span>
                </button>
                {!isCollapsed && (
                  <div className="flex flex-col">
                    {g.items.map((it) => (
                      <button
                        key={g.key + it.uid}
                        type="button"
                        onClick={() => onOpen(it.uid)}
                        className="flex items-center gap-2 py-1 pl-4 pr-1 text-left transition-colors rounded-md hover:brightness-110"
                        style={{ background: "transparent" }}
                      >
                        <span className="text-[12.5px] truncate flex-1 min-w-0" style={{ color: "var(--w)" }}>{it.name}</span>
                        <span className="text-[11px] whitespace-nowrap" style={{ color: "var(--w3)" }}>{it.detail}</span>
                      </button>
                    ))}
                    {g.overflow > 0 && (
                      <span className="pl-4 py-0.5 text-[11px]" style={{ color: "var(--w3)" }}>
                        {L(`+${g.overflow} more`, `+${g.overflow} de plus`, `+${g.overflow} weitere`)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
