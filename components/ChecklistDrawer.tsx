"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { ListChecks, X, Check, Plus, Trash2, ChevronDown } from "lucide-react";
import { JourneyChecklist } from "@/components/JourneyChecklist";
import { onJourneyChange, emitJourneyChange } from "@/lib/journeyBus";

const t = {
  en: { aria: "Checklist", title: "Checklist",
    personal: "Personal", shared: "Shared", assigned: "Assigned",
    add: "Add a task…", emptyShared: "No shared tasks yet.", emptyPersonal: "No tasks yet — add one above.",
    sharedHq: "Shared with all Borivon admins", sharedOrg: "Shared with your organization's admins",
    orgListFallback: "Your organization", borivonList: "Borivon admins", sharedBorivonHint: "Shared privately with Borivon admins.",
    assignedHint: "Steps assigned to you by Borivon / your organization.",
    assignTab: "Assign", assignTaskPh: "Tasks — one per line…", pickCandPh: "Search candidates…", assignBtn: "Assign", noCands: "No candidates found.", trackingBtn: "Assigned tasks", trackingEmpty: "Nothing assigned yet." },
  fr: { aria: "Checklist", title: "Checklist",
    personal: "Personnel", shared: "Partagé", assigned: "Assigné",
    add: "Ajouter une tâche…", emptyShared: "Aucune tâche partagée.", emptyPersonal: "Aucune tâche — ajoutez-en une.",
    sharedHq: "Partagé avec tous les admins Borivon", sharedOrg: "Partagé avec les admins de votre organisation",
    orgListFallback: "Votre organisation", borivonList: "Admins Borivon", sharedBorivonHint: "Partagé en privé avec les admins Borivon.",
    assignedHint: "Étapes qui vous sont assignées par Borivon / votre organisation.",
    assignTab: "Assigner", assignTaskPh: "Tâches — une par ligne…", pickCandPh: "Rechercher des candidats…", assignBtn: "Assigner", noCands: "Aucun candidat trouvé.", trackingBtn: "Tâches assignées", trackingEmpty: "Rien d'assigné." },
  de: { aria: "Checkliste", title: "Checkliste",
    personal: "Persönlich", shared: "Geteilt", assigned: "Zugewiesen",
    add: "Aufgabe hinzufügen…", emptyShared: "Noch keine geteilten Aufgaben.", emptyPersonal: "Noch keine Aufgaben — oben hinzufügen.",
    sharedHq: "Mit allen Borivon-Admins geteilt", sharedOrg: "Mit den Admins Ihrer Organisation geteilt",
    orgListFallback: "Ihre Organisation", borivonList: "Borivon-Admins", sharedBorivonHint: "Privat mit Borivon-Admins geteilt.",
    assignedHint: "Schritte, die Ihnen Borivon / Ihre Organisation zugewiesen hat.",
    assignTab: "Zuweisen", assignTaskPh: "Aufgaben — eine pro Zeile…", pickCandPh: "Kandidaten suchen…", assignBtn: "Zuweisen", noCands: "Keine Kandidaten gefunden.", trackingBtn: "Zugewiesene Aufgaben", trackingEmpty: "Nichts zugewiesen." },
};

type ManualItem = { id: string; scope: string; text: string; done: boolean; position: number };
type Cand = { id: string; name: string; email: string };
type TrackItem = { id: string; text: string; done: boolean; done_at: string | null };
type TrackGroup = { candidateId: string; name: string; total: number; done: number; items: TrackItem[] };
type Tab = "shared" | "personal" | "assigned" | "assign";

export function ChecklistDrawer() {
  const { lang } = useLang();
  const T = t[lang as keyof typeof t] ?? t.en;

  const [mode, setMode] = useState<"candidate" | "admin" | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [uid, setUid] = useState("");

  const [tab, setTab] = useState<Tab>("personal");
  const [personal, setPersonal] = useState<ManualItem[]>([]);
  const [shared, setShared] = useState<ManualItem[]>([]);          // admin: org/HQ list
  const [sharedBorivon, setSharedBorivon] = useState<ManualItem[]>([]); // org↔Borivon channel
  const [scope, setScope] = useState<"hq" | "org">("hq");          // admin shared scope
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);             // org-scoped admin?
  const [orgName, setOrgName] = useState<string | null>(null);     // for the sub-button label
  const [sharedSub, setSharedSub] = useState<"org" | "borivon">("org"); // which shared list (org admins)
  const [loaded, setLoaded] = useState(false);
  const [newText, setNewText] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [pendingAssigned, setPendingAssigned] = useState(0); // candidate: # incomplete assigned steps
  // admin "Assign" tab
  const [cands, setCands] = useState<Cand[]>([]);
  const [candsLoaded, setCandsLoaded] = useState(false);
  const [candQuery, setCandQuery] = useState("");
  const [assignText, setAssignText] = useState("");      // the "Add a task…" input
  const [stagedTasks, setStagedTasks] = useState<string[]>([]); // tasks queued to assign
  const [selectedCands, setSelectedCands] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState("");
  // admin tracking ("who checked what") — hidden until expanded
  const [showTracking, setShowTracking] = useState(false);
  const [tracking, setTracking] = useState<TrackGroup[]>([]);
  const [trackingLoaded, setTrackingLoaded] = useState(false);

  // Endpoint for the MANUAL list (personal/shared). Candidates use /me, admins
  // use /admin (which also serves the org-shared list).
  const manualEndpoint = mode === "admin" ? "/api/portal/admin/checklist" : "/api/portal/me/checklist";

  // Candidate badge: count of incomplete ASSIGNED (journey) steps. Drives the
  // notification dot on the checklist icon so candidates notice new to-dos.
  const refreshBadge = useCallback(async (tk: string, id: string) => {
    const res = await fetch(`/api/portal/journey?candidateId=${id}`, { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null);
    const j = res && res.ok ? await res.json().catch(() => ({})) : {};
    const items = (j.items ?? []) as { done: boolean }[];
    setPendingAssigned(items.filter(i => !i.done).length);
  }, []);

  // Candidate picker for the admin "Assign" tab. /api/portal/admin returns the
  // candidate list already scoped per LAW #25 (supreme=all, org-admin=their org).
  const loadCandidates = useCallback(async (tk: string) => {
    const res = await fetch("/api/portal/admin", { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null);
    const j = res && res.ok ? await res.json().catch(() => ({})) : {};
    const users = (j.users ?? {}) as Record<string, { name?: string; email?: string }>;
    const list: Cand[] = Object.entries(users).map(([id, u]) => ({ id, name: u.name || u.email || id, email: u.email || "" }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    setCands(list);
    setCandsLoaded(true);
  }, []);

  // Tracking: every task this admin assigned, grouped by candidate + checked status.
  const loadTracking = useCallback(async (tk: string) => {
    const res = await fetch("/api/portal/admin/assigned-tasks", { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null);
    const j = res && res.ok ? await res.json().catch(() => ({})) : {};
    setTracking((j.groups ?? []) as TrackGroup[]);
    setTrackingLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled || !session?.user) return;
      const tk = session.access_token ?? "";
      const res = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null);
      const role = res ? ((await res.json().catch(() => ({}))) as { role?: string }).role : null;
      if (cancelled) return;
      if (role === "admin" || role === "sub_admin") { setToken(tk); setUid(session.user.id); setMode("admin"); setTab("shared"); }
      else if (role === "org_member") { /* org members use their dossier views */ }
      else { setUid(session.user.id); setToken(tk); setMode("candidate"); setTab("assigned"); void refreshBadge(tk, session.user.id); }
    });
    return () => { cancelled = true; };
  }, [refreshBadge]);

  const loadManual = useCallback(async (tk: string, isAdmin: boolean) => {
    const url = isAdmin ? "/api/portal/admin/checklist" : "/api/portal/me/checklist";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } }).catch(() => null);
    const j = res && res.ok ? await res.json().catch(() => ({})) : {};
    if (isAdmin) {
      setPersonal((j.personal ?? []) as ManualItem[]);
      setShared((j.shared ?? []) as ManualItem[]);
      setSharedBorivon((j.sharedBorivon ?? []) as ManualItem[]);
      setScope(j.scope === "org" ? "org" : "hq");
      setIsOrgAdmin(!!j.isOrgAdmin);
      setOrgName(typeof j.orgName === "string" ? j.orgName : null);
    } else {
      setPersonal((j.items ?? []) as ManualItem[]);
    }
    setLoaded(true);
  }, []);

  function openDrawer() {
    setOpen(true);
    if (mode && token) loadManual(token, mode === "admin");
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // When the drawer closes, re-count incomplete assigned steps so the icon
  // badge reflects anything the candidate just ticked off.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open && mode === "candidate" && token && uid) void refreshBadge(token, uid);
    wasOpenRef.current = open;
  }, [open, mode, token, uid, refreshBadge]);

  // Lazy-load the candidate list the first time the admin opens the Assign tab.
  useEffect(() => {
    if (open && mode === "admin" && tab === "assign" && !candsLoaded && token) void loadCandidates(token);
  }, [open, mode, tab, candsLoaded, token, loadCandidates]);

  // Realtime: bump the candidate's icon badge the instant a task is assigned /
  // ticked anywhere (admin assign, another tab, etc.).
  useEffect(() => {
    if (mode !== "candidate" || !uid || !token) return;
    return onJourneyChange(uid, () => void refreshBadge(token, uid));
  }, [mode, uid, token, refreshBadge]);

  // Realtime: while the admin tracker is open, refresh it when any shown
  // candidate ticks/changes a task (live "who checked what").
  const trackIds = tracking.map(g => g.candidateId).join(",");
  useEffect(() => {
    if (mode !== "admin" || !showTracking || !token || !trackIds) return;
    const offs = trackIds.split(",").map(cid => onJourneyChange(cid, () => void loadTracking(token)));
    return () => offs.forEach(off => off());
  }, [mode, showTracking, token, trackIds, loadTracking]);

  // ─── manual list mutations (personal/shared) ──────────────────────────────
  // Org admins toggle between their org list and the org↔Borivon channel.
  const onBorivonChannel = tab === "shared" && isOrgAdmin && sharedSub === "borivon";
  const sharedActive    = onBorivonChannel ? sharedBorivon : shared;
  const setSharedActive = onBorivonChannel ? setSharedBorivon : setShared;
  const list    = tab === "shared" ? sharedActive    : personal;
  const setList = tab === "shared" ? setSharedActive : setPersonal;

  async function addItem() {
    const text = newText.trim();
    if (!text || adding || tab === "assigned") return;
    setAdding(true);
    try {
      const body = mode === "admin"
        ? { scope: tab, text, ...(onBorivonChannel ? { list: "borivon" } : {}) }
        : { text };
      const res = await fetch(manualEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.item) { setList(prev => [...prev, j.item as ManualItem]); setNewText(""); inputRef.current?.focus(); }
    } finally { setAdding(false); }
  }

  async function toggleItem(it: ManualItem) {
    const next = !it.done;
    setList(prev => prev.map(x => x.id === it.id ? { ...x, done: next } : x));
    const res = await fetch(manualEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: it.id, done: next }),
    }).catch(() => null);
    if (!res || !res.ok) setList(prev => prev.map(x => x.id === it.id ? { ...x, done: it.done } : x));
  }

  async function deleteItem(it: ManualItem) {
    setList(prev => prev.filter(x => x.id !== it.id));
    const res = await fetch(manualEndpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: it.id }),
    }).catch(() => null);
    if (!res || !res.ok) setList(prev => [...prev, it].sort((a, b) => a.position - b.position));
  }

  function startEdit(it: ManualItem) { setEditingId(it.id); setEditText(it.text); }

  async function saveEdit(it: ManualItem) {
    const text = editText.trim();
    setEditingId(null);
    if (!text || text === it.text) return;          // nothing changed
    setList(prev => prev.map(x => x.id === it.id ? { ...x, text } : x));
    const res = await fetch(manualEndpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: it.id, text }),
    }).catch(() => null);
    if (!res || !res.ok) setList(prev => prev.map(x => x.id === it.id ? { ...x, text: it.text } : x)); // revert
  }

  // Admin "Assign" → fan out EVERY task line to EVERY selected candidate as a
  // candidate-owned journey item. Server enforces scope (canActOnCandidate).
  // Each lands in that candidate's Assigned tab + lights their badge.
  function addStagedTask() {
    const t = assignText.trim();
    if (!t) return;
    setStagedTasks(prev => [...prev, t]);
    setAssignText("");
  }
  function removeStagedTask(idx: number) {
    setStagedTasks(prev => prev.filter((_, i) => i !== idx));
  }

  async function assign() {
    // Include a typed-but-not-yet-added task so nothing is silently dropped.
    const tasks = [...stagedTasks, assignText.trim()].map(s => s.trim()).filter(Boolean);
    if (!tasks.length || selectedCands.length === 0 || assigning) return;
    setAssigning(true);
    setAssignMsg("");
    try {
      const jobs: Promise<Response>[] = [];
      for (const cid of selectedCands)
        for (const text of tasks)
          jobs.push(fetch("/api/portal/journey", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ candidateId: cid, text, owner: "candidate" }),
          }));
      const results = await Promise.allSettled(jobs);
      const ok = results.filter(r => r.status === "fulfilled" && r.value.ok).length;
      if (ok > 0) selectedCands.forEach(cid => emitJourneyChange(cid)); // ping each candidate's badge/list
      const nT = tasks.length, nC = selectedCands.length;
      if (ok === jobs.length) {
        setAssignMsg(
          lang === "de" ? `${nT} Aufgabe(n) an ${nC} Kandidat(en) zugewiesen`
          : lang === "fr" ? `${nT} tâche(s) assignée(s) à ${nC} candidat(s)`
          : `Assigned ${nT} task${nT > 1 ? "s" : ""} to ${nC} candidate${nC > 1 ? "s" : ""}`,
        );
        setAssignText("");
        setStagedTasks([]);
        setSelectedCands([]);
      } else {
        setAssignMsg(`${ok}/${jobs.length}`);
      }
    } finally { setAssigning(false); }
  }

  function toggleCand(id: string) {
    setSelectedCands(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleTracking() {
    const next = !showTracking;
    setShowTracking(next);
    if (next && token) void loadTracking(token); // refresh each time it's opened
  }

  const filteredCands = (() => {
    const q = candQuery.trim().toLowerCase();
    return q ? cands.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)) : cands;
  })();

  if (!mode) return null;

  const TABS: Tab[] = mode === "admin" ? ["shared", "personal", "assign"] : ["assigned", "personal"];
  const tabLabel = (id: Tab) => id === "shared" ? T.shared : id === "personal" ? T.personal : id === "assign" ? T.assignTab : T.assigned;
  const badgeOn = mode === "candidate" && pendingAssigned > 0;

  const TabBtn = ({ id }: { id: Tab }) => (
    <button onClick={() => setTab(id)}
      style={{
        flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600, cursor: "pointer",
        background: tab === id ? "var(--card)" : "transparent",
        color: tab === id ? "var(--w)" : "var(--w3)",
        border: "1px solid", borderColor: tab === id ? "var(--border-gold)" : "var(--border)",
        borderRadius: 9, transition: "all var(--dur-1) var(--ease)",
      }}>
      {tabLabel(id)}
    </button>
  );

  return (
    <>
      <button onClick={openDrawer} aria-label={badgeOn ? `${T.aria} (${pendingAssigned})` : T.aria}
        className="relative flex items-center justify-center w-11 h-11 cursor-pointer hover:scale-110 active:scale-95"
        style={{ background: "transparent", border: "none", color: badgeOn ? "var(--gold)" : "var(--w3)", transition: "color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease)" }}
        onMouseEnter={e => { if (!badgeOn) e.currentTarget.style.color = "var(--w)"; }}
        onMouseLeave={e => { if (!badgeOn) e.currentTarget.style.color = "var(--w3)"; }}>
        <ListChecks size={20} strokeWidth={1.8} />
        {badgeOn && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-[9px] font-bold"
            style={{ minWidth: 15, height: 15, paddingInline: 3, background: "var(--gold)", color: "#131312", lineHeight: 1 }}>
            {pendingAssigned > 9 ? "9+" : pendingAssigned}
          </span>
        )}
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
                  <ListChecks size={18} /> {T.title}
                </h2>
                <button onClick={() => setOpen(false)} aria-label="Close"
                  style={{ background: "none", border: "none", color: "var(--w3)", cursor: "pointer", padding: 4 }}>
                  <X size={20} />
                </button>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 7 }}>
                {TABS.map(id => <TabBtn key={id} id={id} />)}
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 28px" }}>
              {/* Assigned tab (candidate) → the per-candidate journey, candidate items only */}
              {tab === "assigned" ? (
                <>
                  {uid && <JourneyChecklist candidateUserId={uid} />}
                </>
              ) : tab === "assign" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* 1. build the task list — same "Add a task…" + rows as the checklist */}
                  <div style={{ display: "flex", gap: 7 }}>
                    <input value={assignText} onChange={e => setAssignText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addStagedTask(); } }}
                      placeholder={T.add}
                      style={{ flex: 1, padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13 }} />
                    <button onClick={addStagedTask} disabled={!assignText.trim()} aria-label={T.add}
                      style={{ flexShrink: 0, width: 40, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9, border: "none",
                        cursor: assignText.trim() ? "pointer" : "default",
                        background: assignText.trim() ? "var(--gold)" : "var(--card)",
                        color: assignText.trim() ? "#131312" : "var(--w3)" }}>
                      <Plus size={18} strokeWidth={2.4} />
                    </button>
                  </div>
                  {stagedTasks.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {stagedTasks.map((tk, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)" }}>
                          <span style={{ flex: "1 1 auto", fontSize: 13.5, lineHeight: 1.35, wordBreak: "break-word", color: "var(--w)" }}>{tk}</span>
                          <button onClick={() => removeStagedTask(i)} aria-label="delete"
                            style={{ flexShrink: 0, background: "none", border: "none", color: "var(--w3)", cursor: "pointer", padding: 4, display: "flex" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                            onMouseLeave={e => (e.currentTarget.style.color = "var(--w3)")}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 2. pick candidates — tap to toggle (multi-select) */}
                  <input value={candQuery} onChange={e => setCandQuery(e.target.value)} placeholder={T.pickCandPh}
                    style={{ padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                    {!candsLoaded ? (
                      <div style={{ textAlign: "center", color: "var(--w3)", padding: "1.5rem 0" }}>…</div>
                    ) : filteredCands.length === 0 ? (
                      <div style={{ textAlign: "center", color: "var(--w3)", padding: "1.5rem 0", fontSize: 13 }}>{T.noCands}</div>
                    ) : filteredCands.map(c => {
                      const sel = selectedCands.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => toggleCand(c.id)}
                          style={{ textAlign: "left", padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                            border: "1px solid", borderColor: sel ? "var(--border-gold)" : "var(--border)",
                            background: sel ? "var(--gdim)" : "var(--card)", display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center",
                            border: sel ? "none" : "2px solid var(--w3)", background: sel ? "var(--gold)" : "transparent" }}>
                            {sel && <Check size={12} strokeWidth={3.5} style={{ color: "#131312" }} />}
                          </span>
                          <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: sel ? "var(--gold)" : "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                            {c.email && <span style={{ fontSize: 11, color: "var(--w3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {/* 3. assign all tasks to all selected candidates */}
                  {(() => {
                    const ready = (stagedTasks.length > 0 || assignText.trim().length > 0) && selectedCands.length > 0 && !assigning;
                    return (
                      <button onClick={() => void assign()} disabled={!ready}
                        style={{ padding: "10px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 13,
                          cursor: ready ? "pointer" : "default",
                          background: ready ? "var(--gold)" : "var(--card)",
                          color: ready ? "#131312" : "var(--w3)" }}>
                        {assigning ? "…" : `${T.assignBtn}${selectedCands.length ? ` · ${selectedCands.length}` : ""}`}
                      </button>
                    );
                  })()}
                  {assignMsg && <div style={{ fontSize: 12.5, color: "var(--success)", textAlign: "center" }}>✓ {assignMsg}</div>}

                  {/* tracking — hidden until clicked: who's checked what */}
                  <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 10 }}>
                    <button onClick={toggleTracking}
                      style={{ width: "100%", background: "none", border: "none", cursor: "pointer", color: "var(--w3)", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, padding: "4px 2px" }}>
                      <ChevronDown size={14} style={{ transform: showTracking ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                      {T.trackingBtn}
                    </button>
                    {showTracking && (
                      <div style={{ marginTop: 8 }}>
                        {!trackingLoaded ? (
                          <div style={{ textAlign: "center", color: "var(--w3)", padding: "1rem 0" }}>…</div>
                        ) : tracking.length === 0 ? (
                          <div style={{ textAlign: "center", color: "var(--w3)", padding: "1rem 0", fontSize: 13 }}>{T.trackingEmpty}</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {tracking.map(g => (
                              <div key={g.candidateId} style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)", overflow: "hidden" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--w)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
                                  <span style={{ fontSize: 11, color: g.done === g.total ? "#16a34a" : "var(--w3)", flexShrink: 0 }}>{g.done}/{g.total}</span>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "8px 10px" }}>
                                  {g.items.map(it => (
                                    <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                                      {it.done
                                        ? <Check size={13} strokeWidth={3} style={{ color: "#16a34a", flexShrink: 0 }} />
                                        : <span style={{ flexShrink: 0, width: 13, height: 13, borderRadius: 999, border: "2px solid var(--w3)" }} />}
                                      <span style={{ color: it.done ? "var(--w3)" : "var(--w2)", textDecoration: it.done ? "line-through" : "none", wordBreak: "break-word" }}>{it.text}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Org admins: two sub-lists under Shared — their org vs the
                      private org↔Borivon channel. */}
                  {tab === "shared" && isOrgAdmin && (
                    <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
                      {([
                        { id: "org" as const,     label: orgName || T.orgListFallback },
                        { id: "borivon" as const, label: T.borivonList },
                      ]).map(b => (
                        <button key={b.id} onClick={() => setSharedSub(b.id)}
                          style={{
                            flex: 1, padding: "7px 0", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                            background: sharedSub === b.id ? "var(--card)" : "transparent",
                            color: sharedSub === b.id ? "var(--w)" : "var(--w3)",
                            border: "1px solid", borderColor: sharedSub === b.id ? "var(--border-gold)" : "var(--border)",
                            borderRadius: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                            transition: "all var(--dur-1) var(--ease)",
                          }}>
                          {b.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Shared-scope hint (admin shared tab only) */}
                  {tab === "shared" && (
                    <div style={{ fontSize: 11, color: "var(--w3)", marginBottom: 10 }}>
                      {isOrgAdmin
                        ? (sharedSub === "borivon" ? T.sharedBorivonHint : T.sharedOrg)
                        : T.sharedHq}
                    </div>
                  )}

                  {/* Add row */}
                  <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
                    <input ref={inputRef} value={newText} onChange={e => setNewText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addItem(); } }}
                      placeholder={T.add}
                      style={{ flex: 1, padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13 }} />
                    <button onClick={() => void addItem()} disabled={!newText.trim() || adding} aria-label={T.add}
                      style={{
                        flexShrink: 0, width: 40, display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: 9, border: "none", cursor: newText.trim() && !adding ? "pointer" : "default",
                        background: newText.trim() && !adding ? "var(--gold)" : "var(--card)",
                        color: newText.trim() && !adding ? "#131312" : "var(--w3)",
                        opacity: adding ? 0.6 : 1, transition: "all var(--dur-1) var(--ease)",
                      }}>
                      <Plus size={18} strokeWidth={2.4} />
                    </button>
                  </div>

                  {/* Items */}
                  {!loaded ? (
                    <div style={{ textAlign: "center", color: "var(--w3)", padding: "2rem 0" }}>…</div>
                  ) : list.length === 0 ? (
                    <div style={{ textAlign: "center", color: "var(--w3)", padding: "1.5rem 0", fontSize: 13 }}>
                      {tab === "shared" ? T.emptyShared : T.emptyPersonal}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {list.map(it => (
                        <div key={it.id} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "9px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)",
                        }}>
                          <button onClick={() => void toggleItem(it)} aria-label="toggle"
                            style={{
                              flexShrink: 0, width: 20, height: 20, borderRadius: 6, cursor: "pointer",
                              border: it.done ? "none" : "2px solid var(--w3)",
                              background: it.done ? "#16a34a" : "transparent",
                              display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                            }}>
                            {it.done && <Check size={13} strokeWidth={3.5} style={{ color: "#fff" }} />}
                          </button>
                          {editingId === it.id ? (
                            <input autoFocus value={editText}
                              onChange={e => setEditText(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void saveEdit(it); } else if (e.key === "Escape") setEditingId(null); }}
                              onBlur={() => void saveEdit(it)}
                              style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13.5, padding: "2px 6px", borderRadius: 6, border: "1px solid var(--border-gold)", background: "var(--bg2)", color: "var(--w)" }} />
                          ) : (
                            <span onClick={() => startEdit(it)} title="Click to edit"
                              style={{
                                flex: "1 1 auto", fontSize: 13.5, lineHeight: 1.35, wordBreak: "break-word", cursor: "text",
                                color: it.done ? "var(--w3)" : "var(--w)",
                                textDecoration: it.done ? "line-through" : "none",
                              }}>{it.text}</span>
                          )}
                          <button onClick={() => void deleteItem(it)} aria-label="delete"
                            style={{ flexShrink: 0, background: "none", border: "none", color: "var(--w3)", cursor: "pointer", padding: 4, display: "flex" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                            onMouseLeave={e => (e.currentTarget.style.color = "var(--w3)")}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
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
