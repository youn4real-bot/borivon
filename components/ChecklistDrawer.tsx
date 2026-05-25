"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { ListChecks, X, Check, Clock, Minus, ChevronDown, Search } from "lucide-react";
import { computeChecklist, type Checklist, type ItemStatus } from "@/lib/candidateChecklist";

const t = {
  en: { aria: "Document checklist", titleCandidate: "Your documents", titleAdmin: "Candidate progress", complete: "complete", essentials: "Essentials", qualifications: "Qualifications", allSet: "All documents submitted — nothing left to upload!", trans: "Translation", optional: "optional", search: "Search name or email…", candidates: "candidates", avg: "avg", none: "No candidates yet",
    labels: { id: "Passport", cv_de: "CV", letter: "Cover letter", langcert: "B2 certificate", diploma: "Diploma", studyprog: "Study program", transcript: "Transcript", abitur: "Abitur", abitur_transcript: "Abitur transcript", praktikum: "Internship", workcert: "Work permit", work_experience: "Work experience", impfung: "Vaccination" } as Record<string, string> },
  fr: { aria: "Liste de documents", titleCandidate: "Vos documents", titleAdmin: "Progression des candidats", complete: "complété", essentials: "Essentiels", qualifications: "Qualifications", allSet: "Tous les documents soumis — rien à ajouter !", trans: "Traduction", optional: "optionnel", search: "Rechercher nom ou e-mail…", candidates: "candidats", avg: "moy.", none: "Aucun candidat",
    labels: { id: "Passeport", cv_de: "CV", letter: "Lettre de motivation", langcert: "Certificat B2", diploma: "Diplôme", studyprog: "Programme d'études", transcript: "Relevé de notes", abitur: "Abitur", abitur_transcript: "Relevé Abitur", praktikum: "Stage", workcert: "Autorisation d'exercer", work_experience: "Expérience pro.", impfung: "Vaccination" } as Record<string, string> },
  de: { aria: "Dokumenten-Checkliste", titleCandidate: "Ihre Dokumente", titleAdmin: "Kandidaten-Fortschritt", complete: "abgeschlossen", essentials: "Grundlagen", qualifications: "Qualifikationen", allSet: "Alle Dokumente eingereicht — nichts mehr hochzuladen!", trans: "Übersetzung", optional: "optional", search: "Name oder E-Mail suchen…", candidates: "Kandidaten", avg: "Ø", none: "Noch keine Kandidaten",
    labels: { id: "Reisepass", cv_de: "Lebenslauf", letter: "Anschreiben", langcert: "B2-Zertifikat", diploma: "Diplom", studyprog: "Ausbildungsprogramm", transcript: "Notenübersicht", abitur: "Abitur", abitur_transcript: "Abitur-Notenübersicht", praktikum: "Praktikum", workcert: "Berufserlaubnis", work_experience: "Berufserfahrung", impfung: "Impfnachweis" } as Record<string, string> },
};

const STATUS_COLOR: Record<ItemStatus, string> = { approved: "#16a34a", pending: "#f59e0b", rejected: "#ef4444", missing: "#9ca3af" };
function StatusIcon({ s, size = 15 }: { s: ItemStatus; size?: number }) {
  const c = STATUS_COLOR[s];
  if (s === "approved") return <Check size={size} style={{ color: c }} strokeWidth={3} />;
  if (s === "pending")  return <Clock size={size} style={{ color: c }} />;
  if (s === "rejected") return <X size={size} style={{ color: c }} strokeWidth={3} />;
  return <Minus size={size} style={{ color: c }} />;
}

type AdminCand = { userId: string; name: string; email: string; checklist: Checklist };

export function ChecklistDrawer() {
  const { lang } = useLang();
  const T = t[lang as keyof typeof t] ?? t.en;

  const [mode, setMode] = useState<"candidate" | "admin" | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [uid, setUid] = useState("");
  const [checklist, setChecklist] = useState<Checklist | null>(null); // candidate
  const [cands, setCands] = useState<AdminCand[] | null>(null);        // admin
  const [q, setQ] = useState("");
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled || !session?.user) return;
      const tk = session.access_token ?? "";
      const res = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null);
      const role = res ? ((await res.json().catch(() => ({}))) as { role?: string }).role : null;
      if (cancelled) return;
      if (role === "admin" || role === "sub_admin") { setToken(tk); setMode("admin"); }
      else if (role === "org_member") { /* org members have their own dossier views */ }
      else { setUid(session.user.id); setToken(tk); setMode("candidate"); }
    });
    return () => { cancelled = true; };
  }, []);

  const loadCandidate = useCallback(async (id: string) => {
    const { data } = await supabase.from("documents").select("file_type, status").eq("user_id", id);
    setChecklist(computeChecklist((data ?? []) as { file_type: string | null; status: string | null }[]));
  }, []);

  const loadAdmin = useCallback(async (tk: string) => {
    const res = await fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${tk}` } });
    const j = await res.json().catch(() => ({}));
    const docs: { user_id: string; file_type: string | null; status: string | null }[] = j.docs ?? [];
    const users: Record<string, { name?: string; email?: string }> = j.users ?? {};
    const byUser: Record<string, { file_type: string | null; status: string | null }[]> = {};
    for (const d of docs) (byUser[d.user_id] ??= []).push({ file_type: d.file_type, status: d.status });
    const list: AdminCand[] = Object.keys(users).map(u => ({
      userId: u, name: users[u]?.name || users[u]?.email || u, email: users[u]?.email || "",
      checklist: computeChecklist(byUser[u] ?? []),
    }));
    list.sort((a, b) => a.checklist.pct - b.checklist.pct || a.name.localeCompare(b.name));
    setCands(list);
  }, []);

  function openDrawer() {
    setOpen(true);
    if (mode === "candidate" && uid) loadCandidate(uid);
    else if (mode === "admin" && token) loadAdmin(token);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const filtered = useMemo(() => {
    if (!cands) return [];
    const n = q.trim().toLowerCase();
    return n ? cands.filter(c => c.name.toLowerCase().includes(n) || c.email.toLowerCase().includes(n)) : cands;
  }, [cands, q]);

  if (!mode) return null;

  const renderItems = (cl: Checklist) => (
    (["essentials", "qualifications"] as const).map(group => (
      <div key={group} style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--w3)", marginBottom: 6 }}>
          {group === "essentials" ? T.essentials : T.qualifications}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {cl.items.filter(i => i.group === group).map(i => (
            <div key={i.key} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5 }}>
              <StatusIcon s={i.original} />
              <span style={{ flex: "1 1 auto", color: "var(--w2)" }}>
                {T.labels[i.key] ?? i.key}
                {i.optional && <span style={{ color: "var(--w3)", fontSize: 10.5 }}> ({T.optional})</span>}
              </span>
              {i.hasTranslation && i.translation && (
                <span title={T.trans} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--w3)", fontSize: 10 }}>
                  {T.trans.slice(0, 2).toUpperCase()} <StatusIcon s={i.translation} size={13} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    ))
  );

  const ProgressBar = ({ pct }: { pct: number }) => (
    <div style={{ height: 7, borderRadius: 4, background: "var(--card)", overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#16a34a" : pct >= 50 ? "#f59e0b" : "#ef4444", transition: "width .3s" }} />
    </div>
  );

  return (
    <>
      <button onClick={openDrawer} aria-label={T.aria}
        className="flex items-center justify-center w-11 h-11 cursor-pointer hover:scale-110 active:scale-95"
        style={{ background: "transparent", border: "none", color: "var(--w3)", transition: "color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease)" }}
        onMouseEnter={e => (e.currentTarget.style.color = "var(--w)")}
        onMouseLeave={e => (e.currentTarget.style.color = "var(--w3)")}>
        <ListChecks size={20} strokeWidth={1.8} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0" style={{ zIndex: 1400 }}>
          <div onClick={() => setOpen(false)} className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", animation: "bvFadeIn .2s ease" }} />
          <div className="bv-cl-drawer" style={{
            position: "absolute", top: 0, right: 0, bottom: 0,
            background: "var(--bg2)", borderLeft: "1px solid var(--border)",
            boxShadow: "-10px 0 36px rgba(0,0,0,0.34)", display: "flex", flexDirection: "column",
            animation: "bvSlideInRight .26s var(--ease-out)",
          }}>
            {/* Header */}
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--w)", display: "flex", alignItems: "center", gap: 8 }}>
                  <ListChecks size={18} /> {mode === "admin" ? T.titleAdmin : T.titleCandidate}
                </h2>
                <button onClick={() => setOpen(false)} aria-label="Close"
                  style={{ background: "none", border: "none", color: "var(--w3)", cursor: "pointer", padding: 4 }}>
                  <X size={20} />
                </button>
              </div>
              {mode === "candidate" && checklist && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--w3)", marginBottom: 5 }}>
                    <span>{checklist.requiredComplete}/{checklist.requiredTotal}</span>
                    <span><strong style={{ color: "var(--w)" }}>{checklist.pct}%</strong> {T.complete}</span>
                  </div>
                  <ProgressBar pct={checklist.pct} />
                </div>
              )}
              {mode === "admin" && cands && cands.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--w3)", marginBottom: 8 }}>
                    <strong style={{ color: "var(--w)" }}>{cands.length}</strong> {T.candidates}
                    <span style={{ margin: "0 6px" }}>·</span>
                    <strong style={{ color: "var(--w)" }}>{Math.round(cands.reduce((s, c) => s + c.checklist.pct, 0) / cands.length)}%</strong> {T.avg}
                  </div>
                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder={T.search}
                      style={{ width: "100%", padding: "7px 9px 7px 30px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 12.5 }} />
                  </div>
                </div>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 28px" }}>
              {/* Candidate's own checklist */}
              {mode === "candidate" && (
                !checklist ? <div style={{ textAlign: "center", color: "var(--w3)", padding: "2rem 0" }}>…</div> : (
                  <>
                    {checklist.counts.missing === 0 && checklist.counts.rejected === 0 && checklist.counts.pending === 0 && (
                      <div style={{ textAlign: "center", color: "var(--success)", padding: "1.5rem 0", fontSize: 13.5, fontWeight: 600 }}>✓ {T.allSet}</div>
                    )}
                    {renderItems(checklist)}
                  </>
                )
              )}

              {/* Admin: all-candidates progress */}
              {mode === "admin" && (
                !cands ? <div style={{ textAlign: "center", color: "var(--w3)", padding: "2rem 0" }}>…</div> :
                cands.length === 0 ? <div style={{ textAlign: "center", color: "var(--w3)", padding: "2rem 0", fontSize: 13 }}>{T.none}</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {filtered.map(c => {
                      const o = expandedUid === c.userId;
                      const { pct, counts } = c.checklist;
                      return (
                        <div key={c.userId} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", overflow: "hidden" }}>
                          <button onClick={() => setExpandedUid(o ? null : c.userId)}
                            style={{ width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: "9px 11px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                              <span style={{ fontSize: 11.5, color: "var(--w3)" }}>{pct}%</span>
                              <ChevronDown size={15} style={{ color: "var(--w3)", flexShrink: 0, transition: "transform .2s", transform: o ? "rotate(180deg)" : "none" }} />
                            </div>
                            <div style={{ marginTop: 6 }}><ProgressBar pct={pct} /></div>
                            <div style={{ display: "flex", gap: 9, marginTop: 6, fontSize: 11, color: "var(--w2)" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><StatusIcon s="approved" size={12} />{counts.complete}</span>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><StatusIcon s="pending" size={12} />{counts.pending}</span>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><StatusIcon s="rejected" size={12} />{counts.rejected}</span>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><StatusIcon s="missing" size={12} />{counts.missing}</span>
                            </div>
                          </button>
                          {o && <div style={{ borderTop: "1px solid var(--border)", padding: "10px 11px" }}>{renderItems(c.checklist)}</div>}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>

          <style>{`
            .bv-cl-drawer { width: 33vw; min-width: 340px; max-width: 460px; }
            @media (max-width: 640px) { .bv-cl-drawer { width: 88vw; min-width: 0; max-width: none; } }
            @keyframes bvSlideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
            @keyframes bvFadeIn { from { opacity: 0; } to { opacity: 1; } }
          `}</style>
        </div>,
        document.body
      )}
    </>
  );
}
