"use client";
/**
 * Her profile card — "Profil", founder 2026-11-12 sample 1 ("So sehen die Einrichtungen Sie"): photo left,
 * name, role · city, her facts as quiet chips (German level, years of work, departments), when she starts,
 * and her Lebenslauf. Facts come from her CV builder (app/api/portal/profile); nothing is invented — a fact
 * she has not given yet simply is not shown.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";

type Facts = { city: string; german: string; months: number; depts: string[]; start: string; hasCv: boolean };
type L = "de" | "en" | "fr";
const T3 = (l: L, de: string, fr: string, en: string) => (l === "de" ? de : l === "fr" ? fr : en);

function useProfile(userId?: string | null) {
  const [f, setF] = useState<Facts | null>(null);
  useEffect(() => {
    let off = false;
    setF(null);
    (async () => {
      const { data } = await supabase.auth.getSession();
      const tok = data.session?.access_token;
      if (!tok) return;
      const r = await fetch(`/api/portal/profile${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`, { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" }).catch(() => null);
      const j = r?.ok ? ((await r.json().catch(() => null)) as Facts | null) : null;
      if (j && !off) setF(j);
    })();
    return () => { off = true; };
  }, [userId]);
  return f;
}

export function ProfileCard({ userId, name, photo, cvHref }: { userId?: string | null; name: string; photo: string | null; cvHref: string }) {
  const { lang } = useLang();
  const l = (["de", "en", "fr"].includes(lang) ? lang : "de") as L;
  const f = useProfile(userId);
  if (!f) return null;
  const years = Math.floor(f.months / 12);
  const exp = f.months <= 0 ? "" : years >= 1
    ? `${years} ${T3(l, years === 1 ? "Jahr" : "Jahre", years === 1 ? "an" : "ans", years === 1 ? "year" : "years")}`
    : `${f.months} ${T3(l, f.months === 1 ? "Monat" : "Monate", "mois", f.months === 1 ? "month" : "months")}`;
  const start = f.start ? new Date(f.start + "T00:00:00Z").toLocaleDateString(l === "de" ? "de-DE" : l === "fr" ? "fr-FR" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const chip = (k: string, b: string, rest: string) => (
    <span key={k} style={{ padding: "7px 12px", borderRadius: 999, background: "var(--bg2)", fontSize: 13, color: "var(--w)" }}>{b && <b style={{ fontWeight: 600 }}>{b}</b>}{b && rest ? " " : ""}{rest}</span>
  );
  const initials = name.trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? "").join("");
  return (
    <div style={{ textAlign: "left" }}>
      <div style={{ fontSize: 12.5, color: "var(--w3)", marginBottom: 14 }}>{T3(l, "So sehen die Einrichtungen Sie", "Ce que voient les établissements", "What facilities see")}</div>
      <style>{"@media (max-width:640px){.bv-pf{grid-template-columns:1fr!important;text-align:center}.bv-pf-ph{margin:0 auto}.bv-pf-row{justify-content:center}}"}</style>
      <div className="bv-pf" style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 24, alignItems: "center" }}>
        {photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="bv-pf-ph" src={photo} alt="" style={{ width: 130, height: 156, borderRadius: 14, objectFit: "cover" }} />
          : <div className="bv-pf-ph" style={{ width: 130, height: 156, borderRadius: 14, background: "var(--bg2)", display: "grid", placeItems: "center", fontFamily: "var(--font-serif)", fontSize: 40, color: "var(--w3)" }}>{initials}</div>}
        <div style={{ minWidth: 0 }}>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1.1, overflowWrap: "anywhere" }}>{name}</div>
          <div style={{ color: "var(--w3)", fontSize: 14, marginTop: 4 }}>{[T3(l, "Pflegefachkraft", "Infirmier·ère", "Registered nurse"), f.city].filter(Boolean).join(" · ")}</div>
          <div className="bv-pf-row" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {f.german && chip("de", f.german, T3(l, "Deutsch", "allemand", "German"))}
            {exp && chip("x", exp, T3(l, "Erfahrung", "d’expérience", "experience"))}
            {f.depts.map((d) => chip(d, "", d))}
          </div>
          {start && <div style={{ marginTop: 14, fontSize: 13, color: "var(--w3)" }}>{T3(l, "Arbeitsbeginn", "Début", "Starts")} <b style={{ color: "#15803d", fontWeight: 600 }}>{start}</b></div>}
          <div className="bv-pf-row" style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <a href={cvHref} style={{ display: "inline-flex", alignItems: "center", height: 42, padding: "0 20px", borderRadius: 999, background: "var(--w)", color: "var(--bg)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              {T3(l, "Lebenslauf", "CV", "CV")}
            </a>
          </div>
          {!f.hasCv && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--w3)" }}>{T3(l, "Ihr Lebenslauf füllt dieses Profil.", "Votre CV remplit ce profil.", "Your CV fills this profile.")}</div>}
        </div>
      </div>
    </div>
  );
}
