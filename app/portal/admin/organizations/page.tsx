"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { meToken } from "@/lib/meApi";
import { Building2, Trash2, Copy, Check, Plus, UserPlus, X as XIcon, RefreshCw, Crown, User as UserIcon, FileText } from "lucide-react";
import { PageLoader, Spinner } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { CHECKLIST_ITEMS } from "@/lib/candidateChecklist";
import { PageHead, Btn, Card, Seg, Dot, Field, Empty, Pager, usePaged, STATUS_DOT, STATUS_TINT } from "@/components/fx/kit";

const t = {
  en: {
    organizations: "Agencies",
    managePartners: "Manage partners, their requirements, and linked candidates",
    cancel: "Cancel",
    newOrg: "New agency",
    newOrganization: "New agency",
    nameStar: "Name *",
    inviteCode: "Invite code",
    inviteCodeAuto: "(auto if blank)",
    internalNotes: "Internal notes",
    creating: "Creating…",
    create: "Create",
    joinRequests: "Join requests",
    noOrgsYet: "No agencies yet",
    createFirstOne: "Create your first one above.",
    openReqs: (n: number) => `${n} open req${n !== 1 ? "s" : ""}`,
    pending: (n: number) => `${n} pending`,
    candidateLink: "Candidate link",
    adminLink: "Admin link",
    manage: "Manage",
    tabRequirements: "Requirements",
    tabCandidates: "Candidates",
    tabMembers: "Members",
    tabBranding: "CV Branding",
    whatOrgNeeds: "What this agency needs — drives automatic candidate matching.",
    addRequirement: "Add requirement",
    saving: "Saving…",
    noRequirementsYet: "No requirements yet",
    addWhatOrgNeeds: "Add what this agency needs — matching candidates are suggested automatically.",
    closed: "closed",
    specialty: "Specialty",
    slotsNeeded: "Slots needed",
    location: "Location",
    startDate: "Start date",
    notes: "Notes",
    optionalDetails: "Optional details",
    linkCandidatesBody: "Linked candidates are visible to every member of this agency.",
    noCandidatesYet: "No candidates in the system yet.",
    statusPending: "Pending",
    statusLinked: "Linked",
    actionLink: "Link",
    emailStar: "Email *",
    nameOptional: "Name (optional)",
    addMember: "Add member",
    noMembersYet: "No members yet.",
    brandingDescription: "Logo and footer appear on the generated CV of every linked candidate.",
    logo: "Logo",
    replaceLogo: "Replace logo",
    uploadLogo: "Upload logo",
    footerText: "Footer text",
    imageTooLarge: "Image too large — max 500 KB.",
    saved: "Saved!",
    saveBranding: "Save branding",
    singleUseWarning: "Single-use — valid for one person only",
    copied: "Copied!",
    copyLink: "Copy link",
    downloadQR: "Download QR",
    close: "Close",
    nameRequired: "Name is required.",
    couldNotCreate: "Could not create agency.",
    couldNotSave: "Could not save.",
    emailRequired: "Email required",
    couldNotAdd: "Could not add",
    add: "Add",
    membersDescription: "Members see every linked candidate. Add by email — they need a Borivon account.",
    memberEmailPlaceholder: "member@example.com",
    roleMember: "Member",
    roleOwner: "Owner",
    actionFailed: "Could not save the change — nothing was changed. Try again.",
    back: "Back",
    membersN: (n: number) => `${n} member${n !== 1 ? "s" : ""}`,
    candidatesN: (n: number) => `${n} candidate${n !== 1 ? "s" : ""}`,
    wantsToJoin: "wants to join",
    approve: "Approve",
    reject: "Reject",
    slotsN: (n: number) => `${n} slot${n !== 1 ? "s" : ""}`,
    fromDate: (d: string) => `from ${d}`,
    closeReq: "Close requirement",
    regenerate: "Regenerate invite code",
    deleteOrg: "Delete agency",
    copyCandidateTitle: "Copy single-use candidate invite link",
    qrCandidateTitle: "Single-use QR for a candidate",
    copyAdminTitle: "Copy single-use admin invite link",
    qrAdminTitle: "Single-use QR for an admin",
    legacySubAdmins: "Manage individual sub-admins (legacy)",
    removeLogo: "Remove logo",
    remove: "Remove",
    unlink: "Unlink",
    namePh: "e.g. Calmaroi GmbH",
    notesPh: "e.g. Berlin hospital group, contact: lukas@calmaroi.com",
    specialtyPh: "e.g. ICU nurse",
    locationPh: "e.g. Berlin",
  },
  fr: {
    organizations: "Agences",
    managePartners: "Gérer les partenaires, leurs besoins et les candidats associés",
    cancel: "Annuler",
    newOrg: "Nouvelle agence",
    newOrganization: "Nouvelle agence",
    nameStar: "Nom *",
    inviteCode: "Code d'invitation",
    inviteCodeAuto: "(auto si vide)",
    internalNotes: "Notes internes",
    creating: "Création…",
    create: "Créer",
    joinRequests: "Demandes d'adhésion",
    noOrgsYet: "Aucune agence pour l'instant",
    createFirstOne: "Créez la première ci-dessus.",
    openReqs: (n: number) => `${n} besoin${n !== 1 ? "s" : ""} ouvert${n !== 1 ? "s" : ""}`,
    pending: (n: number) => `${n} en attente`,
    candidateLink: "Lien candidat",
    adminLink: "Lien admin",
    manage: "Gérer",
    tabRequirements: "Besoins",
    tabCandidates: "Candidats",
    tabMembers: "Membres",
    tabBranding: "Branding CV",
    whatOrgNeeds: "Ce dont cette agence a besoin — déclenche la mise en correspondance automatique.",
    addRequirement: "Ajouter un besoin",
    saving: "Enregistrement…",
    noRequirementsYet: "Aucun besoin pour l'instant",
    addWhatOrgNeeds: "Ajoutez ses besoins — des candidats correspondants sont suggérés automatiquement.",
    closed: "fermé",
    specialty: "Spécialité",
    slotsNeeded: "Places nécessaires",
    location: "Lieu",
    startDate: "Date de début",
    notes: "Notes",
    optionalDetails: "Détails optionnels",
    linkCandidatesBody: "Les candidats associés sont visibles par tous les membres de l'agence.",
    noCandidatesYet: "Aucun candidat dans le système pour l'instant.",
    statusPending: "En attente",
    statusLinked: "Associé",
    actionLink: "Associer",
    emailStar: "E-mail *",
    nameOptional: "Nom (optionnel)",
    addMember: "Ajouter un membre",
    noMembersYet: "Aucun membre pour l'instant.",
    brandingDescription: "Logo et pied de page apparaissent sur le CV généré des candidats associés.",
    logo: "Logo",
    replaceLogo: "Remplacer le logo",
    uploadLogo: "Télécharger un logo",
    footerText: "Texte de pied de page",
    imageTooLarge: "Image trop grande — max 500 Ko.",
    saved: "Enregistré !",
    saveBranding: "Enregistrer le branding",
    singleUseWarning: "Usage unique — valable pour une seule personne",
    copied: "Copié !",
    copyLink: "Copier le lien",
    downloadQR: "Télécharger le QR",
    close: "Fermer",
    nameRequired: "Le nom est obligatoire.",
    couldNotCreate: "Impossible de créer l'agence.",
    couldNotSave: "Impossible d'enregistrer.",
    emailRequired: "E-mail requis",
    couldNotAdd: "Impossible d'ajouter",
    add: "Ajouter",
    membersDescription: "Les membres voient tous les candidats associés. Ajout par e-mail — compte Borivon requis.",
    memberEmailPlaceholder: "membre@exemple.com",
    roleMember: "Membre",
    roleOwner: "Propriétaire",
    actionFailed: "Modification non enregistrée — rien n'a changé. Réessayez.",
    back: "Retour",
    membersN: (n: number) => `${n} membre${n !== 1 ? "s" : ""}`,
    candidatesN: (n: number) => `${n} candidat${n !== 1 ? "s" : ""}`,
    wantsToJoin: "souhaite rejoindre",
    approve: "Accepter",
    reject: "Refuser",
    slotsN: (n: number) => `${n} place${n !== 1 ? "s" : ""}`,
    fromDate: (d: string) => `dès le ${d}`,
    closeReq: "Clôturer le besoin",
    regenerate: "Régénérer le code d'invitation",
    deleteOrg: "Supprimer l'agence",
    copyCandidateTitle: "Copier le lien d'invitation candidat (usage unique)",
    qrCandidateTitle: "QR à usage unique pour un candidat",
    copyAdminTitle: "Copier le lien d'invitation admin (usage unique)",
    qrAdminTitle: "QR à usage unique pour un admin",
    legacySubAdmins: "Gérer les sous-admins individuels (ancien)",
    removeLogo: "Retirer le logo",
    remove: "Retirer",
    unlink: "Dissocier",
    namePh: "ex. Calmaroi GmbH",
    notesPh: "ex. groupe hospitalier à Berlin, contact : lukas@calmaroi.com",
    specialtyPh: "ex. infirmier·ère en réanimation",
    locationPh: "ex. Berlin",
  },
  de: {
    organizations: "Agenturen",
    managePartners: "Partner, Anforderungen und Kandidaten verwalten",
    cancel: "Abbrechen",
    newOrg: "Neue Agentur",
    newOrganization: "Neue Agentur",
    nameStar: "Name *",
    inviteCode: "Einladungscode",
    inviteCodeAuto: "(auto wenn leer)",
    internalNotes: "Interne Notizen",
    creating: "Wird erstellt…",
    create: "Erstellen",
    joinRequests: "Beitrittsanfragen",
    noOrgsYet: "Noch keine Agenturen",
    createFirstOne: "Erstellen Sie die erste oben.",
    openReqs: (n: number) => `${n} offene Anforderung${n !== 1 ? "en" : ""}`,
    pending: (n: number) => `${n} ausstehend`,
    candidateLink: "Kandidaten-Link",
    adminLink: "Admin-Link",
    manage: "Verwalten",
    tabRequirements: "Anforderungen",
    tabCandidates: "Kandidaten",
    tabMembers: "Mitglieder",
    tabBranding: "Lebenslauf-Branding",
    whatOrgNeeds: "Was diese Agentur benötigt — löst automatisches Kandidaten-Matching aus.",
    addRequirement: "Anforderung hinzufügen",
    saving: "Speichern…",
    noRequirementsYet: "Noch keine Anforderungen",
    addWhatOrgNeeds: "Eintragen, was diese Agentur braucht — passende Kandidaten werden vorgeschlagen.",
    closed: "geschlossen",
    specialty: "Spezialität",
    slotsNeeded: "Benötigte Stellen",
    location: "Standort",
    startDate: "Startdatum",
    notes: "Notizen",
    optionalDetails: "Optionale Details",
    linkCandidatesBody: "Verknüpfte Kandidaten sehen alle Mitglieder dieser Agentur.",
    noCandidatesYet: "Noch keine Kandidaten im System.",
    statusPending: "Ausstehend",
    statusLinked: "Verknüpft",
    actionLink: "Verknüpfen",
    emailStar: "E-Mail *",
    nameOptional: "Name (optional)",
    addMember: "Mitglied hinzufügen",
    noMembersYet: "Noch keine Mitglieder.",
    brandingDescription: "Logo und Fußzeile erscheinen auf dem Lebenslauf verknüpfter Kandidaten.",
    logo: "Logo",
    replaceLogo: "Logo ersetzen",
    uploadLogo: "Logo hochladen",
    footerText: "Fußzeilentext",
    imageTooLarge: "Bild zu groß — max. 500 KB.",
    saved: "Gespeichert!",
    saveBranding: "Branding speichern",
    singleUseWarning: "Einmalig — nur für eine Person gültig",
    copied: "Kopiert!",
    copyLink: "Link kopieren",
    downloadQR: "QR herunterladen",
    close: "Schließen",
    nameRequired: "Name ist erforderlich.",
    couldNotCreate: "Agentur konnte nicht erstellt werden.",
    couldNotSave: "Konnte nicht gespeichert werden.",
    emailRequired: "E-Mail erforderlich",
    couldNotAdd: "Konnte nicht hinzugefügt werden",
    add: "Hinzufügen",
    membersDescription: "Mitglieder sehen alle verknüpften Kandidaten. Per E-Mail hinzufügen — ein Borivon-Konto ist nötig.",
    memberEmailPlaceholder: "mitglied@beispiel.com",
    roleMember: "Mitglied",
    roleOwner: "Inhaber",
    actionFailed: "Änderung konnte nicht gespeichert werden — nichts wurde geändert. Erneut versuchen.",
    back: "Zurück",
    membersN: (n: number) => `${n} Mitglied${n !== 1 ? "er" : ""}`,
    candidatesN: (n: number) => `${n} Kandidat${n !== 1 ? "en" : ""}`,
    wantsToJoin: "möchte zu",
    approve: "Annehmen",
    reject: "Ablehnen",
    slotsN: (n: number) => `${n} Stelle${n !== 1 ? "n" : ""}`,
    fromDate: (d: string) => `ab ${d}`,
    closeReq: "Anforderung schließen",
    regenerate: "Einladungscode neu erzeugen",
    deleteOrg: "Agentur löschen",
    copyCandidateTitle: "Einmal-Einladungslink für Kandidaten kopieren",
    qrCandidateTitle: "Einmal-QR für Kandidaten",
    copyAdminTitle: "Einmal-Einladungslink für Admins kopieren",
    qrAdminTitle: "Einmal-QR für Admins",
    legacySubAdmins: "Einzelne Sub-Admins verwalten (alt)",
    removeLogo: "Logo entfernen",
    remove: "Entfernen",
    unlink: "Verknüpfung lösen",
    namePh: "z. B. Calmaroi GmbH",
    notesPh: "z. B. Klinikverbund Berlin, Kontakt: lukas@calmaroi.com",
    specialtyPh: "z. B. Intensivpflege",
    locationPh: "z. B. Berlin",
  },
};

type Org = {
  id: string;
  name: string;
  invite_code: string;
  member_invite_code: string | null;
  notes: string | null;
  logo_filename: string | null;
  footer_text: string | null;
  vaccine_req: { masern?: number; varizell?: number } | null;
  requiredDocKeys?: string[] | null;
  created_at: string;
  memberCount: number;
  candidateCount: number;
  pendingCount: number;
};
type Member = { email: string; name: string; label: string; role: string; created_at: string };
type OrgCandidate = { userId: string; status: string; addedBy: string; addedAt: string };
type PendingRequest = { candidateUserId: string; orgId: string; orgName: string; addedBy: string; addedAt: string };
type Candidate = { userId: string; name: string; email: string };
type OrgReq = { id: string; specialty: string | null; slots: number; location: string | null; start_date: string | null; notes: string | null; active: boolean };

type OrgTab = "requirements" | "candidates" | "members" | "branding";

export default function OrganizationsPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = t[lang as keyof typeof t] ?? t.en;

  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(true);

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Record<string, OrgTab>>({});
  const [orgMembers, setOrgMembers] = useState<Record<string, Member[]>>({});
  const [orgCandidates, setOrgCandidates] = useState<Record<string, OrgCandidate[]>>({});
  const [orgReqs, setOrgReqs] = useState<Record<string, OrgReq[]>>({});

  // New org form
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Members
  const [memberEmail, setMemberEmail] = useState<Record<string, string>>({});
  const [memberName, setMemberName] = useState<Record<string, string>>({});
  const [memberError, setMemberError] = useState<Record<string, string>>({});

  // Requirements
  const [newReqFields, setNewReqFields] = useState<Record<string, { specialty: string; slots: string; location: string; start_date: string; notes: string }>>({});
  const [reqSaving, setReqSaving] = useState<Record<string, boolean>>({});
  const [showReqForm, setShowReqForm] = useState<Record<string, boolean>>({});

  // Branding
  const [editLogo, setEditLogo] = useState<Record<string, string>>({});
  const [editFooter, setEditFooter] = useState<Record<string, string>>({});
  const [brandSaving, setBrandSaving] = useState<Record<string, boolean>>({});
  const [brandSaved, setBrandSaved] = useState<Record<string, boolean>>({});
  const [brandError, setBrandError] = useState<Record<string, string>>({});

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [qrModal, setQrModal] = useState<{ url: string; label: string } | null>(null);
  const [qrGenerating, setQrGenerating] = useState<string | null>(null); // orgId_type while loading
  // Org whose delete / requirement-close the server refused — shown in its card.
  const [actionErrorOrg, setActionErrorOrg] = useState<string | null>(null);

  const loadData = useCallback(async (token: string) => {
    // getSession() refreshes an expired JWT — the caller's copy may be stale.
    const tk = (await meToken()) || token;
    const [orgsRes, reqRes, candRes] = await Promise.all([
      fetch("/api/portal/admin/organizations", { headers: { Authorization: `Bearer ${tk}` } }),
      fetch("/api/portal/admin/organization-requests", { headers: { Authorization: `Bearer ${tk}` } }),
      fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${tk}` } }),
    ]);
    // Only replace what actually loaded — a refused read must not blank the
    // list as if every agency were gone.
    if (orgsRes.ok) {
      const orgsJson = await orgsRes.json().catch(() => ({}));
      setOrgs(orgsJson.orgs ?? []);
    }
    if (reqRes.ok) {
      const reqJson = await reqRes.json().catch(() => ({}));
      setPendingRequests(reqJson.requests ?? []);
    }
    if (candRes.ok) {
      const candJson = await candRes.json().catch(() => ({}));
      const docs: { user_id: string }[] = candJson.docs ?? [];
      const users: Record<string, { name: string; email: string }> = candJson.users ?? {};
      const unique = [...new Set(docs.map(d => d.user_id))];
      setCandidates(unique.map(uid => ({ userId: uid, name: users[uid]?.name ?? uid, email: users[uid]?.email ?? uid })));
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const token = session.access_token ?? "";
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${token}` } });
      const { role, isAgencyAdmin } = await roleRes.json().catch(() => ({ role: null, isAgencyAdmin: false }));
      // THE WHOLE BORIVON TEAM, not just the founder.
      //
      // This used to be `role !== "admin"`, so placing a candidate with an
      // agency was one person's job while every sub-admin could already review
      // documents, run the pipeline and assign an employer. That made the
      // founder the bottleneck on the single action that actually places a
      // nurse.
      //
      // The line that stays is Borivon staff vs the agencies themselves: an
      // agency admin (sub_admin with isAgencyAdmin) is an OUTSIDE party and must
      // never see the roster of orgs they don't belong to, or move candidates
      // between them. This mirrors the server gate in the route — and the server
      // is the real one. This check only decides whether to render the page; the
      // API refuses org-side accounts regardless of what the client believes.
      const borivonTeam = role === "admin" || (role === "sub_admin" && !isAgencyAdmin);
      if (!borivonTeam) { router.replace("/portal"); return; }
      setAccessToken(token);
      await loadData(token);
      setLoading(false);
    });
  }, [router, loadData]);

  // Keep the JWT fresh — Supabase rotates it ~hourly and a stale copy 401s
  // every call (it is also passed down to the vaccine / required-docs editors).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) setAccessToken(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadOrgDetails(orgId: string) {
    const tk = (await meToken()) || accessToken;
    const [memRes, candRes, reqRes] = await Promise.all([
      fetch(`/api/portal/admin/organizations/${orgId}/members`, { headers: { Authorization: `Bearer ${tk}` } }),
      fetch(`/api/portal/admin/organizations/${orgId}/candidates`, { headers: { Authorization: `Bearer ${tk}` } }),
      fetch(`/api/portal/admin/organizations/${orgId}/requirements`, { headers: { Authorization: `Bearer ${tk}` } }),
    ]);
    // Same rule as loadData: a refused read keeps what's on screen.
    if (memRes.ok) {
      const memJson = await memRes.json().catch(() => ({}));
      setOrgMembers(prev => ({ ...prev, [orgId]: memJson.members ?? [] }));
    }
    if (candRes.ok) {
      const candJson = await candRes.json().catch(() => ({}));
      setOrgCandidates(prev => ({ ...prev, [orgId]: candJson.candidates ?? [] }));
    }
    if (reqRes.ok) {
      const reqJson = await reqRes.json().catch(() => ({}));
      setOrgReqs(prev => ({ ...prev, [orgId]: reqJson.requirements ?? [] }));
    }
  }

  async function addRequirement(orgId: string) {
    const f = newReqFields[orgId] ?? { specialty: "", slots: "1", location: "", start_date: "", notes: "" };
    setReqSaving(p => ({ ...p, [orgId]: true }));
    const res = await fetch(`/api/portal/admin/organizations/${orgId}/requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        specialty: f.specialty.trim() || null,
        slots: parseInt(f.slots) || 1,
        location: f.location.trim() || null,
        start_date: f.start_date || null,
        notes: f.notes.trim() || null,
      }),
    });
    if (res.ok) {
      const j = await res.json();
      setOrgReqs(p => ({ ...p, [orgId]: [j.requirement, ...(p[orgId] ?? [])] }));
      setNewReqFields(p => ({ ...p, [orgId]: { specialty: "", slots: "1", location: "", start_date: "", notes: "" } }));
      setShowReqForm(p => ({ ...p, [orgId]: false }));
    }
    setReqSaving(p => ({ ...p, [orgId]: false }));
  }

  async function closeRequirement(orgId: string, reqId: string) {
    setActionErrorOrg(null);
    const res = await fetch(`/api/portal/admin/organizations/${orgId}/requirements`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await meToken()) || accessToken}` },
      body: JSON.stringify({ requirementId: reqId }),
    }).catch(() => null);
    // Grey the row out only once the server has actually closed it.
    if (!res || !res.ok) { setActionErrorOrg(orgId); return; }
    setOrgReqs(p => ({ ...p, [orgId]: (p[orgId] ?? []).map(r => r.id === reqId ? { ...r, active: false } : r) }));
  }

  async function createOrg() {
    if (!newName.trim()) { setCreateError(T.nameRequired); return; }
    setCreating(true); setCreateError("");
    const res = await fetch("/api/portal/admin/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ name: newName.trim(), inviteCode: newCode.trim(), notes: newNotes.trim() }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setCreateError(j?.error || T.couldNotCreate);
      setCreating(false); return;
    }
    setNewName(""); setNewCode(""); setNewNotes("");
    setShowCreateForm(false);
    await loadData(accessToken);
    setCreating(false);
  }

  async function deleteOrg(orgId: string, name: string) {
    if (!confirm(lang === "fr" ? `Supprimer "${name}" ? Cela supprime tous les liens membres et candidats.` : lang === "de" ? `"${name}" löschen? Alle Mitglieder- und Kandidatenverknüpfungen werden entfernt.` : `Delete "${name}"? This removes all member and candidate links.`)) return;
    setActionErrorOrg(null);
    const res = await fetch(`/api/portal/admin/organizations/${orgId}`, { method: "DELETE", headers: { Authorization: `Bearer ${(await meToken()) || accessToken}` } }).catch(() => null);
    if (!res || !res.ok) { setActionErrorOrg(orgId); return; }
    if (expandedOrgId === orgId) setExpandedOrgId(null);
    await loadData(accessToken);
  }

  async function addMember(orgId: string) {
    const email = (memberEmail[orgId] ?? "").trim().toLowerCase();
    const name = (memberName[orgId] ?? "").trim();
    if (!email) { setMemberError(prev => ({ ...prev, [orgId]: T.emailRequired })); return; }
    setMemberError(prev => ({ ...prev, [orgId]: "" }));
    const res = await fetch(`/api/portal/admin/organizations/${orgId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email, name }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMemberError(prev => ({ ...prev, [orgId]: j?.error || T.couldNotAdd })); return;
    }
    setMemberEmail(prev => ({ ...prev, [orgId]: "" }));
    setMemberName(prev => ({ ...prev, [orgId]: "" }));
    await loadOrgDetails(orgId);
    await loadData(accessToken);
  }

  async function removeMember(orgId: string, email: string) {
    await fetch(`/api/portal/admin/organizations/${orgId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email }),
    });
    await loadOrgDetails(orgId);
    await loadData(accessToken);
  }

  async function setMemberRole(orgId: string, email: string, role: "member" | "owner") {
    await fetch(`/api/portal/admin/organizations/${orgId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email, role }),
    });
    await loadOrgDetails(orgId);
  }

  async function toggleCandidate(orgId: string, candidateUserId: string) {
    const linked = (orgCandidates[orgId] ?? []).some(c => c.userId === candidateUserId);
    await fetch(`/api/portal/admin/organizations/${orgId}/candidates`, {
      method: linked ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(linked ? { candidateUserId } : { candidateUserId, status: "approved" }),
    });
    await loadOrgDetails(orgId);
    await loadData(accessToken);
  }

  async function approveRequest(req: PendingRequest) {
    await fetch("/api/portal/admin/organization-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ candidateUserId: req.candidateUserId, orgId: req.orgId }),
    });
    await loadData(accessToken);
    if (expandedOrgId === req.orgId) await loadOrgDetails(req.orgId);
  }

  async function rejectRequest(req: PendingRequest) {
    await fetch("/api/portal/admin/organization-requests", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ candidateUserId: req.candidateUserId, orgId: req.orgId }),
    });
    await loadData(accessToken);
    if (expandedOrgId === req.orgId) await loadOrgDetails(req.orgId);
  }

  async function regenerateCode(org: Org) {
    if (!confirm(lang === "fr" ? `Régénérer le code d'invitation pour "${org.name}" ? L'ancien code cesse de fonctionner immédiatement.` : lang === "de" ? `Einladungscode für "${org.name}" neu generieren? Der alte Code wird sofort ungültig.` : `Regenerate invite code for "${org.name}"? The old code stops working immediately.`)) return;
    setRegenId(org.id);
    try {
      const res = await fetch(`/api/portal/admin/organizations/${org.id}/regenerate-code`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) await loadData(accessToken);
    } finally { setRegenId(null); }
  }

  async function saveBranding(orgId: string) {
    setBrandSaving(p => ({ ...p, [orgId]: true }));
    setBrandSaved(p => ({ ...p, [orgId]: false }));
    setBrandError(p => ({ ...p, [orgId]: "" }));
    const res = await fetch(`/api/portal/admin/organizations/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ logoFilename: editLogo[orgId] ?? "", footerText: editFooter[orgId] ?? "" }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setBrandError(p => ({ ...p, [orgId]: j?.error ?? T.couldNotSave }));
      setBrandSaving(p => ({ ...p, [orgId]: false })); return;
    }
    await loadData(accessToken);
    setBrandSaving(p => ({ ...p, [orgId]: false }));
    setBrandSaved(p => ({ ...p, [orgId]: true }));
    setTimeout(() => setBrandSaved(p => ({ ...p, [orgId]: false })), 2000);
  }

  function handleLogoUpload(orgId: string, file: File) {
    if (file.size > 512_000) { setBrandError(p => ({ ...p, [orgId]: T.imageTooLarge })); return; }
    setBrandError(p => ({ ...p, [orgId]: "" }));
    const reader = new FileReader();
    reader.onload = e => { const r = e.target?.result; if (typeof r === "string") setEditLogo(p => ({ ...p, [orgId]: r })); };
    reader.readAsDataURL(file);
  }

  function flashCopied(key: string) { setCopiedKey(key); setTimeout(() => setCopiedKey(prev => prev === key ? null : prev), 1500); }

  async function generateInviteToken(orgId: string, orgName: string, type: "candidate" | "member") {
    const key = `${orgId}_${type}`;
    setQrGenerating(key);
    try {
      const res = await fetch(`/api/portal/admin/organizations/${orgId}/generate-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) return;
      const { url } = await res.json();
      setQrModal({ url, label: `${orgName} — ${type === "member" ? "Admin" : "Candidate"}` });
    } finally {
      setQrGenerating(null);
    }
  }

  function copySingleUseLink(url: string, orgName: string, type: "candidate" | "member", key: string) {
    const text = type === "member"
      ? `You've been invited to join Borivon: ${url}`
      : `You've been invited to join Borivon: ${url}`;
    navigator.clipboard.writeText(text);
    flashCopied(key);
  }

  async function downloadQr(url: string, label: string) {
    // Authenticated fetch — the proxy now requires a Bearer JWT, so a plain
    // <a href> click won't work; fetch + blob keeps the download UX intact.
    const proxyUrl = `/api/portal/qr?data=${encodeURIComponent(url)}&label=${encodeURIComponent(label)}`;
    try {
      const res = await fetch(proxyUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error("QR fetch failed");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = label.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") + "_qr.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      console.error("[downloadQr]", e);
    }
  }

  function nameForCandidate(uid: string) {
    const c = candidates.find(c => c.userId === uid);
    return { name: c?.name ?? uid, email: c?.email ?? "" };
  }

  if (loading) return <PageLoader />;

  // ── the one design (founder 2026-11-13) ──────────────────────────────────────
  // serif head, quiet back, ONE black button; join requests = orange rows; the agencies = hairline rows that
  // flip (nobody scrolls). "Neue Agentur", "Verwalten" and the QR open in the universal popup (LAW #36).
  const managed = orgs.find(o => o.id === expandedOrgId) ?? null;
  const orgsLaptop = pendingRequests.length > 0 ? 5 : 7;
  const orgsPhone = pendingRequests.length > 0 ? 2 : 4;
  const qrIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="4" height="4"/>
      <path d="M14 21h4"/><path d="M21 14v4"/><path d="M21 21v.01"/>
    </svg>
  );

  // the "Verwalten" popup of one agency: four tabs, every list flips
  const manageModal = (org: Org) => {
    const tab = activeTab[org.id] ?? "requirements";
    const members = orgMembers[org.id] ?? [];
    const linked = orgCandidates[org.id] ?? [];
    const reqs = orgReqs[org.id] ?? [];
    const openReqs = reqs.filter(r => r.active).length;
    const count = (n: number) => <span style={{ marginLeft: 6, fontVariantNumeric: "tabular-nums", opacity: 0.6 }}>{n}</span>;
    const tabs: [OrgTab, React.ReactNode][] = [
      ["requirements", <>{T.tabRequirements}{openReqs > 0 && count(openReqs)}</>],
      ["candidates", <>{T.tabCandidates}{org.candidateCount > 0 && count(org.candidateCount)}</>],
      ["members", <>{T.tabMembers}{org.memberCount > 0 && count(org.memberCount)}</>],
      ["branding", <>{T.tabBranding}{(org.logo_filename || org.footer_text) && <i style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: STATUS_DOT.approved, marginLeft: 7, verticalAlign: "middle" }} />}</>],
    ];
    return (
      <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
        style={MODAL_BACK} onClick={() => setExpandedOrgId(null)}>
        <div role="dialog" aria-modal="true" aria-label={org.name} onClick={e => e.stopPropagation()} style={{ ...MODAL_CARD, maxWidth: 760 }}>

          {/* head: name, counts, close, the four tabs (pinned) */}
          <div style={{ flexShrink: 0, padding: "20px 22px 0" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={MODAL_TITLE}>{org.name}</h2>
                <div style={{ fontSize: 12.5, color: "var(--w3)", marginTop: 4 }}>{T.membersN(org.memberCount)} · {T.candidatesN(org.candidateCount)}</div>
              </div>
              <Btn kind="quiet" icon onClick={() => setExpandedOrgId(null)} title={T.close} aria-label={T.close}><XIcon size={18} strokeWidth={1.6} /></Btn>
            </div>
            <div className="bvo-tabs" style={{ margin: "12px -22px 0", padding: "0 22px 12px", overflowX: "auto", borderBottom: "1px solid var(--border)" }}>
              <Seg value={tab} options={tabs} onChange={(k) => setActiveTab(p => ({ ...p, [org.id]: k }))} />
            </div>
          </div>

          {/* body (scrolls only on a very short screen — LAW #36) */}
          <div style={{ overflowY: "auto", minHeight: 0, padding: "14px 22px 18px" }}>
            {actionErrorOrg === org.id && <p style={{ ...ERR_LINE, marginBottom: 12 }}>{T.actionFailed}</p>}

            {/* ── REQUIREMENTS ── */}
            {tab === "requirements" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <p style={SUB}>{T.whatOrgNeeds}</p>
                  <Btn kind="ghost" size="sm" onClick={() => setShowReqForm(p => ({ ...p, [org.id]: !p[org.id] }))} style={{ flex: "none" }}>
                    {showReqForm[org.id] ? <XIcon size={13} strokeWidth={2} /> : <Plus size={13} strokeWidth={2} />}
                    {showReqForm[org.id] ? T.cancel : T.add}
                  </Btn>
                </div>

                {showReqForm[org.id] && (() => {
                  const f = newReqFields[org.id] ?? { specialty: "", slots: "1", location: "", start_date: "", notes: "" };
                  const setF = (k: string, v: string) => setNewReqFields(p => ({ ...p, [org.id]: { ...(p[org.id] ?? { specialty: "", slots: "1", location: "", start_date: "", notes: "" }), [k]: v } }));
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 14, borderRadius: 14, border: "1px solid var(--border)" }}>
                      <div className="bvo-g4">
                        <Field label={T.specialty}><input className="bvk-input" type="text" placeholder={T.specialtyPh} value={f.specialty} onChange={e => setF("specialty", e.target.value)} /></Field>
                        <Field label={T.slotsNeeded}><input className="bvk-input" type="number" placeholder="1" value={f.slots} onChange={e => setF("slots", e.target.value)} min={1} /></Field>
                        <Field label={T.location}><input className="bvk-input" type="text" placeholder={T.locationPh} value={f.location} onChange={e => setF("location", e.target.value)} /></Field>
                        <Field label={T.startDate}><input className="bvk-input" type="date" value={f.start_date} onChange={e => setF("start_date", e.target.value)} /></Field>
                      </div>
                      <div className="bvo-row-end">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Field label={T.notes}><input className="bvk-input" type="text" placeholder={T.optionalDetails} value={f.notes} onChange={e => setF("notes", e.target.value)} /></Field>
                        </div>
                        <Btn kind="primary" onClick={() => addRequirement(org.id)} disabled={reqSaving[org.id]} style={{ height: 42 }}>
                          {reqSaving[org.id] ? <Spinner size="xs" color="var(--bg)" /> : <Plus size={15} strokeWidth={2} />}
                          {reqSaving[org.id] ? T.saving : T.addRequirement}
                        </Btn>
                      </div>
                    </div>
                  );
                })()}

                {reqs.length === 0 && !showReqForm[org.id] && (
                  <Empty icon={<FileText size={22} strokeWidth={1.4} />}>
                    <span style={{ color: "var(--w2)", fontWeight: 500 }}>{T.noRequirementsYet}</span>
                    <span style={{ fontSize: 13, marginTop: -4, maxWidth: 380 }}>{T.addWhatOrgNeeds}</span>
                  </Empty>
                )}
                {reqs.length > 0 && (
                  <Paged key={`req-${org.id}`} items={reqs} per={showReqForm[org.id] ? 2 : 5} perPhone={showReqForm[org.id] ? 2 : 4}>
                    {slice => (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {slice.map(r => (
                          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 6px 10px 14px", borderRadius: 12, border: "1px solid var(--border)", opacity: r.active ? 1 : 0.45 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={ROW_NAME}>{r.specialty || T.slotsN(r.slots)}</div>
                              <div style={ROW_META}>
                                {[r.specialty ? T.slotsN(r.slots) : null, r.location, r.start_date ? T.fromDate(fmtDay(r.start_date, lang)) : null, r.notes].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                            {r.active
                              ? <Btn kind="quiet" size="sm" icon onClick={() => closeRequirement(org.id, r.id)} title={T.closeReq} aria-label={T.closeReq}><XIcon size={15} strokeWidth={1.8} /></Btn>
                              : <span style={{ ...STATE_WORD, color: "var(--w3)", padding: "0 10px" }}>{T.closed}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </Paged>
                )}
              </div>
            )}

            {/* ── CANDIDATES ── linked = green, waiting = orange */}
            {tab === "candidates" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={SUB}>{T.linkCandidatesBody}</p>
                {candidates.length === 0
                  ? <p style={{ ...SUB, padding: "22px 0", textAlign: "center" }}>{T.noCandidatesYet}</p>
                  : (
                    <Paged key={`cand-${org.id}`} items={candidates} per={5} perPhone={4}>
                      {slice => (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {slice.map(c => {
                            const link = linked.find(l => l.userId === c.userId);
                            const isLinked = !!link && link.status !== "rejected";
                            const isPending = link?.status === "pending";
                            const st = isLinked && !isPending ? "approved" : isPending ? "pending" : null;
                            return (
                              <div key={c.userId} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 6px 8px 14px", borderRadius: 12,
                                background: st ? STATUS_TINT[st] : "transparent", border: `1px solid ${st ? "transparent" : "var(--border)"}` }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={ROW_NAME}>{c.name}</div>
                                  <div style={ROW_META}>{c.email}</div>
                                </div>
                                <Btn kind={st ? "quiet" : "ghost"} size="sm" onClick={() => toggleCandidate(org.id, c.userId)} style={st ? { color: "var(--w)" } : undefined}>
                                  {isLinked && !isPending ? <><Check size={14} strokeWidth={2} />{T.statusLinked}</> : isPending ? T.statusPending : T.actionLink}
                                </Btn>
                                {isLinked && !isPending && (
                                  <Btn kind="quiet" size="sm" icon onClick={() => toggleCandidate(org.id, c.userId)} title={T.unlink} aria-label={T.unlink}><Trash2 size={14} strokeWidth={1.8} /></Btn>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </Paged>
                  )}
              </div>
            )}

            {/* ── MEMBERS ── */}
            {tab === "members" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={SUB}>{T.membersDescription}</p>
                <div className="bvo-mem">
                  <Field label={T.emailStar}><input className="bvk-input" type="email" placeholder={T.memberEmailPlaceholder} value={memberEmail[org.id] ?? ""} onChange={e => setMemberEmail(prev => ({ ...prev, [org.id]: e.target.value }))} /></Field>
                  <Field label={T.nameOptional}><input className="bvk-input" type="text" placeholder="Omar" value={memberName[org.id] ?? ""} onChange={e => setMemberName(prev => ({ ...prev, [org.id]: e.target.value }))} /></Field>
                  <Btn kind="primary" onClick={() => addMember(org.id)} style={{ height: 42 }}><UserPlus size={15} strokeWidth={1.8} />{T.addMember}</Btn>
                </div>
                {memberError[org.id] && <p style={ERR_LINE}>{memberError[org.id]}</p>}
                {members.length > 0 ? (
                  <Paged key={`mem-${org.id}`} items={members} per={4} perPhone={3}>
                    {slice => (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {slice.map(m => (
                          <div key={m.email} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 6px 8px 14px", borderRadius: 12, border: "1px solid var(--border)" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={ROW_NAME}>{m.name || m.email}</div>
                              {m.name && <div style={ROW_META}>{m.email}</div>}
                            </div>
                            <Btn kind="ghost" size="sm" onClick={() => setMemberRole(org.id, m.email, m.role === "owner" ? "member" : "owner")}>
                              {m.role === "owner" ? <Crown size={13} strokeWidth={1.8} style={{ color: "var(--gold)" }} /> : <UserIcon size={13} strokeWidth={1.8} />}
                              {m.role === "owner" ? T.roleOwner : T.roleMember}
                            </Btn>
                            <Btn kind="quiet" size="sm" icon onClick={() => removeMember(org.id, m.email)} title={T.remove} aria-label={T.remove}><Trash2 size={14} strokeWidth={1.8} /></Btn>
                          </div>
                        ))}
                      </div>
                    )}
                  </Paged>
                ) : (
                  <p style={{ ...SUB, padding: "18px 0", textAlign: "center" }}>{T.noMembersYet}</p>
                )}
              </div>
            )}

            {/* ── BRANDING ── logo + footer | vaccines, required papers below. Laptop: all three at once;
                 phone: the three parts flip (‹ 1/3 ›) — all stay mounted, so nothing typed is lost. */}
            {tab === "branding" && (
              <Paged key={`brand-${org.id}`} items={BRAND_PARTS} per={3} perPhone={1}>
                {slice => {
                const on = (k: BrandPart) => slice.includes(k);
                return (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {on("brand") && <p style={SUB}>{T.brandingDescription}</p>}
                <div className="bvo-brand">
                  <div style={{ display: on("brand") ? "flex" : "none", flexDirection: "column", gap: 12, minWidth: 0 }}>
                    <div className="bvk-field">
                      <span>{T.logo}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {editLogo[org.id] && (
                          <div style={{ width: 44, height: 44, borderRadius: 10, display: "grid", placeItems: "center", overflow: "hidden", flex: "none", background: "var(--bg2)" }}>
                            {editLogo[org.id].startsWith("data:")
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={editLogo[org.id]} alt="logo" style={{ width: 40, height: 40, objectFit: "contain" }} />
                              : <span style={{ fontSize: 8, fontFamily: "monospace", textAlign: "center", padding: "0 4px", color: "var(--w3)" }}>{editLogo[org.id].slice(0, 14)}</span>
                            }
                          </div>
                        )}
                        <label className="bvk-btn bvk-ghost bvk-sm" style={{ flex: 1 }}>
                          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(org.id, f); e.target.value = ""; }} />
                          {editLogo[org.id] ? T.replaceLogo : T.uploadLogo}
                        </label>
                        {editLogo[org.id] && (
                          <Btn kind="quiet" size="sm" icon onClick={() => setEditLogo(p => ({ ...p, [org.id]: "" }))} title={T.removeLogo} aria-label={T.removeLogo}><XIcon size={15} strokeWidth={1.8} /></Btn>
                        )}
                      </div>
                    </div>
                    <Field label={T.footerText}>
                      <textarea className="bvk-input" value={editFooter[org.id] ?? ""} onChange={e => setEditFooter(p => ({ ...p, [org.id]: e.target.value }))}
                        placeholder={"Calmaroí GmbH · Römerstraße 15\n63450 Hanau · www.calmaroi.de"}
                        rows={2} style={{ resize: "none", lineHeight: 1.6, minHeight: 66 }} />
                    </Field>
                    {brandError[org.id] && <p style={ERR_LINE}>{brandError[org.id]}</p>}
                    <div>
                      <Btn kind="primary" onClick={() => saveBranding(org.id)} disabled={brandSaving[org.id]}>
                        {brandSaving[org.id] ? <Spinner size="xs" color="var(--bg)" /> : brandSaved[org.id] ? <Check size={15} strokeWidth={2} /> : null}
                        {brandSaving[org.id] ? T.saving : brandSaved[org.id] ? T.saved : T.saveBranding}
                      </Btn>
                    </div>
                  </div>
                  <div style={{ display: on("vax") ? undefined : "none", minWidth: 0 }}>
                    {/* Vaccine requirement — drives the Impfung pipeline track. */}
                    <VaccineReqEditor
                      orgId={org.id}
                      initial={org.vaccine_req}
                      accessToken={accessToken}
                      lang={lang}
                      onSaved={() => loadData(accessToken)}
                    />
                  </div>
                </div>
                {/* Which documents count toward this agency's completion % (full width: the papers flow in a few lines). */}
                <div style={{ display: on("docs") ? undefined : "none", ...(on("brand") ? { borderTop: "1px solid var(--border)", paddingTop: 12 } : {}) }}>
                  <RequiredDocsEditor
                    orgId={org.id}
                    orgName={org.name}
                    initial={org.requiredDocKeys}
                    accessToken={accessToken}
                    lang={lang}
                    onSaved={() => loadData(accessToken)}
                  />
                </div>
              </div>
                );
                }}
              </Paged>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <style>{ORG_CSS}</style>
      <div className="mx-auto w-full px-4" style={{ maxWidth: 880, paddingTop: 32, paddingBottom: 32 }}>

        <PageHead back={{ label: T.back, onClick: () => router.back() }}
          title={T.organizations}
          sub={T.managePartners}
          actions={
            <Btn kind="primary" onClick={() => setShowCreateForm(v => !v)}>
              <Plus size={15} strokeWidth={2} />{T.newOrg}
            </Btn>
          } />

        {/* join requests — waiting = orange */}
        {pendingRequests.length > 0 && (
          <section style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, color: "var(--w3)" }}>
              <Dot st="pending" />
              <b style={SERIF_NUM}>{pendingRequests.length}</b>{T.joinRequests}
            </div>
            <Paged items={pendingRequests} per={3} perPhone={2}>
              {slice => (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {slice.map(req => {
                    const { name, email } = nameForCandidate(req.candidateUserId);
                    return (
                      <div key={`${req.candidateUserId}_${req.orgId}`} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 8px 10px 14px", borderRadius: 12, background: STATUS_TINT.pending }}>
                        <div style={{ flex: 1, minWidth: 0, marginRight: 4 }}>
                          <div style={ROW_NAME}>{name}</div>
                          <div style={ROW_META}>{T.wantsToJoin} <span style={{ color: "var(--w2)" }}>{req.orgName}</span> · {email}</div>
                        </div>
                        <Btn kind="ghost" size="sm" onClick={() => approveRequest(req)} title={T.approve}><Check size={14} strokeWidth={2} />{T.approve}</Btn>
                        <Btn kind="quiet" size="sm" icon onClick={() => rejectRequest(req)} title={T.reject} aria-label={T.reject}><XIcon size={15} strokeWidth={1.8} /></Btn>
                      </div>
                    );
                  })}
                </div>
              )}
            </Paged>
          </section>
        )}

        {/* the agencies — hairline rows, the list flips */}
        {orgs.length === 0 ? (
          <Card>
            <Empty icon={<Building2 size={22} strokeWidth={1.5} />}>
              <span style={{ color: "var(--w2)", fontWeight: 500 }}>{T.noOrgsYet}</span>
              <span style={{ fontSize: 13, marginTop: -4 }}>{T.createFirstOne}</span>
            </Empty>
          </Card>
        ) : (
          <Paged items={orgs} per={orgsLaptop} perPhone={orgsPhone}>
            {slice => (
              <Card style={{ overflow: "hidden" }}>
                {slice.map((org, i) => {
                  const isExpanded = expandedOrgId === org.id;
                  const openReqs = (orgReqs[org.id] ?? []).filter(r => r.active).length;
                  return (
                    <div key={org.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "12px 10px 12px 18px" }}>
                        <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 2, minWidth: 0 }}>
                            <span style={{ ...ROW_NAME, fontSize: 14.5, minWidth: 0 }}>{org.name}</span>
                            {org.pendingCount > 0 && <span style={STATE_WORD}><Dot st="pending" size={7} />{T.pending(org.pendingCount)}</span>}
                            {openReqs > 0 && <span style={STATE_WORD}>{T.openReqs(openReqs)}</span>}
                          </div>
                          <div style={ROW_META}>
                            {T.membersN(org.memberCount)} · {T.candidatesN(org.candidateCount)}{org.notes ? ` · ${org.notes}` : ""}
                          </div>
                        </div>

                        {/* single-use invite links + their QR (laptop, as before) */}
                        <span className="hidden sm:inline-flex" style={{ alignItems: "center", flex: "none" }}>
                          <Btn kind="quiet" size="sm"
                            onClick={async () => {
                              const key = `${org.id}_candidate`;
                              setQrGenerating(key);
                              try {
                                const res = await fetch(`/api/portal/admin/organizations/${org.id}/generate-invite`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                                  body: JSON.stringify({ type: "candidate" }),
                                });
                                if (res.ok) {
                                  const { url } = await res.json();
                                  const text = `You've been invited to join Borivon: ${url}`;
                                  navigator.clipboard.writeText(text);
                                  flashCopied(`${org.id}_cand`);
                                }
                              } finally { setQrGenerating(null); }
                            }}
                            disabled={qrGenerating === `${org.id}_candidate`}
                            title={T.copyCandidateTitle}
                            style={copiedKey === `${org.id}_cand` ? { color: "var(--w)" } : undefined}>
                            {copiedKey === `${org.id}_cand` ? <Check size={14} strokeWidth={2} style={{ color: STATUS_DOT.approved }} /> : qrGenerating === `${org.id}_candidate` ? <Spinner size="xs" color="var(--w3)" /> : <Copy size={13} strokeWidth={1.8} />}
                            {copiedKey === `${org.id}_cand` ? T.copied : T.candidateLink}
                          </Btn>
                          <Btn kind="quiet" size="sm" icon
                            onClick={() => generateInviteToken(org.id, org.name, "candidate")}
                            disabled={qrGenerating === `${org.id}_candidate`}
                            title={T.qrCandidateTitle} aria-label={T.qrCandidateTitle}>
                            {qrGenerating === `${org.id}_candidate` ? <Spinner size="xs" color="var(--w3)" /> : qrIcon}
                          </Btn>

                          {/* Org member invite link — generates single-use token */}
                          {org.member_invite_code && (
                            <>
                              <Btn kind="quiet" size="sm"
                                onClick={async () => {
                                  const key = `${org.id}_member`;
                                  setQrGenerating(key);
                                  try {
                                    const res = await fetch(`/api/portal/admin/organizations/${org.id}/generate-invite`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                                      body: JSON.stringify({ type: "member" }),
                                    });
                                    if (res.ok) {
                                      const { url } = await res.json();
                                      const text = `You've been invited to join Borivon: ${url}`;
                                      navigator.clipboard.writeText(text);
                                      flashCopied(`${org.id}_mem`);
                                    }
                                  } finally { setQrGenerating(null); }
                                }}
                                disabled={qrGenerating === `${org.id}_member`}
                                title={T.copyAdminTitle}
                                style={copiedKey === `${org.id}_mem` ? { color: "var(--w)" } : undefined}>
                                {copiedKey === `${org.id}_mem` ? <Check size={14} strokeWidth={2} style={{ color: STATUS_DOT.approved }} /> : qrGenerating === `${org.id}_member` ? <Spinner size="xs" color="var(--w3)" /> : <Copy size={13} strokeWidth={1.8} />}
                                {copiedKey === `${org.id}_mem` ? T.copied : T.adminLink}
                              </Btn>
                              <Btn kind="quiet" size="sm" icon
                                onClick={() => generateInviteToken(org.id, org.name, "member")}
                                disabled={qrGenerating === `${org.id}_member`}
                                title={T.qrAdminTitle} aria-label={T.qrAdminTitle}>
                                {qrGenerating === `${org.id}_member` ? <Spinner size="xs" color="var(--w3)" /> : qrIcon}
                              </Btn>
                            </>
                          )}
                        </span>

                        <Btn kind="quiet" size="sm" icon onClick={() => regenerateCode(org)} disabled={regenId === org.id} title={T.regenerate} aria-label={T.regenerate}>
                          <RefreshCw size={14} strokeWidth={1.8} style={{ animation: regenId === org.id ? "spin 1s linear infinite" : undefined }} />
                        </Btn>

                        <Btn kind="ghost" size="sm"
                          onClick={async () => {
                            if (isExpanded) { setExpandedOrgId(null); return; }
                            setExpandedOrgId(org.id);
                            if (!activeTab[org.id]) setActiveTab(p => ({ ...p, [org.id]: "requirements" }));
                            setEditLogo(p => ({ ...p, [org.id]: org.logo_filename ?? "" }));
                            setEditFooter(p => ({ ...p, [org.id]: org.footer_text ?? "" }));
                            await loadOrgDetails(org.id);
                          }}>
                          {T.manage}
                        </Btn>

                        <Btn kind="quiet" size="sm" icon onClick={() => deleteOrg(org.id, org.name)} title={T.deleteOrg} aria-label={T.deleteOrg}>
                          <Trash2 size={14} strokeWidth={1.8} />
                        </Btn>
                      </div>

                      {actionErrorOrg === org.id && !isExpanded && (
                        <p style={{ ...ERR_LINE, padding: "0 18px 12px" }}>{T.actionFailed}</p>
                      )}
                    </div>
                  );
                })}
              </Card>
            )}
          </Paged>
        )}

        <div style={{ textAlign: "right", marginTop: 12 }}>
          <Btn kind="quiet" onClick={() => router.push("/portal/admin/manage")} style={{ padding: 0, fontSize: 12.5 }}>
            {T.legacySubAdmins}
          </Btn>
        </div>

      </div>
    </main>

    {/* ── Neue Agentur (LAW #36 popup) ─────────────────────────────────────── */}
    {showCreateForm && typeof window !== "undefined" && createPortal(
      <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
        style={MODAL_BACK} onClick={() => { if (!creating) setShowCreateForm(false); }}>
        <div role="dialog" aria-modal="true" aria-label={T.newOrganization} onClick={e => e.stopPropagation()} style={{ ...MODAL_CARD, maxWidth: 460 }}>
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "20px 22px 4px" }}>
            <h2 style={{ ...MODAL_TITLE, flex: 1 }}>{T.newOrganization}</h2>
            <Btn kind="quiet" icon onClick={() => { if (!creating) setShowCreateForm(false); }} title={T.cancel} aria-label={T.cancel}><XIcon size={18} strokeWidth={1.6} /></Btn>
          </div>
          <div style={{ overflowY: "auto", minHeight: 0, padding: "12px 22px 4px", display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label={T.nameStar}>
              <input className="bvk-input" type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder={T.namePh} />
            </Field>
            <Field label={<>{T.inviteCode} <span style={{ textTransform: "none", letterSpacing: 0 }}>{T.inviteCodeAuto}</span></>}>
              <input className="bvk-input" type="text" value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="AUTO" style={{ fontFamily: "monospace", letterSpacing: "0.1em" }} />
            </Field>
            <Field label={T.internalNotes}>
              <input className="bvk-input" type="text" value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder={T.notesPh} />
            </Field>
            {createError && <p style={ERR_LINE}>{createError}</p>}
          </div>
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "16px 22px 20px" }}>
            <Btn kind="quiet" onClick={() => setShowCreateForm(false)} disabled={creating}>{T.cancel}</Btn>
            <Btn kind="primary" onClick={createOrg} disabled={creating}>
              {creating ? <Spinner size="xs" color="var(--bg)" /> : <Plus size={15} strokeWidth={2} />}
              {creating ? T.creating : T.create}
            </Btn>
          </div>
        </div>
      </div>,
      document.body,
    )}

    {/* ── Verwalten (LAW #36 popup) ────────────────────────────────────────── */}
    {managed && typeof window !== "undefined" && createPortal(manageModal(managed), document.body)}

    {/* ── QR code (LAW #36 popup) ──────────────────────────────────────────── */}
    {qrModal && typeof window !== "undefined" && createPortal(
      <div className="fixed inset-x-0 bottom-0 top-[58px] z-[1100] flex items-center justify-center p-4 pb-[88px] sm:pb-4"
        style={MODAL_BACK} onClick={() => setQrModal(null)}>
        <div role="dialog" aria-modal="true" aria-label={qrModal.label} onClick={e => e.stopPropagation()} style={{ ...MODAL_CARD, maxWidth: 340 }}>
          <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", gap: 10, padding: "18px 18px 0 22px" }}>
            <h2 style={{ ...MODAL_TITLE, fontSize: 20, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{qrModal.label}</h2>
            <Btn kind="quiet" icon onClick={() => setQrModal(null)} title={T.close} aria-label={T.close}><XIcon size={18} strokeWidth={1.6} /></Btn>
          </div>
          <div style={{ overflowY: "auto", minHeight: 0, padding: "14px 22px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&bgcolor=ffffff&color=15130f&data=${encodeURIComponent(qrModal.url)}`}
              alt="QR code"
              width={200}
              height={200}
              style={{ borderRadius: 12, border: "1px solid var(--border)", width: "clamp(140px, 30dvh, 200px)", height: "auto", objectFit: "contain" }}
            />
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--w3)", textAlign: "center", wordBreak: "break-all" }}>{qrModal.url}</p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--w3)", textAlign: "center" }}>{T.singleUseWarning}</p>
            <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 4 }}>
              <Btn kind="ghost" size="sm" style={{ flex: 1 }} onClick={() => { navigator.clipboard.writeText(qrModal.url); flashCopied("qr"); }}>
                {copiedKey === "qr" ? <Check size={14} strokeWidth={2} style={{ color: STATUS_DOT.approved }} /> : <Copy size={13} strokeWidth={1.8} />}
                {copiedKey === "qr" ? T.copied : T.copyLink}
              </Btn>
              <Btn kind="primary" size="sm" style={{ flex: 1 }} onClick={() => downloadQr(qrModal.url, qrModal.label)}>
                {T.downloadQR}
              </Btn>
            </div>
            <Btn kind="quiet" size="sm" onClick={() => setQrModal(null)}>{T.close}</Btn>
          </div>
        </div>
      </div>,
      document.body,
    )}
    </>
  );
}

// ── the one design: small shared pieces of this page ─────────────────────────
const MODAL_BACK: React.CSSProperties = { background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" };
const MODAL_CARD: React.CSSProperties = {
  width: "100%", display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 20,
  background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)",
  animation: "bvFadeRise .28s var(--ease-out)", maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)",
};
const MODAL_TITLE: React.CSSProperties = { margin: 0, fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 26, lineHeight: 1.15, color: "var(--w)" };
const ROW_NAME: React.CSSProperties = { fontSize: 14, fontWeight: 500, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const ROW_META: React.CSSProperties = { fontSize: 12.5, color: "var(--w3)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const STATE_WORD: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--w2)", whiteSpace: "nowrap", flex: "none" };
const SERIF_NUM: React.CSSProperties = { fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 22, lineHeight: 1, color: "var(--w)" };
const SUB: React.CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.45, color: "var(--w3)" };
const LABEL: React.CSSProperties = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--w3)" };
const ERR_LINE: React.CSSProperties = { margin: 0, fontSize: 12.5, color: STATUS_DOT.rejected };
const STEP_BTN: React.CSSProperties = { width: 32, height: 32, border: 0, background: "none", color: "var(--w2)", fontSize: 16, lineHeight: 1, cursor: "pointer", fontFamily: "inherit" };
const ORG_CSS = `
.bvo-tabs{scrollbar-width:none}
.bvo-tabs::-webkit-scrollbar{display:none}
.bvo-tabs .bvk-seg{width:max-content}
.bvo-tabs .bvk-seg button{white-space:nowrap}
.bvo-g4{display:grid;grid-template-columns:1.6fr 1fr 1.6fr 1.3fr;gap:10px;align-items:end}
.bvo-row-end{display:flex;gap:10px;align-items:flex-end}
.bvo-mem{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}
.bvo-brand{display:grid;grid-template-columns:1fr 1fr;gap:26px;align-items:start}
@media (max-width:640px){
.bvo-tabs{overflow:visible!important}
.bvo-tabs .bvk-seg{display:grid;grid-template-columns:1fr 1fr;width:100%;border-radius:18px}
.bvo-g4{grid-template-columns:1fr 1fr}
.bvo-row-end{flex-direction:column;align-items:stretch}
.bvo-mem{grid-template-columns:1fr}
.bvo-brand{grid-template-columns:1fr;gap:16px}
}`;
/** the Branding tab's three parts: laptop shows them together, a phone flips through them */
type BrandPart = "brand" | "vax" | "docs";
const BRAND_PARTS: BrandPart[] = ["brand", "vax", "docs"];

/** a list that flips instead of scrolling (components/fx/kit: usePaged + Pager) */
function Paged<T>({ items, per, perPhone, children }: { items: T[]; per: number; perPhone: number; children: (slice: T[]) => React.ReactNode }) {
  const { slice, page, pages, setPage } = usePaged(items, per, perPhone);
  return <>{children(slice)}<Pager page={page} pages={pages} onPage={setPage} /></>;
}

/** a stored YYYY-MM-DD shown the local way (01.03.2027); anything else as it is */
function fmtDay(d: string, lang: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(d + "T00:00:00Z").toLocaleDateString(lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

// ── Per-agency vaccine requirement editor (drives the Impfung pipeline track) ──
function VaccineReqEditor({ orgId, initial, accessToken, lang, onSaved }: {
  orgId: string;
  initial: { masern?: number; varizell?: number } | null;
  accessToken: string;
  lang: string;
  onSaved: () => void;
}) {
  const L = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [masern, setMasern] = useState<number>(Math.max(0, Math.floor(Number(initial?.masern) || 0)));
  const [varizell, setVarizell] = useState<number>(Math.max(0, Math.floor(Number(initial?.varizell) || 0)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const required = masern > 0 || varizell > 0;

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch(`/api/portal/admin/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ vaccineReq: { masern, varizell } }),
      });
      if (res.ok) { setSaved(true); onSaved(); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  }

  const Stepper = ({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) => (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 13, color: "var(--w2)" }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "center", height: 34, borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)" }}>
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label="−" style={STEP_BTN}>−</button>
        <span style={{ minWidth: 18, textAlign: "center", fontSize: 14, fontWeight: 600, color: "var(--w)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        <button type="button" onClick={() => onChange(Math.min(5, value + 1))} aria-label="+" style={STEP_BTN}>+</button>
      </span>
    </div>
  );

  return (
    <div>
      <div style={LABEL}>{L("Vaccine requirement", "Impfanforderung", "Vaccins requis")}</div>
      <p style={{ ...SUB, fontSize: 12.5, margin: "4px 0 12px" }}>
        {L("Doses this agency's candidates need. 0 = none (not on the Impfung track).",
           "Dosen, die Kandidaten dieser Agentur brauchen. 0 = keine (nicht im Impfweg).",
           "Doses requises pour les candidats de cette agence. 0 = aucune (hors parcours vaccins).")}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px", marginBottom: 12 }}>
        <Stepper label="Masern" value={masern} onChange={setMasern} />
        <Stepper label="Varizell" value={varizell} onChange={setVarizell} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Btn kind="ghost" size="sm" onClick={save} disabled={saving}>
          {saving ? <Spinner size="xs" color="var(--w2)" /> : saved ? <Check size={14} strokeWidth={2} style={{ color: STATUS_DOT.approved }} /> : null}
          {saving ? L("Saving…", "Speichern…", "…") : saved ? L("Saved", "Gespeichert", "Enregistré") : L("Save", "Speichern", "Enregistrer")}
        </Btn>
        <span style={{ fontSize: 12.5, color: required ? "var(--w2)" : "var(--w3)", fontWeight: required ? 600 : 400 }}>
          {required ? L(`Requires ${masern + varizell} dose(s)`, `Benötigt ${masern + varizell} Dosis(en)`, `${masern + varizell} dose(s)`) : L("No Impfung required", "Keine Impfung nötig", "Aucun vaccin requis")}
        </span>
      </div>
    </div>
  );
}

// ── Which papers count toward THIS agency's completion % ──────────────────────
// Untick the docs the agency doesn't ask for (e.g. Abitur / Praktikum for a
// Moroccan-nurse pipeline) and the % is measured only against the rest — instead
// of every candidate looking stuck against papers that never applied. Empty /
// default (nothing customised) → the built-in required set.
const REQ_DOC_LABELS: Record<string, [string, string, string]> = {
  // [en, de, fr]
  id:                ["Passport", "Reisepass", "Passeport"],
  cv_de:             ["CV", "Lebenslauf", "CV"],
  letter:            ["Cover letter", "Motivationsschreiben", "Lettre de motivation"],
  langcert:          ["B2 certificate", "B2-Zertifikat", "Certificat B2"],
  diploma:           ["Diploma", "Diplom", "Diplôme"],
  studyprog:         ["Study program", "Ausbildungsprogramm", "Programme d'études"],
  transcript:        ["Transcript", "Notenübersicht", "Relevé de notes"],
  abitur:            ["Abitur", "Abitur", "Abitur"],
  abitur_transcript: ["Abitur transcript", "Abitur-Notenübersicht", "Relevé Abitur"],
  praktikum:         ["Internship", "Praktikum", "Stage"],
  workcert:          ["Work permit", "Berufserlaubnis", "Autorisation de travail"],
  work_experience:   ["Work experience", "Berufserfahrung", "Expérience pro."],
  impfung:           ["Vaccination", "Impfnachweis", "Vaccination"],
};

function RequiredDocsEditor({ orgId, orgName, initial, accessToken, lang, onSaved }: {
  orgId: string;
  orgName: string;
  initial: string[] | null | undefined;
  accessToken: string;
  lang: string;
  onSaved: () => void;
}) {
  const L = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const DEFAULT_REQUIRED = CHECKLIST_ITEMS.filter(i => !i.optional).map(i => i.key);
  const isCustom = Array.isArray(initial);
  const [sel, setSel] = useState<Set<string>>(new Set(initial ?? DEFAULT_REQUIRED));
  const [custom, setCustom] = useState<boolean>(isCustom);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const label = (k: string) => (REQ_DOC_LABELS[k] ? L(REQ_DOC_LABELS[k][0], REQ_DOC_LABELS[k][1], REQ_DOC_LABELS[k][2]) : k);
  const toggle = (k: string) => {
    setCustom(true);
    setSel(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  };

  async function save(reset = false) {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch(`/api/portal/admin/organizations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ requiredDocKeys: reset ? null : [...sel] }),
      });
      if (res.ok) {
        setSaved(true); onSaved(); setTimeout(() => setSaved(false), 2000);
        if (reset) { setSel(new Set(DEFAULT_REQUIRED)); setCustom(false); } else { setCustom(true); }
      }
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={LABEL}>{L("Required documents", "Erforderliche Dokumente", "Documents requis")}</div>
      <p style={{ ...SUB, fontSize: 12.5, margin: "4px 0 12px" }}>
        {L(`Tick only what ${orgName} needs — the completion % counts only these.`,
           `Nur ankreuzen, was ${orgName} wirklich braucht — der Fertig-Prozentsatz zählt nur diese.`,
           `Cochez seulement ce dont ${orgName} a besoin — le % d'avancement ne compte que ceux-ci.`)}
      </p>
      {/* one quiet pill per paper: green ring filled = counts */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {CHECKLIST_ITEMS.map(item => {
          const on = sel.has(item.key);
          return (
            <button key={item.key} onClick={() => toggle(item.key)} type="button" aria-pressed={on}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px 5px 8px", borderRadius: 999, border: "1px solid var(--border)",
                background: "var(--card)", fontSize: 12.5, color: on ? "var(--w)" : "var(--w3)", cursor: "pointer", fontFamily: "inherit" }}>
              <i style={{ width: 14, height: 14, borderRadius: "50%", display: "inline-block", flex: "none",
                border: `1.5px solid ${on ? STATUS_DOT.approved : "var(--w3)"}`, background: on ? STATUS_DOT.approved : "transparent" }} />
              {label(item.key)}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Btn kind="ghost" size="sm" onClick={() => save(false)} disabled={saving}>
          {saving ? <Spinner size="xs" color="var(--w2)" /> : saved ? <Check size={14} strokeWidth={2} style={{ color: STATUS_DOT.approved }} /> : null}
          {saving ? L("Saving…", "Speichern…", "…") : saved ? L("Saved", "Gespeichert", "Enregistré") : L("Save", "Speichern", "Enregistrer")}
        </Btn>
        <span style={{ fontSize: 12.5, color: "var(--w3)" }}>
          {custom
            ? L(`${sel.size} required`, `${sel.size} erforderlich`, `${sel.size} requis`)
            : L("Using the default set", "Standard-Set aktiv", "Ensemble par défaut")}
        </span>
        {custom && (
          <Btn kind="quiet" size="sm" onClick={() => save(true)} disabled={saving}
            style={{ marginLeft: "auto", padding: 0, fontSize: 12.5, textDecoration: "underline", textUnderlineOffset: 3 }}>
            {L("Reset to default", "Auf Standard zurücksetzen", "Réinitialiser")}
          </Btn>
        )}
      </div>
    </div>
  );
}
