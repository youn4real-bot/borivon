"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import { Search, Download, Check } from "lucide-react";
import { B2_STAGES, B2_STAGE_BY_KEY, b2StageLabel, type B2Stage } from "@/lib/b2Journey";
import { PageHead, Btn, Card, Dot, Empty, Pager, usePaged, type Status } from "@/components/fx/kit";

// the one status palette (components/fx/kit): studying = grey, dated / booked / awaiting = orange, passed = green;
// "failed once" = a red dot (lib/b2Journey keeps its own ring colours for the avatars elsewhere)
const B2_KIT: Record<B2Stage, Status> = { studying: "missing", expected_date: "pending", exam_booked: "pending", awaiting_results: "pending", passed: "approved" };

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

  // the one design (founder 2026-11-13): serif head, the stage counts as big serif numbers with a status dot,
  // one search field, the candidates as hairline rows that flip; the download is the one black pill
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6" style={{ paddingTop: 88 }}>
      <PageHead back={{ label: T("Back", "Zurück", "Retour"), onClick: () => router.back() }}
        title={T("B2 status", "B2-Status", "Statut B2")}
        sub={T("The real B2 detail from each candidate's CV. Select any for one combined PDF.",
               "Das echte B2-Detail aus dem CV jedes Kandidaten. Auswählen für eine kombinierte PDF.",
               "Le vrai détail B2 du CV de chaque candidat. Sélectionnez pour un PDF combiné.")} />

      {/* Stage summary — coarse "where are they" */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "12px 14px", marginBottom: 16 }}>
        {B2_STAGES.map(s => {
          const n = counts.get(s.key) ?? 0;
          return (
            <div key={s.key} style={{ minWidth: 0, opacity: n ? 1 : 0.5 }}>
              <div style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 26, lineHeight: 1.1, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{n}</div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, lineHeight: 1.35, color: "var(--w3)", marginTop: 2 }}>
                <span style={{ marginTop: 4 }}><Dot st={B2_KIT[s.key]} size={7} /></span>{b2StageLabel(s.key, lang)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 0 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
          <input className="bvk-input" value={q} onChange={e => setQ(e.target.value)} placeholder={T("Search name or detail…", "Name oder Detail suchen…", "Nom ou détail…")} style={{ paddingLeft: 36 }} />
        </div>
        <Btn kind="ghost" onClick={toggleAll} style={{ flex: "none" }}>
          {allFilteredSelected ? T("Clear", "Leeren", "Effacer") : T("Select all", "Alle wählen", "Tout")}
        </Btn>
        {/* Selected + download — right by the search (not a bottom bar); the count is in the pill. */}
        {sel.size > 0 && (
          <Btn kind="primary" onClick={download} disabled={downloading} style={{ flex: "none" }}
            title={`${sel.size} ${T("selected", "ausgewählt", "sélectionné(s)")}`}>
            <Download size={14} /> {downloading ? T("Preparing…", "Wird erstellt…", "Préparation…") : T(`Download PDF (${sel.size})`, `PDF herunterladen (${sel.size})`, `Télécharger PDF (${sel.size})`)}
          </Btn>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card><Empty>{T("No candidates.", "Keine Kandidaten.", "Aucun candidat.")}</Empty></Card>
      ) : (
        <Paged items={filtered} per={5} perPhone={3}>
          {(slice) => (
            <Card style={{ padding: "4px 8px" }}>
              {slice.map((c, i) => {
                const checked = sel.has(c.userId);
                return (
                  <button key={c.userId} type="button" onClick={() => toggle(c.userId)}
                    style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 8px", borderRadius: 12, border: 0, cursor: "pointer", fontFamily: "inherit",
                      borderTop: i ? "1px solid var(--border)" : "none", background: checked ? "var(--bg2)" : "transparent" }}>
                    <span style={{ flex: "none", marginTop: 2, width: 18, height: 18, borderRadius: 6, display: "grid", placeItems: "center",
                      border: `1.5px solid ${checked ? "var(--w)" : "var(--border)"}`, background: checked ? "var(--w)" : "var(--card)" }}>
                      {checked && <Check size={12} strokeWidth={3} color="var(--bg)" />}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--w)" }}>{c.name}</span>
                        {c.germanLevel && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--w3)" }}>{c.germanLevel}</span>}
                        {c.failed && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--w)" }}><Dot st="rejected" size={7} />{T("failed once", "1× nicht best.", "échoué 1×")}</span>}
                      </span>
                      {/* The real CV-builder German detail */}
                      <span style={{ display: "block", fontSize: 12.5, marginTop: 2, lineHeight: 1.4, color: c.german ? "var(--w2)" : "var(--w3)" }}>
                        {c.german || T("No B2 details filled in the CV yet.", "Noch keine B2-Angaben im CV.", "Aucun détail B2 dans le CV.")}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: "2px 10px", flexWrap: "wrap", marginTop: 4, fontSize: 12, color: "var(--w3)" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Dot st={B2_KIT[c.stage]} size={7} /><span style={{ color: "var(--w)" }}>{b2StageLabel(c.stage, lang)}</span></span>
                        {c.examDate && <span>{T("Exam", "Prüfung", "Examen")} {deDate(c.examDate)}</span>}
                        {c.cert !== "none" && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Dot st={c.cert === "approved" ? "approved" : "pending"} size={7} />
                            {T("Certificate", "Zertifikat", "Certificat")} {c.cert === "approved" ? T("on file", "vorhanden", "présent") : T("in review", "in Prüfung", "en examen")}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </Card>
          )}
        </Paged>
      )}
    </div>
  );
}

/** lists flip instead of scrolling (components/fx/kit usePaged + Pager) */
function Paged<I>({ items, per, perPhone, children }: { items: I[]; per: number; perPhone: number; children: (slice: I[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}
