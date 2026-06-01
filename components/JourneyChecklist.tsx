"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { Check, Crown, Building2, User, Trash2, Plus, CalendarClock, AlertTriangle } from "lucide-react";
import { journeyItemLabel, canToggle, type JourneyOwner } from "@/lib/candidateJourney";
import { onJourneyChange, emitJourneyChange } from "@/lib/journeyBus";

type Item = {
  id: string;
  text: string;
  owner: JourneyOwner;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  preset_key: string | null;
  position: number;
  created_by: string | null;
  due_date: string | null;       // "YYYY-MM-DD"
  blocked: boolean;
  blocked_reason: string | null;
};

// Whole days from today (Casablanca) to a YYYY-MM-DD (negative = overdue).
function daysToDue(due: string | null): number | null {
  if (!due) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const a = Date.parse(`${today}T00:00:00Z`), b = Date.parse(`${due}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const T = {
  en: { complete: "complete", add: "Add a step…", empty: "No steps yet.", none: "Nothing assigned to you yet.", completed: "Completed", hide: "Hide completed",
    block: "Block", blocked: "Blocked", blockReason: "Why is it blocked?", dueToday: "due today",
    overdueBy: (n: number) => `${n}d overdue`, inDays: (n: number) => `in ${n}d`,
    owners: { borivon: "Borivon", organization: "Organization", candidate: "Candidate" } as Record<JourneyOwner, string> },
  fr: { complete: "complété", add: "Ajouter une étape…", empty: "Aucune étape.", none: "Rien ne vous est encore assigné.", completed: "Terminé", hide: "Masquer",
    block: "Bloquer", blocked: "Bloqué", blockReason: "Pourquoi bloqué ?", dueToday: "dû aujourd'hui",
    overdueBy: (n: number) => `${n}j de retard`, inDays: (n: number) => `dans ${n}j`,
    owners: { borivon: "Borivon", organization: "Organisation", candidate: "Candidat" } as Record<JourneyOwner, string> },
  de: { complete: "abgeschlossen", add: "Schritt hinzufügen…", empty: "Noch keine Schritte.", none: "Ihnen ist noch nichts zugewiesen.", completed: "Erledigt", hide: "Ausblenden",
    block: "Blockieren", blocked: "Blockiert", blockReason: "Warum blockiert?", dueToday: "heute fällig",
    overdueBy: (n: number) => `${n} T. überfällig`, inDays: (n: number) => `in ${n} T.`,
    owners: { borivon: "Borivon", organization: "Organisation", candidate: "Kandidat" } as Record<JourneyOwner, string> },
};

const OWNER_STYLE: Record<JourneyOwner, { bg: string; fg: string; border: string }> = {
  borivon:      { bg: "var(--gdim)", fg: "var(--gold)", border: "var(--border-gold)" },
  organization: { bg: "rgba(59,130,246,0.13)", fg: "#3b82f6", border: "rgba(59,130,246,0.4)" },
  candidate:    { bg: "rgba(16,163,74,0.13)", fg: "#16a34a", border: "rgba(16,163,74,0.4)" },
};
function OwnerIcon({ owner, size = 11 }: { owner: JourneyOwner; size?: number }) {
  if (owner === "borivon") return <Crown size={size} />;
  if (owner === "organization") return <Building2 size={size} />;
  return <User size={size} />;
}

export function JourneyChecklist({ candidateUserId }: { candidateUserId: string }) {
  const { lang } = useLang();
  const L = T[lang as keyof typeof T] ?? T.en;

  const [token, setToken] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [party, setParty] = useState<JourneyOwner | null>(null);
  const [canAdd, setCanAdd] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [allowedOwners, setAllowedOwners] = useState<JourneyOwner[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newText, setNewText] = useState("");
  const [newOwner, setNewOwner] = useState<JourneyOwner>("organization");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showDone, setShowDone] = useState(false); // collapse checked items

  const load = useCallback(async (tk: string) => {
    const res = await fetch(`/api/portal/journey?candidateId=${candidateUserId}`, {
      headers: { Authorization: `Bearer ${tk}` },
    }).catch(() => null);
    const j = res && res.ok ? await res.json().catch(() => ({})) : {};
    setItems((j.items ?? []) as Item[]);
    setParty((j.party ?? null) as JourneyOwner | null);
    setCanAdd(!!j.canAdd);
    setCanDelete(!!j.canDelete);
    const ao = (j.allowedOwners ?? []) as JourneyOwner[];
    setAllowedOwners(ao);
    if (ao.length) setNewOwner(ao.includes("organization") ? "organization" : ao[0]);
    setLoaded(true);
  }, [candidateUserId]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session?.access_token) return;
      setToken(session.access_token);
      void load(session.access_token);
    });
    return () => { cancelled = true; };
  }, [load]);

  // Realtime: refetch the instant this candidate's journey changes elsewhere
  // (admin assigns, candidate ticks in another tab, etc.).
  useEffect(() => {
    if (!token) return;
    return onJourneyChange(candidateUserId, () => void load(token));
  }, [candidateUserId, token, load]);

  async function toggleItem(it: Item) {
    if (!party || !canToggle(party, it.owner)) return;
    const next = !it.done;
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, done: next } : x));
    const res = await fetch("/api/portal/journey", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ candidateId: candidateUserId, id: it.id, done: next }),
    }).catch(() => null);
    if (!res || !res.ok) setItems(prev => prev.map(x => x.id === it.id ? { ...x, done: it.done } : x));
    else { const j = await res.json().catch(() => ({})); if (j.item) setItems(prev => prev.map(x => x.id === it.id ? (j.item as Item) : x)); emitJourneyChange(candidateUserId); }
  }

  async function addItem() {
    const text = newText.trim();
    if (!text || adding || !canAdd) return;
    setAdding(true);
    try {
      const res = await fetch("/api/portal/journey", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId: candidateUserId, text, owner: newOwner }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.item) { setItems(prev => [...prev, j.item as Item]); setNewText(""); inputRef.current?.focus(); emitJourneyChange(candidateUserId); }
    } finally { setAdding(false); }
  }

  // Managing parties (Borivon / org) set deadlines + block flags; candidate can't.
  const canManage = party === "borivon" || party === "organization";

  // Generic optimistic PATCH for the autopilot fields (due_date / blocked / reason).
  async function patchItem(it: Item, fields: Partial<Pick<Item, "due_date" | "blocked" | "blocked_reason">>) {
    if (!canManage) return;
    const prev = items;
    setItems(p => p.map(x => x.id === it.id ? { ...x, ...fields } : x));
    const res = await fetch("/api/portal/journey", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ candidateId: candidateUserId, id: it.id, ...fields }),
    }).catch(() => null);
    if (!res || !res.ok) { setItems(prev); return; }
    const j = await res.json().catch(() => ({}));
    if (j.item) setItems(p => p.map(x => x.id === it.id ? (j.item as Item) : x));
    emitJourneyChange(candidateUserId);
  }

  // Text edit is only permitted by the server for Borivon on CUSTOM items
  // (presets are re-labelled by key; org/candidate can't rename).
  const canEditText = (it: Item) => party === "borivon" && !it.preset_key;

  async function saveEdit(it: Item) {
    const text = editText.trim();
    setEditingId(null);
    if (!text || text === it.text || !canEditText(it)) return;
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, text } : x));
    const res = await fetch("/api/portal/journey", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ candidateId: candidateUserId, id: it.id, text }),
    }).catch(() => null);
    if (!res || !res.ok) setItems(prev => prev.map(x => x.id === it.id ? { ...x, text: it.text } : x));
    else emitJourneyChange(candidateUserId);
  }

  async function deleteItem(it: Item) {
    if (!canDelete || it.preset_key) return;
    setItems(prev => prev.filter(x => x.id !== it.id));
    const res = await fetch("/api/portal/journey", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ candidateId: candidateUserId, id: it.id }),
    }).catch(() => null);
    if (!res || !res.ok) setItems(prev => [...prev, it].sort((a, b) => a.position - b.position));
    else emitJourneyChange(candidateUserId);
  }

  const total = items.length;
  const done = items.filter(i => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const pending = items.filter(i => !i.done);
  const doneItems = items.filter(i => i.done);

  const renderItem = (it: Item) => {
    const togglable = !!party && canToggle(party, it.owner);
    const os = OWNER_STYLE[it.owner];
    const dd = daysToDue(it.due_date);
    const overdue = !it.done && dd !== null && dd < 0;
    const dueColor = it.done ? "var(--w3)" : overdue ? "#f97316" : (dd !== null && dd <= 7) ? "#f59e0b" : "var(--w3)";
    return (
      <div key={it.id} style={{ display: "flex", flexDirection: "column", gap: 7, padding: "9px 10px", borderRadius: 10,
        border: it.blocked && !it.done ? "1px solid rgba(239,68,68,0.5)" : "1px solid var(--border)",
        background: it.blocked && !it.done ? "rgba(239,68,68,0.06)" : "var(--card)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => void toggleItem(it)} disabled={!togglable} aria-label="toggle"
          style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 6, padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: togglable ? "pointer" : "default",
            border: it.done ? "none" : "2px solid var(--w3)",
            background: it.done ? "#16a34a" : "transparent",
            opacity: togglable ? 1 : 0.55 }}>
          {it.done && <Check size={13} strokeWidth={3.5} style={{ color: "#fff" }} />}
        </button>
        {editingId === it.id ? (
          <input autoFocus value={editText}
            onChange={e => setEditText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void saveEdit(it); } else if (e.key === "Escape") setEditingId(null); }}
            onBlur={() => void saveEdit(it)}
            style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13.5, padding: "2px 6px", borderRadius: 6, border: "1px solid var(--border-gold)", background: "var(--bg2)", color: "var(--w)" }} />
        ) : (
          <span
            onClick={canEditText(it) ? () => { setEditingId(it.id); setEditText(it.text); } : undefined}
            title={canEditText(it) ? "Click to edit" : undefined}
            style={{ flex: "1 1 auto", fontSize: 13.5, lineHeight: 1.35, wordBreak: "break-word",
              cursor: canEditText(it) ? "text" : "default",
              color: it.done ? "var(--w3)" : "var(--w)", textDecoration: it.done ? "line-through" : "none" }}>
            {journeyItemLabel(it, lang)}
          </span>
        )}
        {party !== "candidate" && (
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600,
            padding: "2px 7px", borderRadius: 999, background: os.bg, color: os.fg, border: `1px solid ${os.border}` }}>
            <OwnerIcon owner={it.owner} /> {L.owners[it.owner]}
          </span>
        )}
        {canDelete && !it.preset_key && (
          <button onClick={() => void deleteItem(it)} aria-label="delete"
            style={{ flexShrink: 0, background: "none", border: "none", color: "var(--w3)", cursor: "pointer", padding: 4, display: "flex" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--w3)")}>
            <Trash2 size={15} />
          </button>
        )}
      </div>

      {/* Autopilot controls — deadline + blocked. Managing parties only, open
          items only (a finished step needs no deadline). */}
      {canManage && !it.done && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingLeft: 30 }}>
          {/* Due date */}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: dueColor, cursor: "pointer" }}>
            <CalendarClock size={13} />
            <input type="date" value={it.due_date ?? ""}
              onChange={e => void patchItem(it, { due_date: e.target.value || null })}
              style={{ fontSize: 11.5, padding: "2px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg2)", color: dueColor, colorScheme: "dark" }} />
            {dd !== null && (
              <span style={{ fontWeight: 600 }}>
                {overdue ? L.overdueBy(-dd) : dd === 0 ? L.dueToday : L.inDays(dd)}
              </span>
            )}
          </label>
          {/* Blocked toggle */}
          <button onClick={() => void patchItem(it, { blocked: !it.blocked })}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
              padding: "3px 9px", borderRadius: 999,
              border: it.blocked ? "1px solid rgba(239,68,68,0.5)" : "1px solid var(--border)",
              background: it.blocked ? "rgba(239,68,68,0.13)" : "transparent",
              color: it.blocked ? "#ef4444" : "var(--w3)" }}>
            <AlertTriangle size={12} /> {it.blocked ? L.blocked : L.block}
          </button>
          {/* Blocked reason (only when blocked) */}
          {it.blocked && (
            <input defaultValue={it.blocked_reason ?? ""}
              onBlur={e => { const v = e.target.value.trim(); if (v !== (it.blocked_reason ?? "")) void patchItem(it, { blocked_reason: v }); }}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder={L.blockReason}
              style={{ flex: "1 1 140px", minWidth: 120, fontSize: 11.5, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)", background: "var(--bg2)", color: "var(--w)" }} />
          )}
        </div>
      )}
      </div>
    );
  };

  if (!loaded) return <div style={{ textAlign: "center", color: "var(--w3)", padding: "1.5rem 0" }}>…</div>;

  return (
    <div>
      {/* progress */}
      {total > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--w3)", marginBottom: 5 }}>
            <span>{done}/{total}</span>
            <span><strong style={{ color: "var(--w)" }}>{pct}%</strong> {L.complete}</span>
          </div>
          <div style={{ height: 7, borderRadius: 4, background: "var(--bg2)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#16a34a" : pct >= 50 ? "#f59e0b" : "var(--gold)", transition: "width .3s" }} />
          </div>
        </div>
      )}

      {/* add row */}
      {canAdd && (
        <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
          <input ref={inputRef} value={newText} onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addItem(); } }}
            placeholder={L.add}
            style={{ flex: 1, minWidth: 0, padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 13 }} />
          {allowedOwners.length > 1 && (
            <select value={newOwner} onChange={e => setNewOwner(e.target.value as JourneyOwner)}
              aria-label="owner"
              style={{ flexShrink: 0, padding: "0 8px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)", color: "var(--w)", fontSize: 12 }}>
              {allowedOwners.map(o => <option key={o} value={o}>{L.owners[o]}</option>)}
            </select>
          )}
          <button onClick={() => void addItem()} disabled={!newText.trim() || adding} aria-label={L.add}
            style={{ flexShrink: 0, width: 40, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9, border: "none",
              cursor: newText.trim() && !adding ? "pointer" : "default",
              background: newText.trim() && !adding ? "var(--gold)" : "var(--card)",
              color: newText.trim() && !adding ? "#131312" : "var(--w3)", opacity: adding ? 0.6 : 1 }}>
            <Plus size={18} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* items — pending shown; completed tuck behind a small toggle */}
      {total === 0 ? (
        <div style={{ textAlign: "center", color: "var(--w3)", padding: "1.5rem 0", fontSize: 13 }}>
          {party === "candidate" ? L.none : L.empty}
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pending.map(renderItem)}
            </div>
          )}
          {doneItems.length > 0 && (
            <div style={{ marginTop: pending.length ? 12 : 0 }}>
              <button onClick={() => setShowDone(s => !s)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--w3)", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, padding: "4px 2px" }}>
                <Check size={13} strokeWidth={3} style={{ color: "#16a34a" }} />
                {showDone ? L.hide : `${L.completed} (${doneItems.length})`}
              </button>
              {showDone && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {doneItems.map(renderItem)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
