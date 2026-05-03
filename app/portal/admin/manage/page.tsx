"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { CheckCircle2 } from "@/components/PortalIcons";
import { ArrowLeft, Trash2, Users, Copy, ChevronDown } from "lucide-react";
import { PageLoader, EmptyState } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";

const t = {
  en: {
    pageTitle: "Manage admins",
    pageDesc: "Assign agents access to specific candidates",
    addSection: "Add an admin",
    emailLabel: "Email *",
    nameLabel: "Name",
    roleLabelField: "Role / label",
    emailPlaceholder: "agent@agency.com",
    namePlaceholder: "Sarah M.",
    rolePlaceholder: "e.g. Recruitment Agency — Morocco",
    addError: "Could not add admin. Try again.",
    adding: "Adding…",
    addAdmin: "Add admin",
    noAdmins: "No admins added yet",
    noAdminsSub: "Add your first agent above and assign them specific candidates.",
    candidates: (n: number) => `${n} candidate${n !== 1 ? "s" : ""}`,
    close: "Close",
    assign: "Assign",
    assigned: "Assigned",
    mirrorDesc: "Mirror another admin's assignments to save time",
    copyFrom: "Copy from…",
    copying: "Copying…",
    alreadyShares: "Already shares all candidates",
    newCandidates: (n: number, total: number) => `+${n} new candidate${n !== 1 ? "s" : ""} (${total} total)`,
    noCandidates: "No candidates yet.",
  },
  fr: {
    pageTitle: "Gérer les admins",
    pageDesc: "Attribuer aux agents l'accès à des candidats spécifiques",
    addSection: "Ajouter un admin",
    emailLabel: "E-mail *",
    nameLabel: "Nom",
    roleLabelField: "Rôle / étiquette",
    emailPlaceholder: "agent@agence.com",
    namePlaceholder: "Sarah M.",
    rolePlaceholder: "ex. Agence de recrutement — Maroc",
    addError: "Impossible d'ajouter l'admin. Réessayez.",
    adding: "Ajout…",
    addAdmin: "Ajouter l'admin",
    noAdmins: "Aucun admin ajouté",
    noAdminsSub: "Ajoutez votre premier agent ci-dessus et assignez-lui des candidats.",
    candidates: (n: number) => `${n} candidat${n !== 1 ? "s" : ""}`,
    close: "Fermer",
    assign: "Assigner",
    assigned: "Assigné",
    mirrorDesc: "Copier les assignations d'un autre admin pour gagner du temps",
    copyFrom: "Copier depuis…",
    copying: "Copie…",
    alreadyShares: "Partage déjà tous les candidats",
    newCandidates: (n: number, total: number) => `+${n} nouveau${n !== 1 ? "x" : ""} candidat${n !== 1 ? "s" : ""} (${total} au total)`,
    noCandidates: "Aucun candidat pour l'instant.",
  },
  de: {
    pageTitle: "Admins verwalten",
    pageDesc: "Agenten Zugang zu bestimmten Kandidaten geben",
    addSection: "Admin hinzufügen",
    emailLabel: "E-Mail *",
    nameLabel: "Name",
    roleLabelField: "Rolle / Bezeichnung",
    emailPlaceholder: "agent@agentur.com",
    namePlaceholder: "Sarah M.",
    rolePlaceholder: "z. B. Rekrutierungsagentur — Marokko",
    addError: "Admin konnte nicht hinzugefügt werden. Erneut versuchen.",
    adding: "Hinzufügen…",
    addAdmin: "Admin hinzufügen",
    noAdmins: "Noch keine Admins hinzugefügt",
    noAdminsSub: "Fügen Sie oben Ihren ersten Agenten hinzu und weisen Sie ihm Kandidaten zu.",
    candidates: (n: number) => `${n} Kandidat${n !== 1 ? "en" : ""}`,
    close: "Schließen",
    assign: "Zuweisen",
    assigned: "Zugewiesen",
    mirrorDesc: "Zuweisungen eines anderen Admins spiegeln, um Zeit zu sparen",
    copyFrom: "Kopieren von…",
    copying: "Kopiere…",
    alreadyShares: "Teilt bereits alle Kandidaten",
    newCandidates: (n: number, total: number) => `+${n} neue${n !== 1 ? "" : "r"} Kandidat${n !== 1 ? "en" : ""} (${total} gesamt)`,
    noCandidates: "Noch keine Kandidaten.",
  },
};

type SubAdmin = { id: string; email: string; name: string; label: string; created_at: string };
type Assignment = { sub_admin_email: string; candidate_user_id: string };
type Candidate = { userId: string; name: string; email: string };

export default function ManageAdminsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = t[lang as keyof typeof t] ?? t.en;
  const [accessToken, setAccessToken] = useState("");
  const [subAdmins, setSubAdmins]   = useState<SubAdmin[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading]       = useState(true);

  // Add form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName]   = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding]     = useState(false);
  const [addError, setAddError] = useState("");

  // Which sub-admin's assignment panel is open
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  // Which sub-admin's "Copy from…" picker is open (per row)
  const [copyOpenFor, setCopyOpenFor]     = useState<string | null>(null);
  // Track the in-flight "copy from" so we can show a spinner state
  const [copyingFrom, setCopyingFrom]     = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const token = session.access_token ?? "";
      // Server confirms the role — never trust a client-side email comparison.
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${token}` } });
      const { role } = await roleRes.json().catch(() => ({ role: null }));
      if (role !== "admin") { router.replace("/portal"); return; }
      setAccessToken(token);
      await loadData(token);
      setLoading(false);
    });
  }, [router]);

  async function loadData(token: string) {
    const [saRes, candRes] = await Promise.all([
      fetch("/api/portal/admin/sub-admins", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/portal/admin",            { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const saJson   = await saRes.json();
    const candJson = await candRes.json();

    setSubAdmins(saJson.subAdmins ?? []);
    setAssignments(saJson.assignments ?? []);

    const docs: { user_id: string }[] = candJson.docs ?? [];
    const users: Record<string, { name: string; email: string }> = candJson.users ?? {};
    const unique = [...new Set(docs.map(d => d.user_id))];
    setCandidates(unique.map(uid => ({
      userId: uid,
      name:  users[uid]?.name  ?? uid,
      email: users[uid]?.email ?? uid,
    })));
  }

  async function addSubAdmin() {
    if (!newEmail.trim()) { setAddError(T.emailLabel.replace(" *", "") + " is required."); return; }
    setAdding(true); setAddError("");
    const res = await fetch("/api/portal/admin/sub-admins", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email: newEmail.trim(), name: newName.trim(), label: newLabel.trim() }),
    });
    if (!res.ok) { setAddError(T.addError); setAdding(false); return; }
    setNewEmail(""); setNewName(""); setNewLabel("");
    await loadData(accessToken);
    setAdding(false);
  }

  async function removeSubAdmin(email: string) {
    await fetch("/api/portal/admin/sub-admins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email }),
    });
    await loadData(accessToken);
  }

  /**
   * Copy assignments from one sub-admin to another. Idempotent — already-assigned
   * candidates are skipped, so this never duplicates. Useful when onboarding a new
   * agent who should mirror an experienced one's caseload, or rebalancing.
   */
  async function copyAssignmentsFrom(targetEmail: string, sourceEmail: string) {
    const sourceCandidates = assignments
      .filter(a => a.sub_admin_email === sourceEmail)
      .map(a => a.candidate_user_id);
    const alreadyAssigned = new Set(
      assignments
        .filter(a => a.sub_admin_email === targetEmail)
        .map(a => a.candidate_user_id)
    );
    const toAdd = sourceCandidates.filter(uid => !alreadyAssigned.has(uid));
    if (toAdd.length === 0) return;

    setCopyingFrom(sourceEmail);
    try {
      // Fire in parallel — backend already idempotent via UNIQUE constraint
      await Promise.all(
        toAdd.map(uid =>
          fetch("/api/portal/admin/sub-admins/assign", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ subAdminEmail: targetEmail, candidateUserId: uid }),
          })
        )
      );
      await loadData(accessToken);
    } finally {
      setCopyingFrom(null);
      setCopyOpenFor(null);
    }
  }

  async function toggleAssignment(subAdminEmail: string, candidateUserId: string) {
    const exists = assignments.some(a => a.sub_admin_email === subAdminEmail && a.candidate_user_id === candidateUserId);
    await fetch("/api/portal/admin/sub-admins/assign", {
      method: exists ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ subAdminEmail, candidateUserId }),
    });
    await loadData(accessToken);
  }

  if (loading) return <PageLoader />;

  const inputCls = "w-full px-3 py-2.5 text-[13px] outline-none transition-colors focus:border-[var(--gold)]";
  const inputSt: React.CSSProperties = {
    background: "var(--bg2)",
    border: "1px solid transparent",
    color: "var(--w)",
    borderRadius: "12px",
  };

  return (
    <>
    <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[680px] mx-auto px-4 pt-8 pb-16">

        {/* Header — refined */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => router.back()} aria-label="Back"
            className="bv-icon-btn w-9 h-9 flex items-center justify-center flex-shrink-0 rounded-full"
            style={{ color: "var(--w2)" }}>
            <ArrowLeft size={15} strokeWidth={1.8} />
          </button>
          <div>
            <h1 className="text-[20px] font-semibold tracking-[-0.015em]" style={{ color: "var(--w)" }}>{T.pageTitle}</h1>
            <p className="text-[12.5px] mt-1" style={{ color: "var(--w3)" }}>
              {T.pageDesc}
            </p>
          </div>
        </div>

        {/* Add new sub-admin — quieter section card */}
        <div className="p-5 mb-6"
          style={{ background: "var(--card)", border: "none", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-4" style={{ color: "var(--w3)" }}>{T.addSection}</p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>{T.emailLabel}</label>
                <input
                  type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                  placeholder={T.emailPlaceholder}
                  className={inputCls} style={inputSt}
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>{T.nameLabel}</label>
                <input
                  type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder={T.namePlaceholder}
                  className={inputCls} style={inputSt}
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>{T.roleLabelField}</label>
              <input
                type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder={T.rolePlaceholder}
                className={inputCls} style={inputSt}
              />
            </div>
            {addError && (
              <p className="text-[12px] px-3 py-2 rounded-lg"
                style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                {addError}
              </p>
            )}
            <button onClick={addSubAdmin} disabled={adding}
              className="w-full py-2.5 text-[13px] font-semibold tracking-tight transition-opacity disabled:opacity-50"
              style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-sm)" }}>
              {adding ? T.adding : T.addAdmin}
            </button>
          </div>
        </div>

        {/* Sub-admin list */}
        {subAdmins.length === 0 ? (
          <EmptyState
            Icon={Users}
            title={T.noAdmins}
            sub={T.noAdminsSub}
          />
        ) : (
          <div className="overflow-hidden"
            style={{
              background: "var(--card)",
              borderRadius: "20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}>
            {subAdmins.map(sa => {
              const assigned = assignments.filter(a => a.sub_admin_email === sa.email).map(a => a.candidate_user_id);
              const isExpanded = expandedEmail === sa.email;
              return (
                <div key={sa.email} className="bv-row-hover overflow-hidden transition-colors"
                  style={{ borderBottom: "1px solid var(--border)" }}>

                  {/* Sub-admin row */}
                  <div className="px-3 py-3 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold tracking-wider flex-shrink-0"
                      style={{ background: "var(--gdim)", color: "var(--gold)" }}>
                      {(sa.name || sa.email).charAt(0).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>
                        {sa.name || sa.email}
                      </p>
                      <p className="text-[11.5px] truncate mt-0.5" style={{ color: "var(--w3)" }}>
                        {sa.email}{sa.label ? ` · ${sa.label}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10.5px] font-semibold tracking-wide px-2 py-0.5 rounded-full"
                        style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                        {T.candidates(assigned.length)}
                      </span>
                      <button
                        onClick={() => setExpandedEmail(isExpanded ? null : sa.email)}
                        className="text-[12px] font-medium px-3 py-1.5 transition-colors"
                        style={{ background: isExpanded ? "var(--gdim)" : "var(--bg2)", color: isExpanded ? "var(--gold)" : "var(--w2)", border: `1px solid ${isExpanded ? "var(--border-gold)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                        {isExpanded ? T.close : T.assign}
                      </button>
                      <button onClick={() => removeSubAdmin(sa.email)} aria-label="Remove"
                        className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center">
                        <Trash2 size={12} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>

                  {/* Candidate assignment panel */}
                  {isExpanded && (
                    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg2)" }}>
                      {/* Copy-from-other-admin row */}
                      {subAdmins.filter(o => o.email !== sa.email).length > 0 && candidates.length > 0 && (
                        <div className="px-5 py-3 flex items-center justify-between gap-3 relative"
                          style={{ borderBottom: "1px solid var(--border)" }}>
                          <p className="text-[11.5px]" style={{ color: "var(--w3)" }}>
                            {T.mirrorDesc}
                          </p>
                          <div className="relative">
                            <button
                              onClick={() => setCopyOpenFor(copyOpenFor === sa.email ? null : sa.email)}
                              className="inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1.5 transition-colors"
                              style={{ background: copyOpenFor === sa.email ? "var(--gdim)" : "var(--card)", color: copyOpenFor === sa.email ? "var(--gold)" : "var(--w2)", border: `1px solid ${copyOpenFor === sa.email ? "var(--border-gold)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                              <Copy size={11} strokeWidth={1.8} />
                              {T.copyFrom}
                              <ChevronDown size={10} strokeWidth={2} style={{ transform: copyOpenFor === sa.email ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms" }} />
                            </button>
                            {copyOpenFor === sa.email && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setCopyOpenFor(null)} />
                                <div className="absolute right-0 top-full mt-1 z-20 overflow-hidden min-w-[220px]"
                                  style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-md)" }}>
                                  {subAdmins.filter(o => o.email !== sa.email).map(other => {
                                    const otherCount = assignments.filter(a => a.sub_admin_email === other.email).length;
                                    const myAssigned = new Set(assignments.filter(a => a.sub_admin_email === sa.email).map(a => a.candidate_user_id));
                                    const overlap = assignments.filter(a => a.sub_admin_email === other.email && myAssigned.has(a.candidate_user_id)).length;
                                    const newOnes = otherCount - overlap;
                                    const disabled = newOnes === 0 || copyingFrom === other.email;
                                    return (
                                      <button key={other.email}
                                        disabled={disabled}
                                        onClick={() => copyAssignmentsFrom(sa.email, other.email)}
                                        className="bv-row-hover w-full text-left px-3 py-2.5 disabled:opacity-40">
                                        <p className="text-[12.5px] font-medium" style={{ color: "var(--w)" }}>{other.name || other.email}</p>
                                        <p className="text-[10.5px] mt-0.5" style={{ color: "var(--w3)" }}>
                                          {copyingFrom === other.email ? T.copying
                                            : newOnes === 0 ? T.alreadyShares
                                            : T.newCandidates(newOnes, otherCount)}
                                        </p>
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {candidates.length === 0 ? (
                        <p className="px-5 py-4 text-[12px]" style={{ color: "var(--w3)" }}>{T.noCandidates}</p>
                      ) : candidates.map((c, ci) => {
                        const isAssigned = assigned.includes(c.userId);
                        return (
                          <div key={c.userId}>
                            {ci > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                            <div className="px-5 py-3 flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10.5px] font-semibold tracking-wider flex-shrink-0"
                                style={{ background: "var(--card)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                                {c.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[12.5px] font-medium truncate tracking-tight" style={{ color: "var(--w)" }}>{c.name}</p>
                                <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--w3)" }}>{c.email}</p>
                              </div>
                              <button
                                onClick={() => toggleAssignment(sa.email, c.userId)}
                                className="inline-flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 font-semibold transition-all flex-shrink-0"
                                style={isAssigned
                                  ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "var(--r-sm)" }
                                  : { background: "var(--card)", color: "var(--w2)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)" }
                                }>
                                {isAssigned ? <><CheckCircle2 size={11} strokeWidth={1.8} /> {T.assigned}</> : T.assign}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
    </>
  );
}
