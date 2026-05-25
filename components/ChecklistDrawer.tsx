"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { ListChecks, X, Check, Clock, Minus } from "lucide-react";
import { computeChecklist, type Checklist, type ItemStatus } from "@/lib/candidateChecklist";

const t = {
  en: { aria: "Your document checklist", title: "Your documents", complete: "complete", essentials: "Essentials", qualifications: "Qualifications", allSet: "All documents submitted — nothing left to upload!", trans: "Translation", optional: "optional",
    labels: { id: "Passport", cv_de: "CV", letter: "Cover letter", langcert: "B2 certificate", diploma: "Diploma", studyprog: "Study program", transcript: "Transcript", abitur: "Abitur", abitur_transcript: "Abitur transcript", praktikum: "Internship", workcert: "Work permit", work_experience: "Work experience", impfung: "Vaccination" } as Record<string, string> },
  fr: { aria: "Votre liste de documents", title: "Vos documents", complete: "complété", essentials: "Essentiels", qualifications: "Qualifications", allSet: "Tous les documents soumis — rien à ajouter !", trans: "Traduction", optional: "optionnel",
    labels: { id: "Passeport", cv_de: "CV", letter: "Lettre de motivation", langcert: "Certificat B2", diploma: "Diplôme", studyprog: "Programme d'études", transcript: "Relevé de notes", abitur: "Abitur", abitur_transcript: "Relevé Abitur", praktikum: "Stage", workcert: "Autorisation d'exercer", work_experience: "Expérience pro.", impfung: "Vaccination" } as Record<string, string> },
  de: { aria: "Ihre Dokumenten-Checkliste", title: "Ihre Dokumente", complete: "abgeschlossen", essentials: "Grundlagen", qualifications: "Qualifikationen", allSet: "Alle Dokumente eingereicht — nichts mehr hochzuladen!", trans: "Übersetzung", optional: "optional",
    labels: { id: "Reisepass", cv_de: "Lebenslauf", letter: "Anschreiben", langcert: "B2-Zertifikat", diploma: "Diplom", studyprog: "Ausbildungsprogramm", transcript: "Notenübersicht", abitur: "Abitur", abitur_transcript: "Abitur-Notenübersicht", praktikum: "Praktikum", workcert: "Berufserlaubnis", work_experience: "Berufserfahrung", impfung: "Impfnachweis" } as Record<string, string> },
};

const STATUS_COLOR: Record<ItemStatus, string> = {
  approved: "#16a34a", pending: "#f59e0b", rejected: "#ef4444", missing: "#9ca3af",
};
function StatusIcon({ s, size = 15 }: { s: ItemStatus; size?: number }) {
  const c = STATUS_COLOR[s];
  if (s === "approved") return <Check size={size} style={{ color: c }} strokeWidth={3} />;
  if (s === "pending")  return <Clock size={size} style={{ color: c }} />;
  if (s === "rejected") return <X size={size} style={{ color: c }} strokeWidth={3} />;
  return <Minus size={size} style={{ color: c }} />;
}

export function ChecklistDrawer() {
  const { lang } = useLang();
  const T = t[lang as keyof typeof t] ?? t.en;
  const [show, setShow] = useState(false);   // candidate → button visible
  const [open, setOpen] = useState(false);
  const [uid, setUid] = useState("");
  const [checklist, setChecklist] = useState<Checklist | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled || !session?.user) return;
      const token = session.access_token ?? "";
      const res = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      const role = res ? ((await res.json().catch(() => ({}))) as { role?: string }).role : null;
      // Candidates only — admins/sub-admins/org-members have other views.
      if (role === "admin" || role === "sub_admin" || role === "org_member") return;
      if (!cancelled) { setUid(session.user.id); setShow(true); }
    });
    return () => { cancelled = true; };
  }, []);

  const loadChecklist = useCallback(async (id: string) => {
    const { data } = await supabase.from("documents").select("file_type, status").eq("user_id", id);
    setChecklist(computeChecklist((data ?? []) as { file_type: string | null; status: string | null }[]));
  }, []);

  function openDrawer() { setOpen(true); if (uid) loadChecklist(uid); }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!show) return null;

  return (
    <>
      <button
        onClick={openDrawer}
        aria-label={T.aria}
        className="flex items-center justify-center w-11 h-11 cursor-pointer hover:scale-110 active:scale-95"
        style={{ background: "transparent", border: "none", color: "var(--w3)", transition: "color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease)" }}
        onMouseEnter={e => (e.currentTarget.style.color = "var(--w)")}
        onMouseLeave={e => (e.currentTarget.style.color = "var(--w3)")}
      >
        <ListChecks size={20} strokeWidth={1.8} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0" style={{ zIndex: 1400 }}>
          {/* Click-away backdrop (also the tap-to-close gap on phone). */}
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
                  <ListChecks size={18} /> {T.title}
                </h2>
                <button onClick={() => setOpen(false)} aria-label="Close"
                  style={{ background: "none", border: "none", color: "var(--w3)", cursor: "pointer", padding: 4 }}>
                  <X size={20} />
                </button>
              </div>
              {checklist && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--w3)", marginBottom: 5 }}>
                    <span>{checklist.requiredComplete}/{checklist.requiredTotal}</span>
                    <span><strong style={{ color: "var(--w)" }}>{checklist.pct}%</strong> {T.complete}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: "var(--card)", overflow: "hidden" }}>
                    <div style={{ width: `${checklist.pct}%`, height: "100%", background: checklist.pct === 100 ? "#16a34a" : checklist.pct >= 50 ? "#f59e0b" : "#ef4444", transition: "width .3s" }} />
                  </div>
                </div>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 28px" }}>
              {!checklist ? (
                <div style={{ textAlign: "center", color: "var(--w3)", padding: "2rem 0" }}>…</div>
              ) : checklist.counts.missing === 0 && checklist.counts.rejected === 0 && checklist.counts.pending === 0 ? (
                <div style={{ textAlign: "center", color: "var(--success)", padding: "1.5rem 0", fontSize: 13.5, fontWeight: 600 }}>
                  ✓ {T.allSet}
                </div>
              ) : null}

              {checklist && (["essentials", "qualifications"] as const).map(group => (
                <div key={group} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--w3)", marginBottom: 7 }}>
                    {group === "essentials" ? T.essentials : T.qualifications}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {checklist.items.filter(i => i.group === group).map(i => (
                      <div key={i.key} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
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
              ))}
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
