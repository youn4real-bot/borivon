"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, Search, Download, GraduationCap, Check } from "lucide-react";
import { B2_STAGES, B2_STAGE_BY_KEY, B2_FAILED_COLOR, b2StageLabel, type B2Stage } from "@/lib/b2Journey";

type Cand = {
  userId: string; name: string; stage: B2Stage; failed: boolean;
  examDate: string | null; cert: "approved" | "pending" | "none";
  germanLevel: string | null; german: string;
};

const deDate = (iso: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };

export default function B2StatusPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [cands, setCands] = useState<Cand[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } });
      const { role } = await roleRes.json().catch(() => ({ role: null }));
      if (role !== "admin" && role !== "sub_admin") { router.replace("/portal"); return; }
      setToken(tk);
      const res = await fetch("/api/portal/admin/b2-overview", { headers: { Authorization: `Bearer ${tk}` } });
      const j = await res.json().catch(() => ({ candidates: [] }));
      setCands((j.candidates ?? []) as Cand[]);
      setLoading(false);
    });
  }, [router]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? cands.filter(c => c.name.toLowerCase().includes(s) || c.german.toLowerCase().includes(s)) : cands;
    return base.slice().sort((a, b) =>
      (B2_STAGE_BY_KEY[a.stage].position - B2_STAGE_BY_KEY[b.stage].position) || a.name.localeCompare(b.name));
  }, [q, cands]);

  const counts = useMemo(() => {
    const m = new Map<B2Stage, number>();
    for (const c of cands) m.set(c.stage, (m.get(c.stage) ?? 0) + 1);
    return m;
  }, [cands]);

  const allFilteredSelected = filtered.length > 0 && filtered.every(c => sel.has(c.userId));
  const toggle = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(p => {
    const n = new Set(p);
    if (allFilteredSelected) filtered.forEach(c => n.delete(c.userId));
    else filtered.forEach(c => n.add(c.userId));
    return n;
  });

  async function download() {
    if (sel.size === 0) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/portal/admin/b2-report", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userIds: [...sel] }),
      });
      if (!res.ok) { setDownloading(false); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "b2-status.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { /* ignore */ }
    setDownloading(false);
  }

  if (loading) return <PageLoader />;
  const card: CSSProperties = { borderRadius: 16, border: "1px solid var(--border)", background: "var(--card)" };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-28">
      <button onClick={() => router.back()} className="bv-row-hover flex items-center gap-2 text-xs px-2 py-1 mb-4" style={{ color: "var(--w3)" }}>
        <ArrowLeft size={14} /> {T("Back", "Zurück", "Retour")}
      </button>

      <div className="flex items-center gap-2.5 mb-1.5">
        <GraduationCap size={20} style={{ color: "var(--gold)" }} />
        <h1 className="text-[19px] font-bold" style={{ color: "var(--w)" }}>{T("B2 status", "B2-Status", "Statut B2")}</h1>
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: "var(--w3)" }}>
        {T("The real B2 detail from each candidate's CV — exam, planned date, slot paid, pass/fail, certificate. Select any to download a combined PDF.",
           "Das echte B2-Detail aus dem CV jedes Kandidaten — Prüfung, geplanter Termin, Platz bezahlt, bestanden/nicht, Zertifikat. Auswählen für eine kombinierte PDF.",
           "Le vrai détail B2 depuis le CV de chaque candidat — examen, date prévue, place payée, réussite/échec, certificat. Sélectionnez pour un PDF combiné.")}
      </p>

      {/* Stage summary — coarse "where are they" */}
      <div className="flex flex-wrap gap-2 mb-4">
        {B2_STAGES.map(s => {
          const n = counts.get(s.key) ?? 0;
          return (
            <div key={s.key} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--bg2)", border: "1px solid var(--border)", opacity: n ? 1 : 0.5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: s.color, display: "inline-block" }} />
              <span className="text-[12px] font-bold" style={{ color: "var(--w)" }}>{n}</span>
              <span className="text-[11.5px]" style={{ color: "var(--w3)" }}>{b2StageLabel(s.key, lang)}</span>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
          <input className="bv-input" value={q} onChange={e => setQ(e.target.value)} placeholder={T("Search name or detail…", "Name oder Detail suchen…", "Nom ou détail…")} style={{ width: "100%", paddingLeft: 36, fontSize: 13.5 }} />
        </div>
        <button onClick={toggleAll} className="bv-press flex-shrink-0 text-[12px] font-semibold px-3 py-2.5 rounded-lg" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
          {allFilteredSelected ? T("Clear", "Leeren", "Effacer") : T("Select all", "Alle wählen", "Tout")}
        </button>
      </div>

      {/* List */}
      <div style={card}>
        {filtered.length === 0 ? (
          <p className="text-[12.5px] text-center py-8" style={{ color: "var(--w3)" }}>{T("No candidates.", "Keine Kandidaten.", "Aucun candidat.")}</p>
        ) : filtered.map((c, i) => {
          const def = B2_STAGE_BY_KEY[c.stage];
          const checked = sel.has(c.userId);
          return (
            <button key={c.userId} onClick={() => toggle(c.userId)} className="w-full text-left flex items-start gap-3 px-3.5 py-3 transition-colors"
              style={{ borderTop: i ? "1px solid var(--border)" : "none", background: checked ? "var(--gdim)" : "transparent" }}>
              <span className="flex-shrink-0 mt-0.5 flex items-center justify-center" style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${checked ? "var(--gold)" : "var(--border)"}`, background: checked ? "var(--gold)" : "transparent" }}>
                {checked && <Check size={12} strokeWidth={3} color="#131312" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-semibold" style={{ color: "var(--w)" }}>{c.name}</span>
                  {c.germanLevel && <span style={{ fontSize: 10, fontWeight: 800, color: "var(--gold)", background: "var(--gdim)", borderRadius: 6, padding: "1px 6px" }}>{c.germanLevel}</span>}
                  {c.failed && <span style={{ fontSize: 10, fontWeight: 700, color: B2_FAILED_COLOR, border: `1px solid ${B2_FAILED_COLOR}`, borderRadius: 6, padding: "0px 5px" }}>{T("failed once", "1× nicht best.", "échoué 1×")}</span>}
                </div>
                {/* The real CV-builder German detail */}
                <div className="text-[12px] mt-1 leading-snug" style={{ color: c.german ? "var(--w2)" : "var(--w3)" }}>
                  {c.german || T("No B2 details filled in the CV yet.", "Noch keine B2-Angaben im CV.", "Aucun détail B2 dans le CV.")}
                </div>
                <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: def.color, display: "inline-block" }} />
                    <span className="text-[11px] font-medium" style={{ color: def.color }}>{b2StageLabel(c.stage, lang)}</span>
                  </span>
                  {c.examDate && <span className="text-[11px]" style={{ color: "var(--w3)" }}>· {T("Exam", "Prüfung", "Examen")} {deDate(c.examDate)}</span>}
                  {c.cert !== "none" && <span className="text-[11px]" style={{ color: c.cert === "approved" ? "var(--success)" : "#f59e0b" }}>· {T("Certificate", "Zertifikat", "Certificat")} {c.cert === "approved" ? T("on file", "vorhanden", "présent") : T("in review", "in Prüfung", "en examen")}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Sticky download bar */}
      {sel.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[60] flex items-center justify-between gap-3 px-4 py-3" style={{ background: "var(--card)", borderTop: "1px solid var(--border)", boxShadow: "0 -4px 16px rgba(0,0,0,0.25)" }}>
          <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{sel.size} {T("selected", "ausgewählt", "sélectionné(s)")}</span>
          <button onClick={download} disabled={downloading} className="bv-press inline-flex items-center gap-2 text-[13.5px] font-bold px-5 py-2.5 rounded-xl disabled:opacity-60" style={{ background: "var(--gold)", color: "#131312" }}>
            <Download size={15} /> {downloading ? T("Preparing…", "Wird erstellt…", "Préparation…") : T(`Download PDF (${sel.size})`, `PDF herunterladen (${sel.size})`, `Télécharger PDF (${sel.size})`)}
          </button>
        </div>
      )}
    </div>
  );
}
