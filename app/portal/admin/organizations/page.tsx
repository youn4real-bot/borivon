"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Building2, Trash2, Copy, Check, Plus, UserPlus, X as XIcon, AlertCircle, RefreshCw, Crown, User as UserIcon, Settings, Users, FileText, Palette } from "lucide-react";
import { CheckCircle2 } from "@/components/PortalIcons";
import { PageLoader, EmptyState, Spinner } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";

const t = {
  en: {
    organizations: "Organizations",
    managePartners: "Manage partners, their requirements, and linked candidates",
    cancel: "Cancel",
    newOrg: "New org",
    newOrganization: "New organization",
    nameStar: "Name *",
    inviteCode: "Invite code",
    inviteCodeAuto: "(auto if blank)",
    internalNotes: "Internal notes",
    creating: "Creating…",
    create: "Create",
    joinRequests: "Join requests",
    noOrgsYet: "No organizations yet",
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
    whatOrgNeeds: "What this org needs — drives automatic candidate matching.",
    addRequirement: "Add requirement",
    saving: "Saving…",
    noRequirementsYet: "No requirements yet",
    addWhatOrgNeeds: "Add what this org needs — the system will suggest matching candidates automatically.",
    closed: "closed",
    specialty: "Specialty",
    slotsNeeded: "Slots needed",
    location: "Location",
    startDate: "Start date",
    notes: "Notes",
    optionalDetails: "Optional details",
    linkCandidatesBody: "Link candidates to this org. Linked candidates can be seen by all org members.",
    noCandidatesYet: "No candidates in the system yet.",
    statusPending: "Pending",
    statusLinked: "Linked",
    actionLink: "Link",
    emailStar: "Email *",
    nameOptional: "Name (optional)",
    addMember: "Add member",
    noMembersYet: "No members yet. Add someone above.",
    brandingDescription: "Candidates linked to this org get this logo and footer on their generated CV.",
    logo: "Logo",
    replaceLogo: "Replace logo",
    uploadLogo: "Upload logo",
    footerText: "Footer text",
    imageTooLarge: "Image too large — max 500 KB.",
    saved: "Saved!",
    saveBranding: "Save branding",
    singleUseWarning: "⚠ Single-use — valid for one person only",
    copied: "Copied!",
    copyLink: "Copy link",
    downloadQR: "Download QR",
    close: "Close",
    nameRequired: "Name is required.",
    couldNotCreate: "Could not create organization.",
    couldNotSave: "Could not save.",
    emailRequired: "Email required",
    couldNotAdd: "Could not add",
    add: "Add",
    membersDescription: "Members can see all candidates linked to this org. Add by email — they must already have a Borivon account.",
    memberEmailPlaceholder: "member@example.com",
    roleMember: "Member",
    roleOwner: "Owner",
  },
  fr: {
    organizations: "Organisations",
    managePartners: "Gérer les partenaires, leurs besoins et les candidats associés",
    cancel: "Annuler",
    newOrg: "Nouvelle org",
    newOrganization: "Nouvelle organisation",
    nameStar: "Nom *",
    inviteCode: "Code d'invitation",
    inviteCodeAuto: "(auto si vide)",
    internalNotes: "Notes internes",
    creating: "Création…",
    create: "Créer",
    joinRequests: "Demandes d'adhésion",
    noOrgsYet: "Aucune organisation pour l'instant",
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
    whatOrgNeeds: "Ce dont cette organisation a besoin — déclenche la mise en correspondance automatique.",
    addRequirement: "Ajouter un besoin",
    saving: "Enregistrement…",
    noRequirementsYet: "Aucun besoin pour l'instant",
    addWhatOrgNeeds: "Ajoutez ce dont cette organisation a besoin — le système suggérera des candidats automatiquement.",
    closed: "fermé",
    specialty: "Spécialité",
    slotsNeeded: "Places nécessaires",
    location: "Lieu",
    startDate: "Date de début",
    notes: "Notes",
    optionalDetails: "Détails optionnels",
    linkCandidatesBody: "Associez des candidats à cette organisation. Les candidats associés sont visibles pour tous les membres.",
    noCandidatesYet: "Aucun candidat dans le système pour l'instant.",
    statusPending: "En attente",
    statusLinked: "Associé",
    actionLink: "Associer",
    emailStar: "E-mail *",
    nameOptional: "Nom (optionnel)",
    addMember: "Ajouter un membre",
    noMembersYet: "Aucun membre pour l'instant. Ajoutez quelqu'un ci-dessus.",
    brandingDescription: "Les candidats associés obtiennent ce logo et ce pied de page sur leur CV généré.",
    logo: "Logo",
    replaceLogo: "Remplacer le logo",
    uploadLogo: "Télécharger un logo",
    footerText: "Texte de pied de page",
    imageTooLarge: "Image trop grande — max 500 Ko.",
    saved: "Enregistré !",
    saveBranding: "Enregistrer le branding",
    singleUseWarning: "⚠ Usage unique — valable pour une seule personne",
    copied: "Copié !",
    copyLink: "Copier le lien",
    downloadQR: "Télécharger le QR",
    close: "Fermer",
    nameRequired: "Le nom est obligatoire.",
    couldNotCreate: "Impossible de créer l'organisation.",
    couldNotSave: "Impossible d'enregistrer.",
    emailRequired: "E-mail requis",
    couldNotAdd: "Impossible d'ajouter",
    add: "Ajouter",
    membersDescription: "Les membres peuvent voir tous les candidats liés à cette organisation. Ajoutez par e-mail — ils doivent déjà avoir un compte Borivon.",
    memberEmailPlaceholder: "membre@exemple.com",
    roleMember: "Membre",
    roleOwner: "Propriétaire",
  },
  de: {
    organizations: "Organisationen",
    managePartners: "Partner, Anforderungen und Kandidaten verwalten",
    cancel: "Abbrechen",
    newOrg: "Neue Org",
    newOrganization: "Neue Organisation",
    nameStar: "Name *",
    inviteCode: "Einladungscode",
    inviteCodeAuto: "(auto wenn leer)",
    internalNotes: "Interne Notizen",
    creating: "Wird erstellt…",
    create: "Erstellen",
    joinRequests: "Beitrittsanfragen",
    noOrgsYet: "Noch keine Organisationen",
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
    whatOrgNeeds: "Was diese Organisation benötigt — löst automatisches Kandidaten-Matching aus.",
    addRequirement: "Anforderung hinzufügen",
    saving: "Speichern…",
    noRequirementsYet: "Noch keine Anforderungen",
    addWhatOrgNeeds: "Fügen Sie hinzu, was diese Organisation braucht — das System schlägt passende Kandidaten automatisch vor.",
    closed: "geschlossen",
    specialty: "Spezialität",
    slotsNeeded: "Benötigte Stellen",
    location: "Standort",
    startDate: "Startdatum",
    notes: "Notizen",
    optionalDetails: "Optionale Details",
    linkCandidatesBody: "Kandidaten mit dieser Organisation verknüpfen. Verknüpfte Kandidaten sind für alle Mitglieder sichtbar.",
    noCandidatesYet: "Noch keine Kandidaten im System.",
    statusPending: "Ausstehend",
    statusLinked: "Verknüpft",
    actionLink: "Verknüpfen",
    emailStar: "E-Mail *",
    nameOptional: "Name (optional)",
    addMember: "Mitglied hinzufügen",
    noMembersYet: "Noch keine Mitglieder. Fügen Sie jemanden oben hinzu.",
    brandingDescription: "Verknüpfte Kandidaten erhalten dieses Logo und diese Fußzeile auf ihrem generierten Lebenslauf.",
    logo: "Logo",
    replaceLogo: "Logo ersetzen",
    uploadLogo: "Logo hochladen",
    footerText: "Fußzeilentext",
    imageTooLarge: "Bild zu groß — max. 500 KB.",
    saved: "Gespeichert!",
    saveBranding: "Branding speichern",
    singleUseWarning: "⚠ Einmalig — nur für eine Person gültig",
    copied: "Kopiert!",
    copyLink: "Link kopieren",
    downloadQR: "QR herunterladen",
    close: "Schließen",
    nameRequired: "Name ist erforderlich.",
    couldNotCreate: "Organisation konnte nicht erstellt werden.",
    couldNotSave: "Konnte nicht gespeichert werden.",
    emailRequired: "E-Mail erforderlich",
    couldNotAdd: "Konnte nicht hinzugefügt werden",
    add: "Hinzufügen",
    membersDescription: "Mitglieder können alle mit dieser Organisation verknüpften Kandidaten sehen. Per E-Mail hinzufügen — sie müssen bereits ein Borivon-Konto haben.",
    memberEmailPlaceholder: "mitglied@beispiel.com",
    roleMember: "Mitglied",
    roleOwner: "Inhaber",
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

  const loadData = useCallback(async (token: string) => {
    const [orgsRes, reqRes, candRes] = await Promise.all([
      fetch("/api/portal/admin/organizations", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/portal/admin/organization-requests", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const orgsJson = await orgsRes.json();
    const reqJson = await reqRes.json();
    const candJson = await candRes.json();
    setOrgs(orgsJson.orgs ?? []);
    setPendingRequests(reqJson.requests ?? []);
    const docs: { user_id: string }[] = candJson.docs ?? [];
    const users: Record<string, { name: string; email: string }> = candJson.users ?? {};
    const unique = [...new Set(docs.map(d => d.user_id))];
    setCandidates(unique.map(uid => ({ userId: uid, name: users[uid]?.name ?? uid, email: users[uid]?.email ?? uid })));
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const token = session.access_token ?? "";
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${token}` } });
      const { role } = await roleRes.json().catch(() => ({ role: null }));
      if (role !== "admin") { router.replace("/portal"); return; }
      setAccessToken(token);
      await loadData(token);
      setLoading(false);
    });
  }, [router, loadData]);

  async function loadOrgDetails(orgId: string) {
    const [memRes, candRes, reqRes] = await Promise.all([
      fetch(`/api/portal/admin/organizations/${orgId}/members`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`/api/portal/admin/organizations/${orgId}/candidates`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`/api/portal/admin/organizations/${orgId}/requirements`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    const memJson = await memRes.json();
    const candJson = await candRes.json();
    const reqJson = await reqRes.json();
    setOrgMembers(prev => ({ ...prev, [orgId]: memJson.members ?? [] }));
    setOrgCandidates(prev => ({ ...prev, [orgId]: candJson.candidates ?? [] }));
    setOrgReqs(prev => ({ ...prev, [orgId]: reqJson.requirements ?? [] }));
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
    await fetch(`/api/portal/admin/organizations/${orgId}/requirements`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ requirementId: reqId }),
    });
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
    await fetch(`/api/portal/admin/organizations/${orgId}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
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
    const proxyUrl = `/api/portal/qr?data=${encodeURIComponent(url)}&label=${encodeURIComponent(label)}`;
    const a = document.createElement("a");
    a.href = proxyUrl;
    a.download = label.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_") + "_qr.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function nameForCandidate(uid: string) {
    const c = candidates.find(c => c.userId === uid);
    return { name: c?.name ?? uid, email: c?.email ?? "" };
  }

  const inp: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--border)", color: "var(--w)", borderRadius: "10px", width: "100%", padding: "10px 13px", fontSize: "13px", outline: "none" };

  if (loading) return <PageLoader />;

  return (
    <>
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[780px] mx-auto px-4 pt-8 pb-20">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full" style={{ color: "var(--w2)" }}>
              <ArrowLeft size={15} strokeWidth={1.8} />
            </button>
            <div>
              <h1 className="text-[20px] font-semibold tracking-[-0.015em]" style={{ color: "var(--w)" }}>{T.organizations}</h1>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--w3)" }}>{T.managePartners}</p>
            </div>
          </div>
          <button onClick={() => setShowCreateForm(v => !v)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-all"
            style={{ background: showCreateForm ? "var(--bg2)" : "var(--gold)", color: showCreateForm ? "var(--w2)" : "#131312", borderRadius: "12px", border: showCreateForm ? "1px solid var(--border)" : "none" }}>
            {showCreateForm ? <XIcon size={13} strokeWidth={2} /> : <Plus size={13} strokeWidth={2.2} />}
            {showCreateForm ? T.cancel : T.newOrg}
          </button>
        </div>

        {/* Create form */}
        {showCreateForm && (
          <div className="mb-6 p-5" style={{ background: "var(--card)", borderRadius: "16px", border: "1px solid var(--border-gold)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-4" style={{ color: "var(--gold)" }}>{T.newOrganization}</p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>{T.nameStar}</label>
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Calmaroi GmbH" style={inp} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>{T.inviteCode} <span style={{ color: "var(--w3)", fontWeight: 400 }}>{T.inviteCodeAuto}</span></label>
                  <input type="text" value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="AUTO" style={{ ...inp, fontFamily: "monospace", letterSpacing: "0.1em" }} />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>{T.internalNotes}</label>
                <input type="text" value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="e.g. Berlin hospital group, contact: lukas@calmaroi.com" style={inp} />
              </div>
              {createError && <p className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>{createError}</p>}
              <button onClick={createOrg} disabled={creating}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-semibold transition-opacity disabled:opacity-50"
                style={{ background: "var(--gold)", color: "#131312", borderRadius: "10px" }}>
                {creating ? <Spinner size="xs" color="#131312" /> : <Plus size={13} strokeWidth={2.2} />}
                {creating ? T.creating : T.create}
              </button>
            </div>
          </div>
        )}

        {/* Pending join requests */}
        {pendingRequests.length > 0 && (
          <div className="mb-6 p-4" style={{ background: "var(--card)", borderRadius: "16px", border: "1px solid var(--border-gold)" }}>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={13} style={{ color: "var(--gold)" }} />
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--gold)" }}>{T.joinRequests} · {pendingRequests.length}</p>
            </div>
            <div className="space-y-2">
              {pendingRequests.map(req => {
                const { name, email } = nameForCandidate(req.candidateUserId);
                return (
                  <div key={`${req.candidateUserId}_${req.orgId}`} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-semibold" style={{ color: "var(--w)" }}>{name}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>{email} · wants to join <span style={{ color: "var(--w2)" }}>{req.orgName}</span></p>
                    </div>
                    <button onClick={() => approveRequest(req)} className="bv-icon-btn bv-icon-btn--approve w-8 h-8 rounded-full flex items-center justify-center" title="Approve">
                      <CheckCircle2 size={13} strokeWidth={1.8} />
                    </button>
                    <button onClick={() => rejectRequest(req)} className="bv-icon-btn bv-icon-btn--reject w-8 h-8 rounded-full flex items-center justify-center" title="Reject">
                      <XIcon size={13} strokeWidth={1.8} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Org list */}
        {orgs.length === 0 ? (
          <EmptyState Icon={Building2} title={T.noOrgsYet} sub={T.createFirstOne} />
        ) : (
          <div className="space-y-3">
            {orgs.map(org => {
              const isExpanded = expandedOrgId === org.id;
              const tab = activeTab[org.id] ?? "requirements";
              const members = orgMembers[org.id] ?? [];
              const linked = orgCandidates[org.id] ?? [];
              const reqs = orgReqs[org.id] ?? [];
              const openReqs = reqs.filter(r => r.active).length;

              return (
                <div key={org.id} style={{ background: "var(--card)", borderRadius: "16px", overflow: "hidden", border: "1px solid var(--border)" }}>

                  {/* Org header row */}
                  <div className="px-4 py-3.5 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                      <Building2 size={15} strokeWidth={1.8} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{org.name}</p>
                        {openReqs > 0 && (
                          <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "var(--info-bg)", color: "var(--info)", border: "1px solid var(--info-border)" }}>
                            {T.openReqs(openReqs)}
                          </span>
                        )}
                        {org.pendingCount > 0 && (
                          <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                            {T.pending(org.pendingCount)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11.5px] mt-0.5" style={{ color: "var(--w3)" }}>
                        {org.memberCount} member{org.memberCount !== 1 ? "s" : ""} · {org.candidateCount} candidate{org.candidateCount !== 1 ? "s" : ""}
                        {org.notes ? ` · ${org.notes}` : ""}
                      </p>
                    </div>

                    {/* Candidate invite link — generates single-use token */}
                    <button
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
                      className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-50"
                      style={{ background: copiedKey === `${org.id}_cand` ? "var(--info-bg)" : "var(--bg2)", color: copiedKey === `${org.id}_cand` ? "var(--info)" : "var(--w2)", border: `1px solid ${copiedKey === `${org.id}_cand` ? "var(--info-border)" : "var(--border)"}`, borderRadius: "8px" }}
                      title="Copy single-use candidate invite link">
                      {copiedKey === `${org.id}_cand` ? <Check size={10} strokeWidth={2} /> : qrGenerating === `${org.id}_candidate` ? <Spinner size="xs" color="var(--w2)" /> : <Copy size={10} strokeWidth={1.8} />}
                      {T.candidateLink}
                    </button>
                    <button
                      onClick={() => generateInviteToken(org.id, org.name, "candidate")}
                      disabled={qrGenerating === `${org.id}_candidate`}
                      className="hidden sm:flex items-center justify-center w-7 h-7 transition-colors bv-icon-btn disabled:opacity-50"
                      style={{ color: "var(--w3)", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg2)" }}
                      title="Generate single-use QR for candidate">
                      {qrGenerating === `${org.id}_candidate` ? <Spinner size="xs" color="var(--w3)" /> : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="4" height="4"/>
                          <path d="M14 21h4"/><path d="M21 14v4"/><path d="M21 21v.01"/>
                        </svg>
                      )}
                    </button>

                    {/* Org member invite link — generates single-use token */}
                    {org.member_invite_code && (
                      <>
                        <button
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
                          className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-50"
                          style={{ background: copiedKey === `${org.id}_mem` ? "var(--gdim)" : "var(--bg2)", color: copiedKey === `${org.id}_mem` ? "var(--gold)" : "var(--w2)", border: `1px solid ${copiedKey === `${org.id}_mem` ? "var(--border-gold)" : "var(--border)"}`, borderRadius: "8px" }}
                          title="Copy single-use admin invite link">
                          {copiedKey === `${org.id}_mem` ? <Check size={10} strokeWidth={2} /> : qrGenerating === `${org.id}_member` ? <Spinner size="xs" color="var(--w2)" /> : <Copy size={10} strokeWidth={1.8} />}
                          {T.adminLink}
                        </button>
                        <button
                          onClick={() => generateInviteToken(org.id, org.name, "member")}
                          disabled={qrGenerating === `${org.id}_member`}
                          className="hidden sm:flex items-center justify-center w-7 h-7 transition-colors bv-icon-btn disabled:opacity-50"
                          style={{ color: "var(--w3)", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg2)" }}
                          title="Generate single-use QR for admin">
                          {qrGenerating === `${org.id}_member` ? <Spinner size="xs" color="var(--w3)" /> : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="4" height="4"/>
                              <path d="M14 21h4"/><path d="M21 14v4"/><path d="M21 21v.01"/>
                            </svg>
                          )}
                        </button>
                      </>
                    )}

                    <button onClick={() => regenerateCode(org)} disabled={regenId === org.id} title="Regenerate invite code"
                      className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40" style={{ color: "var(--w3)" }}>
                      <RefreshCw size={11} strokeWidth={1.8} style={{ animation: regenId === org.id ? "spin 1s linear infinite" : undefined }} />
                    </button>

                    <button
                      onClick={async () => {
                        if (isExpanded) { setExpandedOrgId(null); return; }
                        setExpandedOrgId(org.id);
                        if (!activeTab[org.id]) setActiveTab(p => ({ ...p, [org.id]: "requirements" }));
                        setEditLogo(p => ({ ...p, [org.id]: org.logo_filename ?? "" }));
                        setEditFooter(p => ({ ...p, [org.id]: org.footer_text ?? "" }));
                        await loadOrgDetails(org.id);
                      }}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 transition-colors"
                      style={{ background: isExpanded ? "var(--gdim)" : "var(--bg2)", color: isExpanded ? "var(--gold)" : "var(--w2)", border: `1px solid ${isExpanded ? "var(--border-gold)" : "var(--border)"}`, borderRadius: "8px" }}>
                      <Settings size={11} strokeWidth={1.8} />
                      {T.manage}
                    </button>

                    <button onClick={() => deleteOrg(org.id, org.name)} className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center">
                      <Trash2 size={12} strokeWidth={1.8} />
                    </button>
                  </div>

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div style={{ borderTop: "1px solid var(--border)" }}>

                      {/* Tabs */}
                      <div className="flex px-4 pt-3 gap-1 overflow-x-auto" style={{ borderBottom: "1px solid var(--border)" }}>
                        {([
                          { id: "requirements", label: T.tabRequirements, icon: <FileText size={12} strokeWidth={1.8} />, badge: openReqs > 0 ? String(openReqs) : null },
                          { id: "candidates",   label: T.tabCandidates,   icon: <Users size={12} strokeWidth={1.8} />, badge: org.candidateCount > 0 ? String(org.candidateCount) : null },
                          { id: "members",      label: T.tabMembers,      icon: <UserPlus size={12} strokeWidth={1.8} />, badge: org.memberCount > 0 ? String(org.memberCount) : null },
                          { id: "branding",     label: T.tabBranding,     icon: <Palette size={12} strokeWidth={1.8} />, badge: (org.logo_filename || org.footer_text) ? "✓" : null },
                        ] as { id: OrgTab; label: string; icon: React.ReactNode; badge: string | null }[]).map(tabItem => (
                          <button key={tabItem.id}
                            onClick={() => setActiveTab(p => ({ ...p, [org.id]: tabItem.id }))}
                            className="flex items-center gap-1.5 px-3 pb-2.5 text-[12px] font-medium whitespace-nowrap transition-colors flex-shrink-0"
                            style={{
                              color: tab === tabItem.id ? "var(--gold)" : "var(--w3)",
                              borderBottom: `2px solid ${tab === tabItem.id ? "var(--gold)" : "transparent"}`,
                              background: "transparent",
                            }}>
                            {tabItem.icon}
                            {tabItem.label}
                            {tabItem.badge && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: tab === tabItem.id ? "var(--gdim)" : "var(--bg2)", color: tab === tabItem.id ? "var(--gold)" : "var(--w3)", border: `1px solid ${tab === tabItem.id ? "var(--border-gold)" : "var(--border)"}` }}>
                                {tabItem.badge}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Tab content */}
                      <div className="p-5">

                        {/* ── REQUIREMENTS ── */}
                        {tab === "requirements" && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <p className="text-[11.5px]" style={{ color: "var(--w3)" }}>
                                {T.whatOrgNeeds}
                              </p>
                              <button onClick={() => setShowReqForm(p => ({ ...p, [org.id]: !p[org.id] }))}
                                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 transition-colors"
                                style={{ background: showReqForm[org.id] ? "var(--bg2)" : "var(--gold)", color: showReqForm[org.id] ? "var(--w2)" : "#131312", borderRadius: "8px", border: showReqForm[org.id] ? "1px solid var(--border)" : "none" }}>
                                {showReqForm[org.id] ? <XIcon size={11} strokeWidth={2} /> : <Plus size={11} strokeWidth={2.2} />}
                                {showReqForm[org.id] ? T.cancel : T.add}
                              </button>
                            </div>

                            {/* Add form */}
                            {showReqForm[org.id] && (() => {
                              const f = newReqFields[org.id] ?? { specialty: "", slots: "1", location: "", start_date: "", notes: "" };
                              const setF = (k: string, v: string) => setNewReqFields(p => ({ ...p, [org.id]: { ...(p[org.id] ?? { specialty: "", slots: "1", location: "", start_date: "", notes: "" }), [k]: v } }));
                              return (
                                <div className="p-4 rounded-xl space-y-3" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--w3)" }}>{T.specialty}</label>
                                      <input type="text" placeholder="e.g. ICU Nurse" value={f.specialty} onChange={e => setF("specialty", e.target.value)} style={inp} />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--w3)" }}>{T.slotsNeeded}</label>
                                      <input type="number" placeholder="1" value={f.slots} onChange={e => setF("slots", e.target.value)} min={1} style={inp} />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--w3)" }}>{T.location}</label>
                                      <input type="text" placeholder="e.g. Berlin" value={f.location} onChange={e => setF("location", e.target.value)} style={inp} />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--w3)" }}>{T.startDate}</label>
                                      <input type="date" value={f.start_date} onChange={e => setF("start_date", e.target.value)} style={{ ...inp, colorScheme: "dark" }} />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--w3)" }}>{T.notes}</label>
                                    <input type="text" placeholder={T.optionalDetails} value={f.notes} onChange={e => setF("notes", e.target.value)} style={inp} />
                                  </div>
                                  <button onClick={() => addRequirement(org.id)} disabled={reqSaving[org.id]}
                                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-2 transition-opacity disabled:opacity-50"
                                    style={{ background: "var(--gold)", color: "#131312", borderRadius: "8px" }}>
                                    {reqSaving[org.id] ? <Spinner size="xs" color="#131312" /> : <Plus size={12} strokeWidth={2.2} />}
                                    {reqSaving[org.id] ? T.saving : T.addRequirement}
                                  </button>
                                </div>
                              );
                            })()}

                            {/* Existing requirements */}
                            {reqs.length === 0 && !showReqForm[org.id] && (
                              <div className="py-8 text-center">
                                <FileText size={28} strokeWidth={1.3} style={{ color: "var(--w3)", margin: "0 auto 12px" }} />
                                <p className="text-[13px] font-medium" style={{ color: "var(--w2)" }}>{T.noRequirementsYet}</p>
                                <p className="text-[12px] mt-1" style={{ color: "var(--w3)" }}>{T.addWhatOrgNeeds}</p>
                              </div>
                            )}
                            {reqs.length > 0 && (
                              <div className="space-y-2">
                                {reqs.map(r => (
                                  <div key={r.id} className="flex items-center gap-3 px-3.5 py-3 rounded-xl"
                                    style={{ background: "var(--bg2)", border: `1px solid ${r.active ? "var(--border)" : "var(--border)"}`, opacity: r.active ? 1 : 0.45 }}>
                                    <div className="flex-1 min-w-0 flex flex-wrap gap-x-3 gap-y-0.5 items-center">
                                      {r.specialty && <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{r.specialty}</span>}
                                      <span className="text-[11.5px] px-2 py-0.5 rounded-full" style={{ background: "var(--info-bg)", color: "var(--info)", border: "1px solid var(--info-border)" }}>{r.slots} slot{r.slots !== 1 ? "s" : ""}</span>
                                      {r.location && <span className="text-[11.5px]" style={{ color: "var(--w3)" }}>📍 {r.location}</span>}
                                      {r.start_date && <span className="text-[11.5px]" style={{ color: "var(--w3)" }}>🗓 {r.start_date}</span>}
                                      {r.notes && <span className="text-[11px] truncate max-w-full" style={{ color: "var(--w3)" }}>{r.notes}</span>}
                                    </div>
                                    {r.active
                                      ? <button onClick={() => closeRequirement(org.id, r.id)} title="Close requirement" className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"><XIcon size={11} strokeWidth={1.8} /></button>
                                      : <span className="text-[9.5px] px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: "var(--bg)", color: "var(--w3)", border: "1px solid var(--border)" }}>{T.closed}</span>
                                    }
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── CANDIDATES ── */}
                        {tab === "candidates" && (
                          <div className="space-y-2">
                            <p className="text-[11.5px] mb-3" style={{ color: "var(--w3)" }}>{T.linkCandidatesBody}</p>
                            {candidates.length === 0
                              ? <p className="text-[12px]" style={{ color: "var(--w3)" }}>{T.noCandidatesYet}</p>
                              : candidates.map(c => {
                                  const link = linked.find(l => l.userId === c.userId);
                                  const isLinked = !!link && link.status !== "rejected";
                                  const isPending = link?.status === "pending";
                                  return (
                                    <div key={c.userId} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl"
                                      style={{ background: "var(--bg2)", border: `1px solid ${isLinked && !isPending ? "var(--success-border)" : "var(--border)"}` }}>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{c.name}</p>
                                        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>{c.email}</p>
                                      </div>
                                      {isPending && <span className="text-[9.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>{T.statusPending}</span>}
                                      <button onClick={() => toggleCandidate(org.id, c.userId)}
                                        className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 transition-all flex-shrink-0"
                                        style={isLinked && !isPending
                                          ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "8px" }
                                          : { background: "var(--bg)", color: "var(--w2)", border: "1px solid var(--border)", borderRadius: "8px" }}>
                                        {isLinked && !isPending ? <><CheckCircle2 size={11} strokeWidth={1.8} /> {T.statusLinked}</> : isPending ? T.statusPending : T.actionLink}
                                      </button>
                                      {isLinked && !isPending && (
                                        <button onClick={() => toggleCandidate(org.id, c.userId)} className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center">
                                          <Trash2 size={11} strokeWidth={1.8} />
                                        </button>
                                      )}
                                    </div>
                                  );
                                })
                            }
                          </div>
                        )}

                        {/* ── MEMBERS ── */}
                        {tab === "members" && (
                          <div className="space-y-3">
                            <p className="text-[11.5px] mb-3" style={{ color: "var(--w3)" }}>{T.membersDescription}</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--w3)" }}>{T.emailStar}</label>
                                <input type="email" placeholder={T.memberEmailPlaceholder} value={memberEmail[org.id] ?? ""} onChange={e => setMemberEmail(prev => ({ ...prev, [org.id]: e.target.value }))} style={inp} />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--w3)" }}>{T.nameOptional}</label>
                                <input type="text" placeholder="Omar" value={memberName[org.id] ?? ""} onChange={e => setMemberName(prev => ({ ...prev, [org.id]: e.target.value }))} style={inp} />
                              </div>
                            </div>
                            {memberError[org.id] && <p className="text-[11px]" style={{ color: "var(--danger)" }}>{memberError[org.id]}</p>}
                            <button onClick={() => addMember(org.id)}
                              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-2"
                              style={{ background: "var(--gold)", color: "#131312", borderRadius: "8px" }}>
                              <UserPlus size={12} strokeWidth={1.8} />
                              {T.addMember}
                            </button>

                            {members.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                {members.map(m => (
                                  <div key={m.email} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{m.name || m.email}</p>
                                      <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>{m.name ? m.email : ""}</p>
                                    </div>
                                    <button onClick={() => setMemberRole(org.id, m.email, m.role === "owner" ? "member" : "owner")}
                                      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 transition-colors"
                                      style={{ background: m.role === "owner" ? "var(--gdim)" : "var(--bg)", color: m.role === "owner" ? "var(--gold)" : "var(--w3)", border: `1px solid ${m.role === "owner" ? "var(--border-gold)" : "var(--border)"}`, borderRadius: "6px" }}>
                                      {m.role === "owner" ? <Crown size={9} strokeWidth={2} /> : <UserIcon size={9} strokeWidth={2} />}
                                      {m.role === "owner" ? T.roleOwner : T.roleMember}
                                    </button>
                                    <button onClick={() => removeMember(org.id, m.email)} className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center">
                                      <Trash2 size={11} strokeWidth={1.8} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {members.length === 0 && (
                              <div className="py-6 text-center">
                                <p className="text-[12px]" style={{ color: "var(--w3)" }}>{T.noMembersYet}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── BRANDING ── */}
                        {tab === "branding" && (
                          <div className="space-y-4">
                            <p className="text-[11.5px]" style={{ color: "var(--w3)" }}>{T.brandingDescription}</p>

                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--w3)" }}>{T.logo}</label>
                              <div className="flex items-center gap-2">
                                {editLogo[org.id] && (
                                  <div className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                                    {editLogo[org.id].startsWith("data:")
                                      // eslint-disable-next-line @next/next/no-img-element
                                      ? <img src={editLogo[org.id]} alt="logo" className="w-10 h-10 object-contain" />
                                      : <span className="text-[8px] font-mono text-center px-1" style={{ color: "var(--w3)" }}>{editLogo[org.id].slice(0, 14)}</span>
                                    }
                                  </div>
                                )}
                                <label className="flex-1 inline-flex items-center justify-center gap-1.5 text-[12.5px] font-semibold px-4 py-2.5 cursor-pointer"
                                  style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)", borderRadius: "10px" }}>
                                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                                    onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(org.id, f); e.target.value = ""; }} />
                                  {editLogo[org.id] ? T.replaceLogo : T.uploadLogo}
                                </label>
                                {editLogo[org.id] && (
                                  <button onClick={() => setEditLogo(p => ({ ...p, [org.id]: "" }))} className="bv-icon-btn bv-icon-btn--reject w-9 h-9 rounded-xl flex items-center justify-center">
                                    <XIcon size={12} strokeWidth={1.8} />
                                  </button>
                                )}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--w3)" }}>{T.footerText}</label>
                              <textarea value={editFooter[org.id] ?? ""} onChange={e => setEditFooter(p => ({ ...p, [org.id]: e.target.value }))}
                                placeholder={"Calmaroí GmbH · Römerstraße 15\n63450 Hanau · www.calmaroi.de"}
                                rows={3} style={{ ...inp, resize: "none", lineHeight: "1.6" }} />
                            </div>

                            {brandError[org.id] && <p className="text-[11.5px] px-3 py-2 rounded-lg" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>{brandError[org.id]}</p>}

                            <button onClick={() => saveBranding(org.id)} disabled={brandSaving[org.id]}
                              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-5 py-2.5 transition-all disabled:opacity-50"
                              style={brandSaved[org.id]
                                ? { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success-border)", borderRadius: "10px" }
                                : { background: "var(--gold)", color: "#131312", borderRadius: "10px" }}>
                              {brandSaving[org.id] ? <Spinner size="xs" color="#131312" /> : brandSaved[org.id] ? <Check size={12} strokeWidth={2} /> : null}
                              {brandSaving[org.id] ? T.saving : brandSaved[org.id] ? T.saved : T.saveBranding}
                            </button>
                          </div>
                        )}

                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 pt-6" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={() => router.push("/portal/admin/manage")} className="text-[12px] font-medium transition-colors" style={{ color: "var(--w3)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--w)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--w3)")}>
            ← Manage individual sub-admins (legacy)
          </button>
        </div>

      </div>
    </main>
    {/* ── QR code modal ───────────────────────────────────────────────────── */}
    {qrModal && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
        onClick={() => setQrModal(null)}>
        <div className="rounded-2xl p-6 flex flex-col items-center gap-4 w-full max-w-[300px]"
          style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
          onClick={e => e.stopPropagation()}>
          <p className="text-[13px] font-semibold text-center" style={{ color: "var(--w)" }}>{qrModal.label}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&bgcolor=1a1a18&color=d4af37&data=${encodeURIComponent(qrModal.url)}`}
            alt="QR code"
            width={200}
            height={200}
            className="rounded-xl"
            style={{ border: "2px solid var(--border-gold)" }}
          />
          <p className="text-[10.5px] text-center break-all px-1" style={{ color: "var(--w3)" }}>{qrModal.url}</p>
          <p className="text-[10px] text-center px-2" style={{ color: "rgba(160,160,154,0.6)" }}>
            {T.singleUseWarning}
          </p>
          <div className="flex gap-2 w-full">
            <button
              onClick={() => { navigator.clipboard.writeText(qrModal.url); flashCopied("qr"); }}
              className="flex-1 py-2 text-[12px] font-semibold rounded-xl transition-opacity hover:opacity-80"
              style={{ background: "var(--bg2)", color: copiedKey === "qr" ? "var(--gold)" : "var(--w2)", border: "1px solid var(--border)" }}>
              {copiedKey === "qr" ? T.copied : T.copyLink}
            </button>
            <button
              onClick={() => downloadQr(qrModal.url, qrModal.label)}
              className="flex-1 py-2 text-[12px] font-semibold rounded-xl transition-opacity hover:opacity-80"
              style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
              {T.downloadQR}
            </button>
          </div>
          <button
            onClick={() => setQrModal(null)}
            className="w-full py-2 text-[12px] font-semibold rounded-xl transition-opacity hover:opacity-80"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
            {T.close}
          </button>
        </div>
      </div>
    )}
    </>
  );
}
