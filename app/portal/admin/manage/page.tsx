"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { meToken } from "@/lib/meApi";
import { Trash2, Users, Copy, ChevronDown, Check, Plus } from "lucide-react";
import { PageLoader } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { Modal } from "@/components/ui/Modal";
import { PageHead, Btn, Card, Field, Empty, Pager, usePaged, STATUS_TINT } from "@/components/fx/kit";

const t = {
  en: {
    pageTitle: "Manage admins",
    pageDesc: "Give each agent a list of candidates to look after",
    accessNote: "Who looks after whom — not who may see: a sub-admin in an organisation sees its approved candidates, one in none sees all.",
    back: "Back",
    cancel: "Cancel",
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
    noAdminsSub: "Add your first agent above, then choose which candidates they look after.",
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
    actionError: "Could not save the change — nothing was changed. Try again.",
  },
  fr: {
    pageTitle: "Gérer les admins",
    pageDesc: "Donner à chaque agent une liste de candidats à suivre",
    accessNote: "Qui suit qui — pas qui voit : un sous-admin d’une organisation voit ses candidats approuvés, sans organisation il voit tout.",
    back: "Retour",
    cancel: "Annuler",
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
    noAdminsSub: "Ajoutez votre premier agent ci-dessus, puis choisissez les candidats qu’il suit.",
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
    actionError: "Modification non enregistrée — rien n'a changé. Réessayez.",
  },
  de: {
    pageTitle: "Admins verwalten",
    pageDesc: "Jedem Agenten eine Liste von Kandidaten zur Betreuung geben",
    accessNote: "Wer wen betreut — nicht, wer was sieht: Sub-Admins einer Organisation sehen deren freigegebene Kandidaten, ohne Organisation alle.",
    back: "Zurück",
    cancel: "Abbrechen",
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
    noAdminsSub: "Fügen Sie oben Ihren ersten Agenten hinzu und wählen Sie, welche Kandidaten er betreut.",
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
    actionError: "Änderung konnte nicht gespeichert werden — nichts wurde geändert. Erneut versuchen.",
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
  // A remove / assign the server refused — shown above the list.
  const [actionError, setActionError] = useState(false);

  // Which sub-admin's assignment panel is open
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  // Which sub-admin's "Copy from…" picker is open (per row)
  const [copyOpenFor, setCopyOpenFor]     = useState<string | null>(null);
  // Track the in-flight "copy from" so we can show a spinner state
  const [copyingFrom, setCopyingFrom]     = useState<string | null>(null);

  // the one design: "Admin hinzufügen" opens the form as a popup (view only).
  // It closes itself once a save went through (adding true → false, no error).
  const [formOpen, setFormOpen] = useState(false);
  const addingWas = useRef(false);
  useEffect(() => {
    if (addingWas.current && !adding && !addError) setFormOpen(false);
    addingWas.current = adding;
  }, [adding, addError]);

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

  // The token in state is only the one read at mount — it expires after ~1h.
  // meToken() goes through getSession(), which refreshes an expired JWT.
  const freshToken = async () => (await meToken()) || accessToken;

  async function loadData(token: string) {
    const tk = (await meToken()) || token;
    const [saRes, candRes] = await Promise.all([
      fetch("/api/portal/admin/sub-admins", { headers: { Authorization: `Bearer ${tk}` } }),
      fetch("/api/portal/admin",            { headers: { Authorization: `Bearer ${tk}` } }),
    ]);

    // Only replace what actually loaded — a refused read must not blank the
    // panel into "no sub-admins, no candidates".
    if (saRes.ok) {
      const saJson = await saRes.json().catch(() => ({}));
      setSubAdmins(saJson.subAdmins ?? []);
      setAssignments(saJson.assignments ?? []);
    }

    if (candRes.ok) {
      const candJson = await candRes.json().catch(() => ({}));
      const docs: { user_id: string }[] = candJson.docs ?? [];
      const users: Record<string, { name: string; email: string }> = candJson.users ?? {};
      const unique = [...new Set(docs.map(d => d.user_id))];
      setCandidates(unique.map(uid => ({
        userId: uid,
        name:  users[uid]?.name  ?? uid,
        email: users[uid]?.email ?? uid,
      })));
    }
  }

  async function addSubAdmin() {
    if (!newEmail.trim()) { setAddError(T.emailLabel.replace(" *", "") + " is required."); return; }
    setAdding(true); setAddError("");
    const res = await fetch("/api/portal/admin/sub-admins", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await freshToken()}` },
      body: JSON.stringify({ email: newEmail.trim(), name: newName.trim(), label: newLabel.trim() }),
    });
    if (!res.ok) { setAddError(T.addError); setAdding(false); return; }
    setNewEmail(""); setNewName(""); setNewLabel("");
    await loadData(accessToken);
    setAdding(false);
  }

  async function removeSubAdmin(email: string) {
    setActionError(false);
    const res = await fetch("/api/portal/admin/sub-admins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await freshToken()}` },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    if (!res || !res.ok) setActionError(true);
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
    setActionError(false);
    try {
      const tk = await freshToken();
      // Fire in parallel — backend already idempotent via UNIQUE constraint
      const results = await Promise.all(
        toAdd.map(uid =>
          fetch("/api/portal/admin/sub-admins/assign", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` },
            body: JSON.stringify({ subAdminEmail: targetEmail, candidateUserId: uid }),
          }).catch(() => null)
        )
      );
      if (results.some(r => !r || !r.ok)) setActionError(true);
      await loadData(accessToken);
    } finally {
      setCopyingFrom(null);
      setCopyOpenFor(null);
    }
  }

  async function toggleAssignment(subAdminEmail: string, candidateUserId: string) {
    const exists = assignments.some(a => a.sub_admin_email === subAdminEmail && a.candidate_user_id === candidateUserId);
    setActionError(false);
    const res = await fetch("/api/portal/admin/sub-admins/assign", {
      method: exists ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await freshToken()}` },
      body: JSON.stringify({ subAdminEmail, candidateUserId }),
    }).catch(() => null);
    if (!res || !res.ok) setActionError(true);
    await loadData(accessToken);
  }

  if (loading) return <PageLoader />;

  const editing = subAdmins.find(sa => sa.email === expandedEmail) ?? null;

  // the one design (founder 2026-11-13): serif head, one black "add" pill, the agents as hairline rows that flip,
  // assigning + adding in the universal popup (LAW #36 via components/ui/Modal)
  return (
    <>
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[680px] mx-auto px-4 pt-8 pb-16">
        <PageHead back={{ label: T.back, onClick: () => router.back() }}
          title={T.pageTitle} sub={T.pageDesc}
          actions={<Btn kind="primary" size="sm" onClick={() => setFormOpen(true)}><Plus size={14} strokeWidth={2} />{T.addAdmin}</Btn>} />

        {/*
          Bug 9. This page said "Assign agents access to specific candidates"
          and the toggles below read Assign / Assigned — so the founder had
          every reason to believe that un-assigning a candidate took her away
          from an agent. It never did.

          The evidence is lib/admin-auth.ts, which holds the ONLY two functions
          that gate per-candidate access under LAW #25 — canActOnCandidate()
          and getVisibleCandidateScope(). Neither reads sub_admin_assignments;
          the word does not appear in that file. Scope is decided by exactly
          three things: the is_agency_admin flag, organization_members, and the
          approved rows in candidate_organizations. A sub-admin who belongs to
          no organisation returns `true` for every candidate on the portal, no
          matter what this page shows.

          So the toggles are not dead — sub_admin_assignments is real data that
          the assistant reads to answer "who is looking after her" and to hand a
          caseload from one agent to another — they were simply labelled as a
          permission. They are now labelled as what they are, and the sentence
          below states the rule that actually decides access.

          Making it REAL was the other option and was deliberately not taken: it
          would mean adding a fourth scoping trigger to the security core of a
          live portal, and the moment assignments started restricting, every
          sub-admin with no assignment rows would lose all ~93 candidates at
          once. That is a founder's decision, not a bug fix.
        */}
        <p style={{ margin: "-6px 0 16px", fontSize: 12.5, lineHeight: 1.5, color: "var(--w3)" }}>{T.accessNote}</p>

        {actionError && (
          <div role="alert" style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>
            {T.actionError}
          </div>
        )}

        {/* Sub-admin list */}
        {subAdmins.length === 0 ? (
          <Card>
            <Empty icon={<Users size={20} strokeWidth={1.6} style={{ color: "var(--gold)" }} />}>
              <span style={{ color: "var(--w)", fontWeight: 500 }}>{T.noAdmins}</span>
              <span style={{ fontSize: 12.5, marginTop: -4 }}>{T.noAdminsSub}</span>
            </Empty>
          </Card>
        ) : (
          <Paged items={subAdmins} per={8} perPhone={5}>
            {(slice) => (
              <Card style={{ padding: "2px 16px" }}>
                {slice.map((sa, i) => {
                  const assigned = assignments.filter(a => a.sub_admin_email === sa.email).map(a => a.candidate_user_id);
                  const isExpanded = expandedEmail === sa.email;
                  return (
                    <div key={sa.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sa.name || sa.email}</div>
                        <div style={{ fontSize: 12.5, color: "var(--w3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {sa.email}{sa.label ? ` · ${sa.label}` : ""}
                        </div>
                      </div>
                      <span title={T.candidates(assigned.length)} aria-label={T.candidates(assigned.length)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--w3)", fontVariantNumeric: "tabular-nums", flex: "none" }}>
                        <Users size={13} strokeWidth={1.7} />{assigned.length}
                      </span>
                      <Btn kind="ghost" size="sm" onClick={() => setExpandedEmail(isExpanded ? null : sa.email)}>
                        {isExpanded ? T.close : T.assign}
                      </Btn>
                      <Btn kind="quiet" size="sm" icon onClick={() => removeSubAdmin(sa.email)} aria-label="Remove" title="Remove">
                        <Trash2 size={14} strokeWidth={1.8} />
                      </Btn>
                    </div>
                  );
                })}
              </Card>
            )}
          </Paged>
        )}
      </div>
    </main>

    {/* Candidate assignment — the universal popup */}
    <Modal open={!!editing} onClose={() => setExpandedEmail(null)} size="md" chromeless>
      {editing && (() => {
        const sa = editing;
        const assigned = assignments.filter(a => a.sub_admin_email === sa.email).map(a => a.candidate_user_id);
        const others = subAdmins.filter(o => o.email !== sa.email);
        const copyOpen = copyOpenFor === sa.email;
        return (
          <div style={{ padding: 22 }}>
            <PopHead title={sa.name || sa.email} sub={T.candidates(assigned.length)} onClose={() => setExpandedEmail(null)} closeLabel={T.close} />

            {actionError && (
              <div role="alert" style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>
                {T.actionError}
              </div>
            )}

            {/* Copy-from-other-admin row */}
            {others.length > 0 && candidates.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "4px 0 12px" }}>
                <span style={{ fontSize: 12.5, color: "var(--w3)" }}>{T.mirrorDesc}</span>
                <Btn kind="ghost" size="sm" onClick={() => setCopyOpenFor(copyOpen ? null : sa.email)} aria-expanded={copyOpen}>
                  <Copy size={13} strokeWidth={1.8} />{T.copyFrom}
                  <ChevronDown size={12} strokeWidth={2} style={{ transform: copyOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }} />
                </Btn>
              </div>
            )}

            {copyOpen ? (
              /* the other agents to copy from (same handler as before) */
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {others.map(other => {
                  const otherCount = assignments.filter(a => a.sub_admin_email === other.email).length;
                  const myAssigned = new Set(assigned);
                  const overlap = assignments.filter(a => a.sub_admin_email === other.email && myAssigned.has(a.candidate_user_id)).length;
                  const newOnes = otherCount - overlap;
                  const disabled = newOnes === 0 || copyingFrom === other.email;
                  return (
                    <button key={other.email} type="button" disabled={disabled} onClick={() => copyAssignmentsFrom(sa.email, other.email)}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: "var(--w)" }}>{other.name || other.email}</span>
                      <span style={{ display: "block", fontSize: 12.5, color: "var(--w3)", marginTop: 2 }}>
                        {copyingFrom === other.email ? T.copying : newOnes === 0 ? T.alreadyShares : T.newCandidates(newOnes, otherCount)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : candidates.length === 0 ? (
              <Empty>{T.noCandidates}</Empty>
            ) : (
              <Paged items={candidates} per={7} perPhone={6}>
                {(slice) => (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {slice.map(c => {
                      const isAssigned = assigned.includes(c.userId);
                      return (
                        <div key={c.userId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 8px 9px 14px", borderRadius: 12,
                          background: isAssigned ? STATUS_TINT.approved : "transparent", border: `1px solid ${isAssigned ? "transparent" : "var(--border)"}` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                            <div style={{ fontSize: 12, color: "var(--w3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</div>
                          </div>
                          <Btn kind={isAssigned ? "quiet" : "ghost"} size="sm" onClick={() => toggleAssignment(sa.email, c.userId)}
                            style={isAssigned ? { color: "var(--w)", fontWeight: 600, padding: "0 10px" } : undefined}>
                            {isAssigned ? <><Check size={13} strokeWidth={2.4} style={{ color: "#16a34a" }} />{T.assigned}</> : T.assign}
                          </Btn>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Paged>
            )}
          </div>
        );
      })()}
    </Modal>

    {/* Add an admin — the universal popup */}
    <Modal open={formOpen} onClose={() => setFormOpen(false)} size="sm" chromeless busy={adding}>
      <div style={{ padding: 22 }}>
        <PopHead title={T.addSection} onClose={() => setFormOpen(false)} closeLabel={T.close} disabled={adding} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label={T.emailLabel}>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder={T.emailPlaceholder} className="bvk-input" autoFocus />
          </Field>
          <Field label={T.nameLabel}>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder={T.namePlaceholder} className="bvk-input" />
          </Field>
          <Field label={T.roleLabelField}>
            <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder={T.rolePlaceholder} className="bvk-input" />
          </Field>
          {addError && (
            <div role="alert" style={{ padding: "10px 14px", borderRadius: 12, background: STATUS_TINT.rejected, fontSize: 13, color: "var(--w)" }}>{addError}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <Btn kind="ghost" onClick={() => setFormOpen(false)} disabled={adding} style={{ flex: 1 }}>{T.cancel}</Btn>
          <Btn kind="primary" onClick={addSubAdmin} disabled={adding} style={{ flex: 1 }}>{adding ? T.adding : T.addAdmin}</Btn>
        </div>
      </div>
    </Modal>
    </>
  );
}

/** popup head in the one look: serif title, quiet sub, round close */
function PopHead({ title, sub, onClose, closeLabel, disabled }: { title: string; sub?: string; onClose: () => void; closeLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 24, lineHeight: 1.15, color: "var(--w)", overflowWrap: "anywhere" }}>{title}</h2>
        {sub && <div style={{ marginTop: 3, fontSize: 12.5, color: "var(--w3)" }}>{sub}</div>}
      </div>
      <button type="button" onClick={onClose} disabled={disabled} aria-label={closeLabel}
        style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--w3)", cursor: "pointer", flex: "none", fontFamily: "inherit" }}>✕</button>
    </div>
  );
}

/** lists flip instead of scrolling (components/fx/kit usePaged + Pager) */
function Paged<I>({ items, per, perPhone, children }: { items: I[]; per: number; perPhone: number; children: (slice: I[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}
