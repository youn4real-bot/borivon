"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PageHead, Card, Dot, Empty, Pager, usePaged, STATUS_DOT } from "@/components/fx/kit";
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
    back: "Back", candidates: "candidates", avg: "avg complete",
    search: "Search name or email…", none: "No candidates yet",
    noneSub: "Candidates show up here once they sign up.",
    complete: "complete", essentials: "Essentials", qualifications: "Qualifications",
    orig: "Original", trans: "Translation", optional: "optional",
    legDone: "Approved", legPending: "Awaiting review", legRej: "Needs reupload", legMiss: "Not submitted",
    labels: { id: "Passport", cv_de: "CV", letter: "Cover letter", langcert: "B2 certificate", diploma: "Diploma", studyprog: "Study program", transcript: "Transcript", abitur: "Abitur", abitur_transcript: "Abitur transcript", praktikum: "Internship", workcert: "Work permit", work_experience: "Work experience", impfung: "Vaccination" } as Record<string, string>,
  },
  fr: {
    title: "Progression des candidats", desc: "Où en est chacun avec ses papiers",
    back: "Retour", candidates: "candidats", avg: "complété en moy.",
    search: "Rechercher nom ou e-mail…", none: "Aucun candidat",
    noneSub: "Les candidats apparaissent ici dès leur inscription.",
    complete: "complété", essentials: "Essentiels", qualifications: "Qualifications",
    orig: "Original", trans: "Traduction", optional: "optionnel",
    legDone: "Approuvé", legPending: "En attente", legRej: "À renvoyer", legMiss: "Non soumis",
    labels: { id: "Passeport", cv_de: "CV", letter: "Lettre de motivation", langcert: "Certificat B2", diploma: "Diplôme", studyprog: "Programme d'études", transcript: "Relevé de notes", abitur: "Abitur", abitur_transcript: "Relevé Abitur", praktikum: "Stage", workcert: "Autorisation d'exercer", work_experience: "Expérience pro.", impfung: "Vaccination" } as Record<string, string>,
  },
  de: {
    title: "Kandidaten-Fortschritt", desc: "Wo jeder mit seinen Unterlagen steht",
    back: "Zurück", candidates: "Kandidaten", avg: "Ø abgeschlossen",
    search: "Name oder E-Mail suchen…", none: "Noch keine Kandidaten",
    noneSub: "Kandidaten erscheinen hier nach ihrer Anmeldung.",
    complete: "abgeschlossen", essentials: "Grundlagen", qualifications: "Qualifikationen",
    orig: "Original", trans: "Übersetzung", optional: "optional",
    legDone: "Genehmigt", legPending: "In Prüfung", legRej: "Neu hochladen", legMiss: "Nicht eingereicht",
    labels: { id: "Reisepass", cv_de: "Lebenslauf", letter: "Motivationsschreiben", langcert: "B2-Zertifikat", diploma: "Diplom", studyprog: "Ausbildungsprogramm", transcript: "Notenübersicht", abitur: "Abitur", abitur_transcript: "Abitur-Notenübersicht", praktikum: "Praktikum", workcert: "Berufserlaubnis", work_experience: "Berufserfahrung", impfung: "Impfnachweis" } as Record<string, string>,
  },
};

// LAW #4 — status conveyed by COLOR, never a text label on the item: the kit's status dots
// (components/fx/kit Dot — green approved · orange pending · red rejected · grey missing).

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
    // Reuse the existing admin endpoint — already scoped per LAW #25. Also pull
    // the org list so the % is measured against each candidate's agency required
    // set (e.g. Calmaroi), matching the main admin panel instead of the generic
    // catalog — otherwise the two boards would disagree on the same candidate.
    const [res, orgRes] = await Promise.all([
      fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/portal/admin/organizations", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const j = await res.json().catch(() => ({}));
    const docs: { user_id: string; file_type: string | null; status: string | null }[] = j.docs ?? [];
    const users: Record<string, { name?: string; email?: string }> = j.users ?? {};
    const candidateOrgs: Record<string, { id: string }[]> = j.candidateOrgs ?? {};
    const orgJson = await orgRes.json().catch(() => ({}));
    const orgReq: Record<string, string[] | null> = {};
    for (const o of (orgJson.orgs ?? []) as { id: string; requiredDocKeys?: string[] | null }[]) {
      orgReq[o.id] = o.requiredDocKeys ?? null;
    }
    const requiredKeysFor = (uid: string): string[] | null => {
      const orgId = (candidateOrgs[uid] ?? [])[0]?.id ?? null;
      return orgId ? (orgReq[orgId] ?? null) : null;
    };

    const byUser: Record<string, { file_type: string | null; status: string | null }[]> = {};
    for (const d of docs) (byUser[d.user_id] ??= []).push({ file_type: d.file_type, status: d.status });

    const list: Cand[] = Object.keys(users).map(uid => ({
      userId: uid,
      name: users[uid]?.name || users[uid]?.email || uid,
      email: users[uid]?.email || "",
      checklist: computeChecklist(byUser[uid] ?? [], { requiredKeys: requiredKeysFor(uid) }),
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

  const open = cands.find(c => c.userId === expanded) ?? null;
  const legend: [ItemStatus, string][] = [["approved", T.legDone], ["pending", T.legPending], ["rejected", T.legRej], ["missing", T.legMiss]];

  // the one design (founder 2026-11-13): serif head, the two numbers big, colour = status (LAW #4: dots, no words),
  // the candidates as hairline rows that flip; one candidate's papers in the universal popup (LAW #36)
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <PortalTopNav />
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "88px 1rem 4rem" }}>
        <PageHead back={{ label: T.back, onClick: () => router.push("/portal/admin") }} title={T.title} sub={T.desc} />

        {loading ? (
          <Card><Empty>…</Empty></Card>
        ) : cands.length === 0 ? (
          <Card>
            <Empty>
              <span style={{ color: "var(--w)", fontWeight: 500 }}>{T.none}</span>
              <span style={{ fontSize: 12.5, marginTop: -4 }}>{T.noneSub}</span>
            </Empty>
          </Card>
        ) : (
          <>
            {/* Summary + search */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 18, fontSize: 13, color: "var(--w3)" }}>
                <span><b style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 28, color: "var(--w)", marginRight: 6 }}>{cands.length}</b>{T.candidates}</span>
                <span><b style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 28, color: "var(--w)", marginRight: 6 }}>{avgPct}%</b>{T.avg}</span>
              </div>
              <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
                <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--w3)" }} />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={T.search} className="bvk-input" style={{ paddingLeft: 36 }} />
              </div>
            </div>

            {/* Legend — LAW #4: the colour is the status */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12, color: "var(--w3)", marginBottom: 12 }}>
              {legend.map(([s, l]) => <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Dot st={s} size={8} />{l}</span>)}
            </div>

            <ProgressRows rows={filtered} onOpen={(id) => setExpanded(expanded === id ? null : id)} complete={T.complete} />
          </>
        )}
      </main>

      {/* one candidate's papers — the universal popup */}
      <Modal open={!!open} onClose={() => setExpanded(null)} size="md" chromeless>
        {open && (
          <div style={{ padding: 22 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1.15, color: "var(--w)", overflowWrap: "anywhere" }}>{open.name}</h2>
                <div style={{ marginTop: 3, fontSize: 12.5, color: "var(--w3)", overflowWrap: "anywhere" }}>{open.checklist.pct}% {T.complete}{open.email ? ` · ${open.email}` : ""}</div>
              </div>
              <button type="button" onClick={() => setExpanded(null)} aria-label="✕"
                style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", cursor: "pointer", flex: "none", fontFamily: "inherit" }}>✕</button>
            </div>
            {(["essentials", "qualifications"] as const).map(group => (
              <div key={group} style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12.5, color: "var(--w3)", marginBottom: 6 }}>
                  {group === "essentials" ? T.essentials : T.qualifications}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "4px 18px" }}>
                  {open.checklist.items.filter(i => i.group === group).map(i => (
                    <div key={i.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--w)", padding: "4px 0" }}>
                      <Dot st={i.original} />
                      <span style={{ flex: "1 1 auto" }}>
                        {T.labels[i.key] ?? i.key}
                        {i.optional && <span style={{ color: "var(--w3)", fontSize: 11.5 }}> ({T.optional})</span>}
                      </span>
                      {i.hasTranslation && i.translation && (
                        <span title={T.trans} style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--w3)", fontSize: 11.5 }}>
                          {T.trans.slice(0, 2)} <Dot st={i.translation} size={8} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** the candidates as hairline rows that flip (components/fx/kit usePaged + Pager) */
function ProgressRows({ rows, onOpen, complete }: { rows: Cand[]; onOpen: (id: string) => void; complete: string }) {
  const { slice, page, pages, setPage, narrow } = usePaged(rows, 7, 5);
  if (rows.length === 0) return null;
  return (
    <>
      <Card style={{ padding: "2px 16px" }}>
        {slice.map((c, i) => {
          const { pct, counts } = c.checklist;
          const barColor = pct === 100 ? STATUS_DOT.approved : pct >= 50 ? STATUS_DOT.pending : STATUS_DOT.rejected;
          const countDots = (
            <span style={{ display: "inline-flex", gap: 10, fontSize: 12, color: "var(--w2)", fontVariantNumeric: "tabular-nums", flex: "none" }}>
              {([["approved", counts.complete], ["pending", counts.pending], ["rejected", counts.rejected], ["missing", counts.missing]] as [ItemStatus, number][]).map(([s, n]) => (
                <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Dot st={s} size={8} />{n}</span>
              ))}
            </span>
          );
          const bar = (
            <span style={{ display: "block", width: narrow ? "100%" : 96 }}>
              <span style={{ display: "block", height: 6, borderRadius: 999, background: "var(--bg2)", overflow: "hidden" }}>
                <span style={{ display: "block", width: `${pct}%`, height: "100%", borderRadius: 999, background: barColor, transition: "width .3s" }} />
              </span>
            </span>
          );
          return (
            <button key={c.userId} type="button" onClick={() => onOpen(c.userId)}
              style={{ width: "100%", display: "block", padding: "11px 0", background: "none", border: "none", borderTop: i ? "1px solid var(--border)" : "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
              {narrow ? (
                <>
                  <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: "var(--w)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <span style={{ fontSize: 12, color: "var(--w3)", flex: "none" }}>{pct}% {complete}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>{countDots}<span style={{ flex: 1 }}>{bar}</span></span>
                </>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                    {c.email && <span style={{ display: "block", fontSize: 12.5, color: "var(--w3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</span>}
                  </span>
                  {countDots}
                  <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
                    {bar}
                    <span style={{ fontSize: 12, color: "var(--w3)", width: 124, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{pct}% {complete}</span>
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </Card>
      <Pager page={page} pages={pages} onPage={setPage} />
    </>
  );
}
