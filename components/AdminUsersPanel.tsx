"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type UserEntry = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "candidate";
  createdAt: string;
};

type Props = {
  accessToken: string;
  onClose: () => void;
};

export function AdminUsersPanel({ accessToken, onClose }: Props) {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserEntry | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    fetch("/api/portal/admin/users", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => r.json())
      .then(j => { setUsers(j.users ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accessToken]);

  const filtered = users.filter(u => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  async function deleteUser() {
    if (!deleteTarget || deleteInput !== "DELETE") return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/portal/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: deleteTarget.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setDeleteError(j.error ?? "Delete failed");
        return;
      }
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteInput("");
    } catch {
      setDeleteError("Delete failed — please try again.");
    } finally {
      setDeleting(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[1300]"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
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
            Users {!loading && <span style={{ color: "var(--w3)", fontWeight: 400 }}>({users.length})</span>}
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
              placeholder="Search name or email…"
              className="w-full rounded-xl pl-8 pr-3 py-2 text-[12.5px] outline-none"
              style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}
            />
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[12.5px]" style={{ color: "var(--w3)" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-[12.5px]" style={{ color: "var(--w3)" }}>No users found</div>
          ) : (
            filtered.map(u => (
              <div
                key={u.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0"
                  style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}
                >
                  {(u.name || u.email).charAt(0).toUpperCase()}
                </div>

                {/* Name + email */}
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium truncate" style={{ color: "var(--w)" }}>
                    {u.name || <span style={{ color: "var(--w3)" }}>(no name)</span>}
                  </p>
                  <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--w3)" }}>{u.email}</p>
                </div>

                {/* Role badge */}
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{
                    background: u.role === "admin" ? "rgba(201,162,64,0.12)" : "var(--bg2)",
                    color: u.role === "admin" ? "#c9a240" : "var(--w3)",
                    border: `1px solid ${u.role === "admin" ? "rgba(201,162,64,0.25)" : "var(--border)"}`,
                  }}
                >
                  {u.role === "admin" ? "Admin" : "Candidate"}
                </span>

                {/* Delete button */}
                <button
                  onClick={() => { setDeleteTarget(u); setDeleteInput(""); setDeleteError(""); }}
                  className="w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 transition-colors"
                  style={{ color: "var(--w3)" }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,59,48,0.1)";
                    (e.currentTarget as HTMLElement).style.color = "#ff3b30";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--w3)";
                  }}
                  aria-label={`Delete ${u.name || u.email}`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <>
          <div
            className="fixed inset-0 z-[1402]"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => !deleting && (setDeleteTarget(null), setDeleteInput(""))}
          />
          <div className="fixed inset-0 z-[1403] flex items-center justify-center p-4">
            <div
              className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
              style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }}
            >
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="w-11 h-11 rounded-full flex items-center justify-center mb-1" style={{ background: "rgba(255,59,48,0.1)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </div>
                <p className="text-[14px] font-semibold" style={{ color: "var(--w)" }}>
                  Delete {deleteTarget.name || deleteTarget.email}?
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--w3)" }}>
                  All data is permanently removed. Drive files are archived in &ldquo;Deleted Data&rdquo;. This cannot be undone.
                </p>
                {deleteError && (
                  <p className="text-[11.5px] font-medium" style={{ color: "#ff3b30" }}>{deleteError}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-[11.5px] text-center" style={{ color: "var(--w3)" }}>
                  Type <strong style={{ color: "var(--w)" }}>DELETE</strong> to confirm
                </p>
                <input
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && deleteInput === "DELETE") deleteUser(); }}
                  placeholder="DELETE"
                  autoFocus
                  className="w-full text-center rounded-xl px-3 py-2.5 text-[13px] outline-none"
                  style={{
                    background: "var(--bg2)",
                    border: `1px solid ${deleteInput === "DELETE" ? "rgba(255,59,48,0.5)" : "var(--border)"}`,
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
                  Cancel
                </button>
                <button
                  onClick={deleteUser}
                  disabled={deleteInput !== "DELETE" || deleting}
                  className="flex-1 rounded-xl py-2.5 text-[13px] font-semibold"
                  style={{
                    background: deleteInput === "DELETE" && !deleting ? "#ff3b30" : "rgba(255,59,48,0.25)",
                    color: "#fff",
                    cursor: deleteInput !== "DELETE" || deleting ? "not-allowed" : "pointer",
                  }}
                >
                  {deleting ? "Deleting…" : "Delete"}
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
