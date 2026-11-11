"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";

/**
 * The nurse's whole way on one screen (founder 2026-11-11: "a roadmap of where she is, step by step until
 * she gets there; papers hidden but reachable; 90 % visuals"). Six stations, the one she is at marked, one
 * next step. Numbers come from /api/portal/weg: the document phases (same rules as the admin list) and the
 * way to Germany (visa guide, flat + journey, first weeks, six months). Status by colour only (LAW #4).
 */
type P = [number, number];
type W = { prog: { visa: P; move: P; weeks: P; six: P }; docs: { papers: P; bearbeitung: P; visum: P } | null };
type Key = "papers" | "recog" | "visa" | "move" | "arrive" | "stay";

const T = {
  de: { h: "Dein Weg nach Deutschland", now: "Jetzt", next: "Weiter", of: "{a} von {b}", done: "Geschafft",
    names: { papers: "Unter­lagen", recog: "Aner­kennung", visa: "Visum", move: "Wohnung & Anreise", arrive: "An­kommen", stay: "Bleiben" },
    say: { papers: "Lade deine Unterlagen hoch.", recog: "Deine Anerkennung läuft.", visa: "Dein Visum, Schritt für Schritt.", move: "Wohnung und Flug planen.", arrive: "Deine ersten Wochen in Deutschland.", stay: "Bis die Probezeit geschafft ist." } },
  en: { h: "Your way to Germany", now: "Now", next: "Continue", of: "{a} of {b}", done: "Done",
    names: { papers: "Docu­ments", recog: "Recog­nition", visa: "Visa", move: "Flat & journey", arrive: "Arrival", stay: "Staying" },
    say: { papers: "Upload your documents.", recog: "Your recognition is under way.", visa: "Your visa, step by step.", move: "Plan your flat and flight.", arrive: "Your first weeks in Germany.", stay: "Until probation is passed." } },
  fr: { h: "Ton chemin vers l’Allemagne", now: "Maintenant", next: "Continuer", of: "{a} sur {b}", done: "Terminé",
    names: { papers: "Docu­ments", recog: "Recon­naissance", visa: "Visa", move: "Logement & voyage", arrive: "Arrivée", stay: "Rester" },
    say: { papers: "Télécharge tes documents.", recog: "Ta reconnaissance est en cours.", visa: "Ton visa, étape par étape.", move: "Prépare ton logement et ton vol.", arrive: "Tes premières semaines en Allemagne.", stay: "Jusqu’à la fin de la période d’essai." } },
};

export function WegMap({ onDocs, userId, name }: { onDocs?: () => void; userId?: string; name?: string }) {
  const { lang: l } = useLang();
  const t = T[(["de", "en", "fr"].includes(l) ? l : "de") as keyof typeof T];
  const [w, setW] = useState<W | null>(null);

  useEffect(() => {
    let off = false;
    supabase.auth.getSession().then(async ({ data }) => {
      const tok = data.session?.access_token;
      if (!tok) return;
      const r = await fetch(`/api/portal/weg${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`, { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }).catch(() => null);
      const j = r?.ok ? ((await r.json().catch(() => null)) as W | null) : null;
      if (!off && j?.prog) setW(j);
    });
    return () => { off = true; };
  }, [userId]);
  if (!w) return null;

  // a nurse goes to her own page; an admin to hers (the same plan, LAW #25 scope in /api/portal/weg)
  const base = userId ? `/portal/admin/ankunft/${userId}?name=${encodeURIComponent(name ?? "")}` : "/portal/ankunft";
  const st: { k: Key; p: P; href?: string }[] = [
    ...(w.docs ? [
      { k: "papers" as Key, p: w.docs.papers },
      { k: "recog" as Key, p: w.docs.bearbeitung },
    ] : []),
    { k: "visa", p: w.docs ? [w.docs.visum[0] + w.prog.visa[0], w.docs.visum[1] + w.prog.visa[1]] : w.prog.visa, href: `${base}#weg-visum` },
    { k: "move", p: w.prog.move, href: `${base}#weg-anreise` },
    { k: "arrive", p: w.prog.weeks, href: `${base}#weg-wochen` },
    { k: "stay", p: w.prog.six, href: `${base}#weg-monate` },
  ];
  const full = (p: P) => p[1] > 0 && p[0] >= p[1];
  const nowIdx = Math.max(0, st.findIndex((s) => s.p[1] > 0 && !full(s.p)));
  const cur = st[nowIdx];
  const go = () => { if (cur.href) location.href = cur.href; else if (onDocs) onDocs(); };

  return (
    <section aria-label={t.h} style={{ margin: "0 0 34px", padding: "26px 24px 24px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)" }}>
      <p style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 500, color: "var(--w)" }}>{userId ? (name || t.h) : t.h}</p>
      {/* the stations: one line, the one she is at in gold */}
      <ol style={{ display: "grid", gridTemplateColumns: `repeat(${st.length}, minmax(0, 1fr))`, gap: 0, margin: "22px -8px 0", padding: 0, listStyle: "none", position: "relative" }}>
        {st.map((s, i) => {
          const done = full(s.p), now = i === nowIdx;
          const pct = s.p[1] > 0 ? Math.round((s.p[0] / s.p[1]) * 100) : 0;
          return (
            <li key={s.k} style={{ position: "relative", textAlign: "center", padding: "0 3px", minWidth: 0 }}>
              {i > 0 && <span aria-hidden="true" style={{ position: "absolute", top: 15, right: "50%", width: "100%", height: 2, background: i <= nowIdx ? "var(--w)" : "var(--border)" }} />}
              <span aria-hidden="true" style={{ position: "relative", zIndex: 1, display: "grid", placeItems: "center", width: 32, height: 32, margin: "0 auto", borderRadius: "50%",
                background: done ? "var(--w)" : "var(--card)", color: done ? "var(--bg)" : now ? "var(--gold)" : "var(--w3)",
                border: `2px solid ${done ? "var(--w)" : now ? "var(--gold)" : "var(--border)"}`, boxShadow: now ? "0 0 0 5px var(--gdim)" : "none",
                fontFamily: "var(--font-serif)", fontSize: 15 }}>
                {done ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 8.5l3.2 3L13 4.5" /></svg> : i + 1}
              </span>
              <span lang={l} style={{ display: "block", marginTop: 8, padding: "0 1px", fontSize: "clamp(8.5px, 2.3vw, 12.5px)", lineHeight: 1.2, hyphens: "manual", WebkitHyphens: "manual", color: now ? "var(--w)" : "var(--w3)", fontWeight: now ? 600 : 400 }}>{t.names[s.k]}</span>
              {s.p[1] > 0 && !done && <span aria-hidden="true" style={{ display: "block", height: 2, margin: "6px auto 0", width: "70%", background: "var(--border)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${pct}%`, background: now ? "var(--gold)" : "var(--w3)" }} /></span>}
            </li>
          );
        })}
      </ol>
      {/* the one next step */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
        <div>
          <span style={{ display: "block", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--gold)" }}>{t.now} · {t.names[cur.k]}</span>
          <span style={{ display: "block", marginTop: 6, fontSize: 15, color: "var(--w)" }}>{full(cur.p) ? t.done : t.say[cur.k]}</span>
          {cur.p[1] > 0 && <span style={{ display: "block", marginTop: 3, fontSize: 12.5, color: "var(--w3)" }}>{t.of.replace("{a}", String(cur.p[0])).replace("{b}", String(cur.p[1]))}</span>}
        </div>
        <button type="button" onClick={go} style={{ flexShrink: 0, height: 44, padding: "0 20px", whiteSpace: "nowrap", border: 0, borderRadius: 4, background: "var(--w)", color: "var(--bg)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{t.next} →</button>
      </div>
    </section>
  );
}
