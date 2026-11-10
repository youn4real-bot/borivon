"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import type { Lang } from "@/lib/facility/steps";
import { WEG_ORDER, WEG_T, type WegKey } from "@/lib/facility/weg";

type W = { prog: Record<WegKey, [number, number]>; now: WegKey };

/** A slim card on the nurse's dashboard: her way to Germany, the station she is at now (app/portal/ankunft). */
export function ArrivalCard() {
  const { t, lang: l } = useLang();
  const lang = (["de", "en", "fr"].includes(l) ? l : "de") as Lang;
  const wt = WEG_T[lang] ?? WEG_T.de;
  const [w, setW] = useState<W | null>(null);
  useEffect(() => {
    let off = false;
    supabase.auth.getSession().then(async ({ data }) => {
      const tok = data.session?.access_token;
      if (!tok) return;
      const r = await fetch("/api/portal/weg", { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }).catch(() => null);
      const j = r?.ok ? ((await r.json().catch(() => null)) as W | null) : null;
      if (!off && j?.prog) setW(j);
    });
    return () => { off = true; };
  }, []);
  if (!w) return null;
  const [d, n] = w.prog[w.now] ?? [0, 0];
  const started = WEG_ORDER.some((k) => (w.prog[k]?.[0] ?? 0) > 0);
  const sub = started
    ? `${wt.now}: ${wt[w.now]} · ${wt.of.replace("{a}", String(d)).replace("{b}", String(n))}`
    : t.arrCardP;
  return (
    <a href="/portal/ankunft" className="no-underline" style={{ display: "block", margin: "0 0 26px", padding: "18px 20px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <span>
          <span style={{ display: "block", fontFamily: "var(--font-serif)", fontSize: 21, fontWeight: 500, color: "var(--w)" }}>{t.arrCardH}</span>
          <span style={{ display: "block", marginTop: 4, fontSize: 13.5, color: "var(--w2)" }}>{sub}</span>
        </span>
        <span aria-hidden="true" style={{ color: "var(--gold)", fontSize: 20 }}>→</span>
      </span>
      {/* the four stations as one quiet line */}
      <span aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 14 }}>
        {WEG_ORDER.map((k) => {
          const [a, b] = w.prog[k] ?? [0, 0];
          const pct = b > 0 ? Math.round((a / b) * 100) : 0;
          return (
            <span key={k} style={{ position: "relative", height: 2, background: "var(--border)", overflow: "hidden" }}>
              <span style={{ position: "absolute", inset: 0, width: `${pct}%`, background: k === w.now ? "var(--gold)" : "var(--w)" }} />
            </span>
          );
        })}
      </span>
    </a>
  );
}
