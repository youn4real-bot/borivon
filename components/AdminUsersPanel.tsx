"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { VerifiedBadge } from "@/components/VerifiedBadge";

type UserEntry = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "candidate";
  createdAt: string;
  photo: string | null;
  verified: boolean;
};

type Props = {
  accessToken: string;
  onClose: () => void;
};

const t = {
  en: {
    users: "Users",
    searchPlaceholder: "Search name or email…",
    loading: "Loading…",
    noUsers: "No users found",
    noName: "(no name)",
    roleAdmin: "Admin",
    roleCandidate: "Candidate",
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody: `All data is permanently removed. Drive files are archived in “Deleted Data”. This cannot be undone.`,
    typeToConfirm: "DELETE",
    typeToConfirmLabel: "Type",
    typeToConfirmSuffix: "to confirm",
    cancel: "Cancel",
    deleting: "Deleting…",
    delete: "Delete",
    deleteFailed: "Delete failed",
    deleteFailedRetry: "Delete failed — please try again.",
  },
  fr: {
    users: "Utilisateurs",
    searchPlaceholder: "Rechercher nom ou e-mail…",
    loading: "Chargement…",
    noUsers: "Aucun utilisateur trouvé",
    noName: "(sans nom)",
    roleAdmin: "Admin",
    roleCandidate: "Candidat",
    deleteTitle: (name: string) => `Supprimer ${name} ?`,
    deleteBody: `Toutes les données sont définitivement supprimées. Les fichiers Drive sont archivés dans « Données supprimées ». Cela ne peut pas être annulé.`,
    typeToConfirm: "SUPPRIMER",
    typeToConfirmLabel: "Tapez",
    typeToConfirmSuffix: "pour confirmer",
    cancel: "Annuler",
    deleting: "Suppression…",
    delete: "Supprimer",
    deleteFailed: "Suppression échouée",
    deleteFailedRetry: "Suppression échouée — veuillez réessayer.",
  },
  de: {
    users: "Benutzer",
    searchPlaceholder: "Name oder E-Mail suchen…",
    loading: "Wird geladen…",
    noUsers: "Keine Benutzer gefunden",
    noName: "(kein Name)",
    roleAdmin: "Admin",
    roleCandidate: "Kandidat",
    deleteTitle: (name: string) => `${name} löschen?`,
    deleteBody: `Alle Daten werden dauerhaft gelöscht. Drive-Dateien werden in „Gelöschte Daten“ archiviert. Dies kann nicht rückgängig gemacht werden.`,
    typeToConfirm: "LÖSCHEN",
    typeToConfirmLabel: "Geben Sie",
    typeToConfirmSuffix: "zur Bestätigung ein",
    cancel: "Abbrechen",
    deleting: "Wird gelöscht…",
    delete: "Löschen",
    deleteFailed: "Löschen fehlgeschlagen",
    deleteFailedRetry: "Löschen fehlgeschlagen — bitte erneut versuchen.",
  },
};

export function AdminUsersPanel({ accessToken, onClose }: Props) {
  const { lang, t: gT } = useLang();
  const T = t[lang] ?? t.en;
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserEntry | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [myId, setMyId] = useState("");

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    // Get current user's ID so we can hide the delete button on their own row
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled && user) setMyId(user.id);
    });
    fetch("/api/portal/admin/users", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(j => { if (!cancelled) { setUsers(j.users ?? []); setLoading(false); } })
      .catch((err) => {
        if (cancelled || err?.name === "AbortError") return;
        setLoading(false);
      });
    return () => { cancelled = true; ctrl.abort(); };
  }, [accessToken]);

  const filtered = users.filter(u => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  async function deleteUser() {
    if (deleting) return; // double-submit guard
    if (!deleteTarget || deleteInput !== "DELETE") return;
    setDeleting(true);
    setDeleteError("");
    try {
      const { data: { user: me } } = await supabase.auth.getUser();
      const isSelf = me?.id === deleteTarget.id;

      const res = await fetch("/api/portal/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: deleteTarget.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setDeleteError(j.error ?? T.deleteFailed);
        return;
      }

      if (isSelf) {
        // Auth user is gone — clear storage and redirect to login
        try {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i); if (k) localStorage.removeItem(k);
          }
        } catch { /* ignore */ }
        await supabase.auth.signOut();
        window.location.replace("/portal");
        return;
      }

      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteInput("");
    } catch {
      setDeleteError(T.deleteFailedRetry);
    } finally {
      setDeleting(false);
    }
  }

  // Esc: close delete-confirm if open, else close the slide-over panel.
  // Guarded on `deleting` so a stray Esc can't dismiss mid-delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || deleting) return;
      if (deleteTarget) {
        setDeleteTarget(null);
        setDeleteInput("");
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleting, deleteTarget, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Backdrop — locked while a delete is in flight so the user can't
          dismiss the panel mid-operation and end up in inconsistent UI. */}
      <div
        className="fixed inset-0 z-[1300]"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
        onClick={() => { if (!deleting) onClose(); }}
      />

      {/* Slide-over panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-[1301] flex flex-col"
        style={{
          width: "min(420px, 100vw)",
          background: "var(--card)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.22)",
          animation: "bvSlideInRight 0.26s var(--ease-out)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--w3)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <p className="text-[14px] font-semibold flex-1" style={{ color: "var(--w)" }}>
            {T.users} {!loading && <span style={{ color: "var(--w3)", fontWeight: 400 }}>({users.length})</span>}
          </p>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "var(--bg2)", color: "var(--w3)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg3 , var(--border))"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--bg2)"; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--w3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={T.searchPlaceholder}
              aria-label={T.searchPlaceholder}
              type="search"
              className="w-full rounded-xl pl-8 pr-3 py-2 text-[12.5px] outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}
            />
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[12.5px]" style={{ color: "var(--w3)" }}>{T.loading}</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-[12.5px]" style={{ color: "var(--w3)" }}>{T.noUsers}</div>
          ) : (
            filtered.map(u => (
              <div
                key={u.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {u.photo ? (
                    <img src={u.photo} alt={u.name || u.email}
                      className="w-9 h-9 rounded-full object-cover"
                      style={{ border: "1px solid var(--border)" }} />
                  ) : (
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold"
                      style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                      {(u.name || u.email).charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Name + email */}
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium flex items-center gap-1" style={{ color: "var(--w)" }}>
                    <span className="truncate">{u.name || <span style={{ color: "var(--w3)" }}>{T.noName}</span>}</span>
                    {u.verified && <VerifiedBadge verified size="xs" color="gold" />}
                  </p>
                  <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--w3)" }}>{u.email}</p>
                </div>

                {/* Role badge */}
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{
                    background: u.role === "admin" ? "var(--gdim)" : "var(--bg2)",
                    color: u.role === "admin" ? "var(--gold)" : "var(--w3)",
                    border: `1px solid ${u.role === "admin" ? "var(--border-gold)" : "var(--border)"}`,
                  }}
                >
                  {u.role === "admin" ? T.roleAdmin : T.roleCandidate}
                </span>

                {/* Delete button — hidden for own account */}
                {u.id !== myId && (
                  <button
                    onClick={() => { setDeleteTarget(u); setDeleteInput(""); setDeleteError(""); }}
                    className="w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 transition-colors"
                    style={{ color: "var(--w3)" }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = "var(--danger-bg)";
                      (e.currentTarget as HTMLElement).style.color = "var(--danger)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "var(--w3)";
                    }}
                    aria-label={gT.delUserAria.replace("{name}", u.name || u.email)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <>
          <div
            className="fixed inset-0 z-[9999]"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => !deleting && (setDeleteTarget(null), setDeleteInput(""))}
          />
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
            <div
              className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
              style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }}
            >
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="w-11 h-11 rounded-full flex items-center justify-center mb-1" style={{ background: "var(--danger-bg)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </div>
                <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>
                  {T.deleteTitle(deleteTarget.name || deleteTarget.email)}
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--w3)" }}>
                  {T.deleteBody}
                </p>
                {deleteError && (
                  <p className="text-[11.5px] font-medium" style={{ color: "var(--danger)" }}>{deleteError}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="bv-delete-confirm-input" className="text-[11.5px] text-center" style={{ color: "var(--w3)" }}>
                  {T.typeToConfirmLabel} <strong style={{ color: "var(--w)" }}>{T.typeToConfirm}</strong> {T.typeToConfirmSuffix}
                </label>
                <input
                  id="bv-delete-confirm-input"
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && deleteInput === T.typeToConfirm) deleteUser(); }}
                  placeholder={T.typeToConfirm}
                  aria-label={`${T.typeToConfirmLabel} ${T.typeToConfirm} ${T.typeToConfirmSuffix}`}
                  autoFocus
                  autoComplete="off"
                  className="w-full text-center rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{
                    background: "var(--bg2)",
                    border: `1px solid ${deleteInput === T.typeToConfirm ? "var(--danger-border)" : "var(--border)"}`,
                    color: "var(--w)",
                  }}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => { if (!deleting) { setDeleteTarget(null); setDeleteInput(""); } }}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-medium transition-opacity hover:opacity-70"
                  style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}
                >
                  {T.cancel}
                </button>
                <button
                  onClick={deleteUser}
                  disabled={deleteInput !== T.typeToConfirm || deleting}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-semibold"
                  style={{
                    background: deleteInput === T.typeToConfirm && !deleting ? "var(--danger)" : "var(--danger-bg)",
                    color: "#fff",
                    cursor: deleteInput !== T.typeToConfirm || deleting ? "not-allowed" : "pointer",
                  }}
                >
                  {deleting ? T.deleting : T.delete}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>,
    document.body,
  );
}
