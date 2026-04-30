"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, Building2, Trash2, Copy, Check, ChevronDown, Plus, UserPlus, X as XIcon, AlertCircle, RefreshCw, MessageSquare, Crown, User as UserIcon } from "lucide-react";
import { CheckCircle2 } from "@/components/PortalIcons";
import { PageLoader, EmptyState, Spinner } from "@/components/ui/states";

type Org = {
  id: string;
  name: string;
  invite_code: string;
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

export default function OrganizationsPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading]         = useState(true);

  const [orgs, setOrgs]                       = useState<Org[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [candidates, setCandidates]           = useState<Candidate[]>([]);

  // Per-org expanded state — { orgId: { members, orgCandidates } }
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [orgMembers, setOrgMembers]       = useState<Record<string, Member[]>>({});
  const [orgCandidates, setOrgCandidates] = useState<Record<string, OrgCandidate[]>>({});

  // New-org form
  const [newName, setNewName]   = useState("");
  const [newCode, setNewCode]   = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // New-member form per org
  const [memberEmail, setMemberEmail] = useState<Record<string, string>>({});
  const [memberName,  setMemberName]  = useState<Record<string, string>>({});
  const [memberError, setMemberError] = useState<Record<string, string>>({});

  // CV branding per org — logo filename + footer text
  const [editLogo,   setEditLogo]   = useState<Record<string, string>>({});
  const [editFooter, setEditFooter] = useState<Record<string, string>>({});
  const [brandSaving, setBrandSaving] = useState<Record<string, boolean>>({});
  const [brandSaved,  setBrandSaved]  = useState<Record<string, boolean>>({});

  // "Copy" feedback — `${id}_${kind}` (kind: 'code' | 'msg')
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Track in-flight code regeneration so the spinner shows on the right org
  const [regenId, setRegenId]     = useState<string | null>(null);

  const loadData = useCallback(async (token: string) => {
    const [orgsRes, reqRes, candRes] = await Promise.all([
      fetch("/api/portal/admin/organizations",         { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/portal/admin/organization-requests", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/portal/admin",                       { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const orgsJson = await orgsRes.json();
    const reqJson  = await reqRes.json();
    const candJson = await candRes.json();

    setOrgs(orgsJson.orgs ?? []);
    setPendingRequests(reqJson.requests ?? []);

    const docs:  { user_id: string }[] = candJson.docs ?? [];
    const users: Record<string, { name: string; email: string }> = candJson.users ?? {};
    const unique = [...new Set(docs.map(d => d.user_id))];
    setCandidates(unique.map(uid => ({
      userId: uid,
      name:   users[uid]?.name  ?? uid,
      email:  users[uid]?.email ?? uid,
    })));
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
    const [memRes, candRes] = await Promise.all([
      fetch(`/api/portal/admin/organizations/${orgId}/members`,    { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`/api/portal/admin/organizations/${orgId}/candidates`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    const memJson  = await memRes.json();
    const candJson = await candRes.json();
    setOrgMembers(prev => ({ ...prev, [orgId]: memJson.members ?? [] }));
    setOrgCandidates(prev => ({ ...prev, [orgId]: candJson.candidates ?? [] }));
  }

  async function createOrg() {
    if (!newName.trim()) { setCreateError("Name is required."); return; }
    setCreating(true); setCreateError("");
    const res = await fetch("/api/portal/admin/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ name: newName.trim(), inviteCode: newCode.trim(), notes: newNotes.trim() }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setCreateError(j?.error || "Could not create organization.");
      setCreating(false);
      return;
    }
    setNewName(""); setNewCode(""); setNewNotes("");
    await loadData(accessToken);
    setCreating(false);
  }

  async function deleteOrg(orgId: string, name: string) {
    if (!confirm(`Delete organization "${name}"?\n\nThis removes all member and candidate links. Members keep their accounts.`)) return;
    await fetch(`/api/portal/admin/organizations/${orgId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (expandedOrgId === orgId) setExpandedOrgId(null);
    await loadData(accessToken);
  }

  async function addMember(orgId: string) {
    const email = (memberEmail[orgId] ?? "").trim().toLowerCase();
    const name  = (memberName[orgId]  ?? "").trim();
    if (!email) { setMemberError(prev => ({ ...prev, [orgId]: "Email required" })); return; }
    setMemberError(prev => ({ ...prev, [orgId]: "" }));
    const res = await fetch(`/api/portal/admin/organizations/${orgId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email, name }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMemberError(prev => ({ ...prev, [orgId]: j?.error || "Could not add" }));
      return;
    }
    setMemberEmail(prev => ({ ...prev, [orgId]: "" }));
    setMemberName(prev  => ({ ...prev, [orgId]: "" }));
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

  async function toggleCandidate(orgId: string, candidateUserId: string) {
    const linked = (orgCandidates[orgId] ?? []).some(c => c.userId === candidateUserId);
    if (linked) {
      await fetch(`/api/portal/admin/organizations/${orgId}/candidates`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ candidateUserId }),
      });
    } else {
      await fetch(`/api/portal/admin/organizations/${orgId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ candidateUserId, status: "approved" }),
      });
    }
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

  function flashCopied(key: string) {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1500);
  }

  function copyCode(code: string, id: string) {
    navigator.clipboard.writeText(code).then(() => flashCopied(`${id}_code`));
  }

  function copyInviteMessage(org: Org) {
    const base = typeof window !== "undefined" ? window.location.origin : "https://borivon.com";
    const msg =
`Welcome! You have been invited to join ${org.name} on the Borivon portal.

1. Sign up at ${base}/portal
2. After login, paste this code when prompted:

   ${org.invite_code}

If you have questions, reply to this message.`;
    navigator.clipboard.writeText(msg).then(() => flashCopied(`${org.id}_msg`));
  }

  async function regenerateCode(org: Org) {
    if (!confirm(`Regenerate the invite code for ${org.name}?\n\nThe old code "${org.invite_code}" will stop working immediately. Existing candidates stay linked.`)) return;
    setRegenId(org.id);
    try {
      const res = await fetch(`/api/portal/admin/organizations/${org.id}/regenerate-code`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) await loadData(accessToken);
    } finally {
      setRegenId(null);
    }
  }

  async function saveBranding(orgId: string) {
    setBrandSaving(p => ({ ...p, [orgId]: true }));
    setBrandSaved(p => ({ ...p, [orgId]: false }));
    await fetch(`/api/portal/admin/organizations/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        logoFilename: editLogo[orgId] ?? "",
        footerText:   editFooter[orgId] ?? "",
      }),
    });
    await loadData(accessToken);
    setBrandSaving(p => ({ ...p, [orgId]: false }));
    setBrandSaved(p => ({ ...p, [orgId]: true }));
    setTimeout(() => setBrandSaved(p => ({ ...p, [orgId]: false })), 2000);
  }

  async function setMemberRole(orgId: string, email: string, role: "member" | "owner") {
    await fetch(`/api/portal/admin/organizations/${orgId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email, role }),
    });
    await loadOrgDetails(orgId);
  }

  function nameForCandidate(uid: string): { name: string; email: string } {
    const c = candidates.find(c => c.userId === uid);
    return { name: c?.name ?? uid, email: c?.email ?? "" };
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
      <main className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "calc(61px + 2rem)" }}>
        <div className="max-w-[760px] mx-auto px-4 pt-8 pb-16">

          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <button onClick={() => router.back()} aria-label="Back"
              className="bv-icon-btn w-9 h-9 flex items-center justify-center flex-shrink-0 rounded-full"
              style={{ color: "var(--w2)" }}>
              <ArrowLeft size={15} strokeWidth={1.8} />
            </button>
            <div>
              <h1 className="text-[20px] font-semibold tracking-[-0.015em]" style={{ color: "var(--w)" }}>Organizations</h1>
              <p className="text-[12.5px] mt-1" style={{ color: "var(--w3)" }}>
                Recruitment partners, employers, and any other group that should see specific candidates
              </p>
            </div>
          </div>

          {/* Pending requests inbox — premium card with gold accent border
              to flag that admin attention is required. */}
          {pendingRequests.length > 0 && (
            <div className="p-5 mb-6"
              style={{ background: "var(--card)", border: "1px solid var(--border-gold)", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={14} style={{ color: "var(--gold)" }} />
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--gold)" }}>
                  Pending requests · {pendingRequests.length}
                </p>
              </div>
              <div className="space-y-2">
                {pendingRequests.map(req => {
                  const { name, email } = nameForCandidate(req.candidateUserId);
                  return (
                    <div key={`${req.candidateUserId}_${req.orgId}`} className="p-3 flex items-center gap-3"
                      style={{ background: "var(--bg2)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{name}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>
                          {email} · wants to join <span style={{ color: "var(--w2)" }}>{req.orgName}</span>
                        </p>
                      </div>
                      <button onClick={() => approveRequest(req)}
                        className="bv-icon-btn bv-icon-btn--approve w-8 h-8 rounded-full flex items-center justify-center"
                        title="Approve">
                        <CheckCircle2 size={13} strokeWidth={1.8} />
                      </button>
                      <button onClick={() => rejectRequest(req)}
                        className="bv-icon-btn bv-icon-btn--reject w-8 h-8 rounded-full flex items-center justify-center"
                        title="Reject">
                        <XIcon size={13} strokeWidth={1.8} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Create new org — same surface language as CV builder sections */}
          <div className="p-5 mb-6"
            style={{ background: "var(--card)", border: "none", borderRadius: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-4" style={{ color: "var(--w3)" }}>Add organization</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>Name *</label>
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="Calmaroi" className={inputCls} style={inputSt} />
                </div>
                <div>
                  <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>Invite code (optional)</label>
                  <input type="text" value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())}
                    placeholder="auto-generated" className={inputCls + " uppercase tracking-wider"} style={inputSt} />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>Notes (only you see these)</label>
                <input type="text" value={newNotes} onChange={e => setNewNotes(e.target.value)}
                  placeholder="e.g. Recruitment agency, Casablanca · contact: lukas@calmaroi.com"
                  className={inputCls} style={inputSt} />
              </div>
              {createError && (
                <p className="text-[12px] px-3 py-2 rounded-lg"
                  style={{ background: "rgba(224,82,82,0.08)", color: "#e05252", border: "1px solid rgba(224,82,82,0.2)" }}>
                  {createError}
                </p>
              )}
              <button onClick={createOrg} disabled={creating}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold tracking-tight transition-opacity disabled:opacity-50"
                style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-sm)" }}>
                {creating ? <Spinner size="xs" color="#131312" /> : <Plus size={13} strokeWidth={2.2} />}
                {creating ? "Creating…" : "Create organization"}
              </button>
            </div>
          </div>

          {/* Org list */}
          {orgs.length === 0 ? (
            <EmptyState
              Icon={Building2}
              title="No organizations yet"
              sub="Add your first one above. Each gets a unique invite code you give to candidates."
            />
          ) : (
            <div className="overflow-hidden"
              style={{
                background: "var(--card)",
                borderRadius: "20px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}>
              {orgs.map(org => {
                const isExpanded = expandedOrgId === org.id;
                const members    = orgMembers[org.id] ?? [];
                const linked     = orgCandidates[org.id] ?? [];
                const linkedIds  = new Set(linked.map(l => l.userId));

                return (
                  <div key={org.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    {/* Row */}
                    <div className="px-3 py-3 flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                        <Building2 size={14} strokeWidth={1.8} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{org.name}</p>
                        <p className="text-[11.5px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>
                          {org.memberCount} member{org.memberCount !== 1 ? "s" : ""} · {org.candidateCount} candidate{org.candidateCount !== 1 ? "s" : ""}
                          {org.pendingCount > 0 && <span style={{ color: "var(--gold)" }}> · {org.pendingCount} pending</span>}
                          {org.notes ? ` · ${org.notes}` : ""}
                        </p>
                      </div>
                      <button onClick={() => copyCode(org.invite_code, org.id)}
                        className="inline-flex items-center gap-1.5 text-[11.5px] font-mono font-semibold tracking-wider px-2.5 py-1.5 transition-colors"
                        title="Copy code"
                        style={{ background: copiedKey === `${org.id}_code` ? "rgba(52,199,89,0.12)" : "var(--bg2)",
                                 color: copiedKey === `${org.id}_code` ? "#34c759" : "var(--w2)",
                                 border: `1px solid ${copiedKey === `${org.id}_code` ? "rgba(52,199,89,0.3)" : "var(--border)"}`,
                                 borderRadius: "var(--r-sm)" }}>
                        {copiedKey === `${org.id}_code` ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.8} />}
                        {org.invite_code}
                      </button>
                      <button onClick={() => copyInviteMessage(org)} aria-label="Copy invite message"
                        title="Copy ready-to-send invite message"
                        className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center"
                        style={{ color: copiedKey === `${org.id}_msg` ? "#34c759" : "var(--w3)" }}>
                        {copiedKey === `${org.id}_msg` ? <Check size={11} strokeWidth={2} /> : <MessageSquare size={11} strokeWidth={1.8} />}
                      </button>
                      <button onClick={() => regenerateCode(org)} aria-label="Regenerate code"
                        title="Generate a new code (old one stops working)"
                        disabled={regenId === org.id}
                        className="bv-icon-btn w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40"
                        style={{ color: "var(--w3)" }}>
                        <RefreshCw size={11} strokeWidth={1.8}
                          style={{ animation: regenId === org.id ? "spin 1s linear infinite" : undefined }} />
                      </button>
                      <button onClick={async () => {
                          if (isExpanded) { setExpandedOrgId(null); }
                          else {
                            setExpandedOrgId(org.id);
                            // Seed branding edit fields from current org values
                            setEditLogo(p => ({ ...p, [org.id]: org.logo_filename ?? "" }));
                            setEditFooter(p => ({ ...p, [org.id]: org.footer_text ?? "" }));
                            await loadOrgDetails(org.id);
                          }
                        }}
                        className="text-[12px] font-medium px-3 py-1.5 transition-colors"
                        style={{ background: isExpanded ? "var(--gdim)" : "var(--bg2)", color: isExpanded ? "var(--gold)" : "var(--w2)",
                                 border: `1px solid ${isExpanded ? "var(--border-gold)" : "var(--border)"}`, borderRadius: "var(--r-sm)" }}>
                        <ChevronDown size={11} strokeWidth={2} style={{ display: "inline-block", marginRight: 4, transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms" }} />
                        Manage
                      </button>
                      <button onClick={() => deleteOrg(org.id, org.name)} aria-label="Delete"
                        className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center">
                        <Trash2 size={12} strokeWidth={1.8} />
                      </button>
                    </div>

                    {/* Expanded panel */}
                    {isExpanded && (
                      <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg2)" }}>

                        {/* Members section */}
                        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: "var(--w3)" }}>Members</p>

                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <input type="email" placeholder="omar@calmaroi.com"
                              value={memberEmail[org.id] ?? ""}
                              onChange={e => setMemberEmail(prev => ({ ...prev, [org.id]: e.target.value }))}
                              className={inputCls} style={inputSt} />
                            <input type="text" placeholder="Omar (optional name)"
                              value={memberName[org.id] ?? ""}
                              onChange={e => setMemberName(prev => ({ ...prev, [org.id]: e.target.value }))}
                              className={inputCls} style={inputSt} />
                          </div>
                          <button onClick={() => addMember(org.id)}
                            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 transition-opacity"
                            style={{ background: "var(--card)", color: "var(--w)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)" }}>
                            <UserPlus size={11} strokeWidth={1.8} />
                            Add member
                          </button>
                          {memberError[org.id] && (
                            <p className="mt-2 text-[11px]" style={{ color: "#e05252" }}>{memberError[org.id]}</p>
                          )}

                          {members.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              {members.map(m => (
                                <div key={m.email} className="flex items-center gap-3 px-3 py-2"
                                  style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)" }}>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12.5px] font-medium tracking-tight" style={{ color: "var(--w)" }}>{m.name || m.email}</p>
                                    <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>{m.email}</p>
                                  </div>
                                  <button
                                    onClick={() => setMemberRole(org.id, m.email, m.role === "owner" ? "member" : "owner")}
                                    title={m.role === "owner"
                                      ? "Demote to member (operational access)"
                                      : "Promote to owner (board view, future)"}
                                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 transition-colors"
                                    style={{ background: m.role === "owner" ? "var(--gdim)" : "var(--bg2)",
                                             color: m.role === "owner" ? "var(--gold)" : "var(--w3)",
                                             border: `1px solid ${m.role === "owner" ? "var(--border-gold)" : "var(--border)"}`,
                                             borderRadius: "var(--r-sm)" }}>
                                    {m.role === "owner"
                                      ? <Crown size={9} strokeWidth={2} />
                                      : <UserIcon size={9} strokeWidth={2} />}
                                    {m.role}
                                  </button>
                                  <button onClick={() => removeMember(org.id, m.email)} aria-label="Remove"
                                    className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center">
                                    <Trash2 size={11} strokeWidth={1.8} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* CV Branding section */}
                        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: "var(--w3)" }}>CV Branding</p>
                          <p className="text-[11px] mb-3" style={{ color: "var(--w3)" }}>
                            Candidates linked to this org get this logo and footer on their generated CV.
                          </p>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>
                                Logo filename (in public/logos/)
                              </label>
                              <input type="text"
                                value={editLogo[org.id] ?? ""}
                                onChange={e => setEditLogo(p => ({ ...p, [org.id]: e.target.value }))}
                                placeholder="calmaroi-yellow.png"
                                className={inputCls} style={inputSt} />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium uppercase tracking-wide mb-1.5" style={{ color: "var(--w3)" }}>
                                Footer text (one line per row)
                              </label>
                              <textarea
                                value={editFooter[org.id] ?? ""}
                                onChange={e => setEditFooter(p => ({ ...p, [org.id]: e.target.value }))}
                                placeholder={"Calmaroí GmbH · Römerstraße 15\n63450 Hanau\nwww.calmaroi.de"}
                                rows={3}
                                className={inputCls + " resize-none"}
                                style={{ ...inputSt, lineHeight: "1.6" }} />
                            </div>
                            <button onClick={() => saveBranding(org.id)} disabled={brandSaving[org.id]}
                              className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 transition-all disabled:opacity-50"
                              style={brandSaved[org.id]
                                ? { background: "rgba(52,199,89,0.12)", color: "#34c759", border: "1px solid rgba(52,199,89,0.3)", borderRadius: "var(--r-sm)" }
                                : { background: "var(--gold)", color: "#131312", border: "none", borderRadius: "var(--r-sm)" }}>
                              {brandSaving[org.id] ? <Spinner size="xs" color="#131312" /> : brandSaved[org.id] ? <Check size={12} strokeWidth={2} /> : null}
                              {brandSaving[org.id] ? "Saving…" : brandSaved[org.id] ? "Saved" : "Save branding"}
                            </button>
                          </div>
                        </div>

                        {/* Candidates section */}
                        <div className="px-5 py-4">
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: "var(--w3)" }}>
                            Candidates · linked candidates can be seen by all members
                          </p>
                          {candidates.length === 0 ? (
                            <p className="text-[12px]" style={{ color: "var(--w3)" }}>No candidates in the system yet.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {candidates.map(c => {
                                const link = linked.find(l => l.userId === c.userId);
                                const isLinked = !!link;
                                const isPending = link?.status === "pending";
                                return (
                                  <div key={c.userId} className="flex items-center gap-3 px-3 py-2"
                                    style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)" }}>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12.5px] font-medium tracking-tight" style={{ color: "var(--w)" }}>{c.name}</p>
                                      <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>{c.email}</p>
                                    </div>
                                    {isPending && (
                                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5"
                                        style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", borderRadius: "var(--r-sm)" }}>
                                        Pending
                                      </span>
                                    )}
                                    <button onClick={() => toggleCandidate(org.id, c.userId)}
                                      className="inline-flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 font-semibold transition-all flex-shrink-0"
                                      style={isLinked && !isPending
                                        ? { background: "rgba(52,199,89,0.12)", color: "#34c759", border: "1px solid rgba(52,199,89,0.3)", borderRadius: "var(--r-sm)" }
                                        : { background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)" }
                                      }>
                                      {isLinked && !isPending ? <><CheckCircle2 size={11} strokeWidth={1.8} /> Linked</>
                                        : isPending ? "Approve from inbox above"
                                        : "Link"}
                                    </button>
                                    {isLinked && !isPending && (
                                      <button onClick={() => toggleCandidate(org.id, c.userId)} aria-label="Unlink"
                                        className="bv-icon-btn bv-icon-btn--reject w-7 h-7 rounded-full flex items-center justify-center">
                                        <Trash2 size={11} strokeWidth={1.8} />
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
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

          {/* Footer link to legacy admin manager */}
          <div className="mt-8 pt-6" style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={() => router.push("/portal/admin/manage")}
              className="text-[12px] font-medium transition-colors"
              style={{ color: "var(--w3)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--w)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--w3)")}>
              ← Manage individual sub-admins (legacy direct assignments)
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
