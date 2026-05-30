"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { ArrowLeft, ChevronDown, Check, Clock, X, Minus, Search } from "lucide-react";
import {
  computeChecklist,
  CHECKLIST_ITEMS,
  type Checklist,
  type ItemStatus,
} from "@/lib/candidateChecklist";

// ── Local i18n (admin sub-pages keep their own `t`, like manage/) ────────────
const t = {
  en: {
    title: "Candidate progress", desc: "Where everyone is with their papers",
    back: "Portal", candidates: "candidates", avg: "avg complete",
    search: "Search name or email…", none: "No candidates yet",
    noneSub: "Candidates show up here once they sign up.",
    complete: "complete", essentials: "Essentials", qualifications: "Qualifications",
    orig: "Original", trans: "Translation", optional: "optional",
    legDone: "Approved", legPending: "Awaiting review", legRej: "Needs reupload", legMiss: "Not submitted",
    labels: { id: "Passport", cv_de: "CV", letter: "Cover letter", langcert: "B2 certificate", diploma: "Diploma", studyprog: "Study program", transcript: "Transcript", abitur: "Abitur", abitur_transcript: "Abitur transcript", praktikum: "Internship", workcert: "Work permit", work_experience: "Work experience", impfung: "Vaccination" } as Record<string, string>,
  },
  fr: {
    title: "Progression des candidats", desc: "Où en est chacun avec ses papiers",
    back: "Portail", candidates: "candidats", avg: "complété en moy.",
    search: "Rechercher nom ou e-mail…", none: "Aucun candidat",
    noneSub: "Les candidats apparaissent ici dès leur inscription.",
    complete: "complété", essentials: "Essentiels", qualifications: "Qualifications",
    orig: "Original", trans: "Traduction", optional: "optionnel",
    legDone: "Approuvé", legPending: "En attente", legRej: "À renvoyer", legMiss: "Non soumis",
    labels: { id: "Passeport", cv_de: "CV", letter: "Lettre de motivation", langcert: "Certificat B2", diploma: "Diplôme", studyprog: "Programme d'études", transcript: "Relevé de notes", abitur: "Abitur", abitur_transcript: "Relevé Abitur", praktikum: "Stage", workcert: "Autorisation d'exercer", work_experience: "Expérience pro.", impfung: "Vaccination" } as Record<string, string>,
  },
  de: {
    title: "Kandidaten-Fortschritt", desc: "Wo jeder mit seinen Unterlagen steht",
    back: "Portal", candidates: "Kandidaten", avg: "Ø abgeschlossen",
    search: "Name oder E-Mail suchen…", none: "Noch keine Kandidaten",
    noneSub: "Kandidaten erscheinen hier nach ihrer Anmeldung.",
    complete: "abgeschlossen", essentials: "Grundlagen", qualifications: "Qualifikationen",
    orig: "Original", trans: "Übersetzung", optional: "optional",
    legDone: "Genehmigt", legPending: "In Prüfung", legRej: "Neu hochladen", legMiss: "Nicht eingereicht",
    labels: { id: "Reisepass", cv_de: "Lebenslauf", letter: "Motivationsschreiben", langcert: "B2-Zertifikat", diploma: "Diplom", studyprog: "Ausbildungsprogramm", transcript: "Notenübersicht", abitur: "Abitur", abitur_transcript: "Abitur-Notenübersicht", praktikum: "Praktikum", workcert: "Berufserlaubnis", work_experience: "Berufserfahrung", impfung: "Impfnachweis" } as Record<string, string>,
  },
};

// LAW #4 — status conveyed by COLOR + icon, never a text label on the item.
const STATUS_STYLE: Record<ItemStatus, { color: string }> = {
  approved: { color: "#16a34a" },
  pending:  { color: "#f59e0b" },
  rejected: { color: "#ef4444" },
  missing:  { color: "#9ca3af" },
};
function StatusIcon({ s, size = 15 }: { s: ItemStatus; size?: number }) {
  const c = STATUS_STYLE[s].color;
  if (s === "approved") return <Check size={size} style={{ color: c }} strokeWidth={3} />;
  if (s === "pending")  return <Clock size={size} style={{ color: c }} />;
  if (s === "rejected") return <X size={size} style={{ color: c }} strokeWidth={3} />;
  return <Minus size={size} style={{ color: c }} />;
}

type Cand = { userId: string; name: string; email: string; checklist: Checklist };

export default function AdminProgressPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = t[lang as keyof typeof t] ?? t.en;

  const [loading, setLoading] = useState(true);
  const [cands, setCands] = useState<Cand[]>([]);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const token = session.access_token ?? "";
      // Server confirms the role — never trust a client email check.
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${token}` } });
      const j = await roleRes.json().catch(() => ({ role: null }));
      const role = j?.role;
      if (role !== "admin" && role !== "sub_admin") { router.replace("/portal"); return; }
      // Candidate-progress is a Borivon-HQ tool — org-scoped admins are bounced.
      if (role === "sub_admin" && j?.isAgencyAdmin === true) { router.replace("/portal/admin"); return; }
      await load(token);
      setLoading(false);
    });
  }, [router]);

  async function load(token: string) {
    // Reuse the existing admin endpoint — already scoped per LAW #25.
    const res = await fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json().catch(() => ({}));
    const docs: { user_id: string; file_type: string | null; status: string | null }[] = j.docs ?? [];
    const users: Record<string, { name?: string; email?: string }> = j.users ?? {};

    const byUser: Record<string, { file_type: string | null; status: string | null }[]> = {};
    for (const d of docs) (byUser[d.user_id] ??= []).push({ file_type: d.file_type, status: d.status });

    const list: Cand[] = Object.keys(users).map(uid => ({
      userId: uid,
      name: users[uid]?.name || users[uid]?.email || uid,
      email: users[uid]?.email || "",
      checklist: computeChecklist(byUser[uid] ?? []),
    }));
    // Least-complete first → who needs attention bubbles to the top.
    list.sort((a, b) => a.checklist.pct - b.checklist.pct || a.name.localeCompare(b.name));
    setCands(list);
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cands;
    return cands.filter(c => c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle));
  }, [cands, q]);

  const avgPct = cands.length
    ? Math.round(cands.reduce((s, c) => s + c.checklist.pct, 0) / cands.length)
    : 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg2)" }}>
      <PortalTopNav />
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "1.25rem 1rem 4rem" }}>
        <button onClick={() => router.push("/portal/admin")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--w3)", fontSize: 13, marginBottom: 14, background: "none", border: "none", cursor: "pointer" }}>
          <ArrowLeft size={15} /> {T.back}
        </button>

        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--w)" }}>{T.title}</h1>
          <p style={{ fontSize: 13.5, color: "var(--w3)", marginTop: 2 }}>{T.desc}</p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "var(--w3)", padding: "3rem 0" }}>…</div>
        ) : cands.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--w3)" }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--w2)" }}>{T.none}</p>
            <p style={{ fontSize: 13, marginTop: 4 }}>{T.noneSub}</p>
          </div>
        ) : (
          <>
            {/* Summary + search */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "var(--w2)" }}>
                <strong style={{ color: "var(--w)" }}>{cands.length}</strong> {T.candidates}
                <span style={{ color: "var(--w3)", margin: "0 8px" }}>·</span>
                <strong style={{ color: "var(--w)" }}>{avgPct}%</strong> {T.avg}
              </div>
              <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={T.search}
                  style={{ width: "100%", padding: "8px 10px 8px 32px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13 }} />
              </div>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: "var(--w3)", marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><StatusIcon s="approved" size={13} /> {T.legDone}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><StatusIcon s="pending" size={13} /> {T.legPending}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><StatusIcon s="rejected" size={13} /> {T.legRej}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><StatusIcon s="missing" size={13} /> {T.legMiss}</span>
            </div>

            {/* Rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filtered.map(c => {
                const open = expanded === c.userId;
                const { pct, counts } = c.checklist;
                const barColor = pct === 100 ? "#16a34a" : pct >= 50 ? "#f59e0b" : "#ef4444";
                return (
                  <div key={c.userId} style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
                    <button onClick={() => setExpanded(open ? null : c.userId)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                        {c.email && <div style={{ fontSize: 11.5, color: "var(--w3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</div>}
                      </div>
                      {/* count chips (icon + number, no status words → LAW #4) */}
                      <div style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--w2)" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><StatusIcon s="approved" size={13} />{counts.complete}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><StatusIcon s="pending" size={13} />{counts.pending}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><StatusIcon s="rejected" size={13} />{counts.rejected}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><StatusIcon s="missing" size={13} />{counts.missing}</span>
                      </div>
                      {/* progress */}
                      <div style={{ width: 90, flexShrink: 0 }}>
                        <div style={{ height: 6, borderRadius: 3, background: "var(--bg2)", overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: barColor, transition: "width .3s" }} />
                        </div>
                        <div style={{ fontSize: 11, color: "var(--w3)", marginTop: 3, textAlign: "right" }}>{pct}% {T.complete}</div>
                      </div>
                      <ChevronDown size={16} style={{ color: "var(--w3)", flexShrink: 0, transition: "transform .2s", transform: open ? "rotate(180deg)" : "none" }} />
                    </button>

                    {open && (
                      <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px 14px" }}>
                        {(["essentials", "qualifications"] as const).map(group => (
                          <div key={group} style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--w3)", marginBottom: 6 }}>
                              {group === "essentials" ? T.essentials : T.qualifications}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 6 }}>
                              {c.checklist.items.filter(i => i.group === group).map(i => (
                                <div key={i.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--w2)", padding: "3px 0" }}>
                                  <StatusIcon s={i.original} />
                                  <span style={{ flex: "1 1 auto" }}>
                                    {T.labels[i.key] ?? i.key}
                                    {i.optional && <span style={{ color: "var(--w3)", fontSize: 10.5 }}> ({T.optional})</span>}
                                  </span>
                                  {i.hasTranslation && i.translation && (
                                    <span title={T.trans} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--w3)", fontSize: 10.5 }}>
                                      {T.trans.slice(0, 2)} <StatusIcon s={i.translation} size={13} />
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
