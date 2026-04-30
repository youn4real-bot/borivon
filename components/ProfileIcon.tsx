"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { buildProfileSlug, ADMIN_PROFILE_SLUG } from "@/lib/profile-slug";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { OrgCodeModal } from "@/components/OrgCodeModal";
import { ProfilePopup } from "@/components/ProfilePopup";

type UserInfo = {
  name: string;
  email: string;
  initials: string;
  isAdmin: boolean;
  /** Slug for the candidate's public profile page (only set for non-admins). */
  profileSlug: string | null;
  /** Profile photo (data URL) — set when candidate has uploaded one in the CV builder. */
  photo: string | null;
};

export function ProfileIcon() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [accessToken, setAccessToken] = useState<string>("");
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [profilePopupSlug, setProfilePopupSlug] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const apply = async (session: { user: { id?: string; email?: string; user_metadata?: { full_name?: string; first_name?: string; last_name?: string } } | null; access_token?: string } | null) => {
      const u = session?.user ?? null;
      if (!u) { if (!cancelled) { setUser(null); setOpen(false); setAccessToken(""); } return; }
      if (!cancelled) setAccessToken(session?.access_token ?? "");
      const name = u.user_metadata?.full_name ?? u.email ?? "";
      const parts = name.trim().split(/\s+/);
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase();
      // Ask the server for our role; never rely on a NEXT_PUBLIC_ admin email
      // (that would leak the admin's identity into the public bundle).
      let isAdmin = false;
      try {
        if (session?.access_token) {
          const res = await fetch("/api/portal/me/role", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const { role } = await res.json().catch(() => ({ role: null }));
          isAdmin = role === "admin";
        }
      } catch { /* offline — treat as non-admin */ }
      // Build the public profile slug for non-admin candidates so the
      // dropdown can link straight to /p/<slug>. We only use the dedicated
      // first_name metadata (NOT email-derived fallbacks) to keep slug
      // parity with the dashboard — both call sites must produce the same
      // slug for the same user, otherwise the link 404s.
      let profileSlug: string | null = null;
      if (isAdmin) {
        profileSlug = ADMIN_PROFILE_SLUG;
      } else {
        const metaFirst = u.user_metadata?.first_name;
        if (u.id && metaFirst) {
          const ln = u.user_metadata?.last_name ?? "";
          profileSlug = buildProfileSlug(metaFirst, ln, u.id);
        }
      }
      // Fetch the candidate's profile photo (set when they upload one in
      // the CV builder). Admins don't have one — skip the call for them.
      let photo: string | null = null;
      if (!isAdmin && session?.access_token) {
        try {
          const res = await fetch("/api/portal/me/profile-photo", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const j = await res.json().catch(() => ({}));
          if (typeof j?.photo === "string") photo = j.photo;
        } catch { /* offline — show initials */ }
      }
      if (!cancelled) setUser({ name, email: u.email ?? "", initials, isAdmin, profileSlug, photo });
    };
    supabase.auth.getSession().then(({ data: { session } }) => apply(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  // Live photo updates — the CV builder dispatches this event after a photo
  // upload OR removal, so the navbar avatar swaps in the new image (or reverts
  // to initials) without waiting for a page reload or doc approval.
  useEffect(() => {
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<{ photo: string | null }>;
      const photo = ce.detail?.photo ?? null;
      setUser(prev => (prev ? { ...prev, photo } : prev));
    };
    window.addEventListener("bv-profile-photo-changed", onChange);
    return () => window.removeEventListener("bv-profile-photo-changed", onChange);
  }, []);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (window.matchMedia("(max-width: 639.98px)").matches) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, []);

  async function signOut() {
    // Wipe per-user localStorage drafts so the next user on a shared device
    // doesn't see (or, after re-login, accidentally restore) stale data.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("bv-cv-draft-") || k.startsWith("bv-passport-pending-") || k.startsWith("bv-passport-modal-")) {
          localStorage.removeItem(k);
        }
      }
    } catch { /* private mode — ignore */ }
    await supabase.auth.signOut();
    router.replace("/portal");
  }

  async function deleteAccount() {
    if (!accessToken) return;
    setDeleting(true);
    try {
      const { data: { user: me } } = await supabase.auth.getUser();
      if (!me) return;
      const res = await fetch("/api/portal/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: me.id }),
      });
      if (!res.ok) { const { error } = await res.json().catch(() => ({})); alert(error ?? "Delete failed"); return; }
      // Clear local state then sign out
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i); if (k) localStorage.removeItem(k);
        }
      } catch { /* ignore */ }
      await supabase.auth.signOut();
      router.replace("/portal");
    } catch { alert("Delete failed — please try again."); }
    finally { setDeleting(false); setDeleteConfirm(false); setDeleteInput(""); }
  }

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile"
        className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold tracking-wider cursor-pointer hover:scale-110 active:scale-95 transition-transform flex-shrink-0 overflow-hidden"
        style={{
          background: user.photo ? "transparent" : (open ? "var(--gold)" : "var(--gdim)"),
          color: open ? "#131312" : "var(--gold)",
          border: "none",
        }}
      >
        {user.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.photo} alt={user.name} className="w-full h-full object-cover" />
        ) : user.initials}
      </button>

      {open && (() => {
        const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 639.98px)").matches;

        const menuContent = (
          <>
            {/* User info */}
            <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
              {user.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.photo} alt={user.name}
                  className="w-11 h-11 rounded-full object-cover mx-auto mb-2.5"
                  style={{ border: "1px solid var(--border-gold)" }} />
              ) : (
                <div className="w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-semibold tracking-wider mx-auto mb-2.5"
                  style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                  {user.initials}
                </div>
              )}
              <p className="text-[13px] font-semibold text-center truncate inline-flex items-center justify-center gap-0.5 w-full" style={{ color: "var(--w)" }}>
                {user.name}
                {user.isAdmin && <VerifiedBadge verified size="xs" isAdmin />}
              </p>
              <p className="text-[11px] text-center truncate mt-0.5" style={{ color: "var(--w3)" }}>{user.email}</p>
            </div>
            {/* Actions */}
            <div className="p-1.5 flex flex-col gap-0.5">
              {user.isAdmin && (
                <>
                  <button
                    onClick={() => { setOpen(false); router.push("/portal/admin/organizations"); }}
                    className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium flex items-center gap-2.5 transition-colors"
                    style={{ color: "var(--w2)", borderRadius: "var(--r-sm)" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.color = "var(--w)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--w2)"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
                      <path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/>
                    </svg>
                    Organizations
                  </button>
                  <button
                    onClick={() => { setOpen(false); router.push("/portal/admin/manage"); }}
                    className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium flex items-center gap-2.5 transition-colors"
                    style={{ color: "var(--w2)", borderRadius: "var(--r-sm)" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.color = "var(--w)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--w2)"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    Manage admins
                  </button>
                </>
              )}
              {user.profileSlug && (
                <button
                  onClick={() => { setOpen(false); setProfilePopupSlug(user.profileSlug); }}
                  className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium flex items-center gap-2.5 transition-colors"
                  style={{ color: "var(--w2)", borderRadius: "var(--r-sm)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.color = "var(--w)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--w2)"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  My profile
                </button>
              )}
              {/* Candidates can re-open the invite-code modal at any time —
                  useful if they hit "Later" the first time, or want to add a
                  second organization later. Hidden for the admin. */}
              {!user.isAdmin && (
                <button
                  onClick={() => { setOpen(false); setOrgModalOpen(true); }}
                  className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium flex items-center gap-2.5 transition-colors"
                  style={{ color: "var(--w2)", borderRadius: "var(--r-sm)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.color = "var(--w)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--w2)"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
                    <path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/>
                  </svg>
                  Join organization
                </button>
              )}
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium flex items-center gap-2.5 transition-colors"
                style={{ color: "#e05252", borderRadius: "var(--r-sm)" }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(224,82,82,0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sign out
              </button>
              {user.isAdmin && (
                <button
                  onClick={() => { setOpen(false); setDeleteInput(""); setDeleteConfirm(true); }}
                  className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium flex items-center gap-2.5 transition-colors"
                  style={{ color: "var(--w3)", borderRadius: "var(--r-sm)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(224,82,82,0.06)"; e.currentTarget.style.color = "#e05252"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--w3)"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                  Delete my account
                </button>
              )}
            </div>
          </>
        );

        if (isMobile && typeof document !== "undefined") {
          return createPortal(
            <>
              <div className="fixed inset-0" style={{ zIndex: 1299, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} onClick={() => setOpen(false)} />
              <div className="fixed bottom-0 left-0 right-0 rounded-t-[22px] overflow-hidden"
                style={{ zIndex: 1300, background: "var(--card)", border: "1px solid var(--border)", borderBottom: "none", boxShadow: "0 -12px 40px rgba(0,0,0,0.32)", animation: "bvSlideUp 0.28s var(--ease-out)", paddingBottom: "env(safe-area-inset-bottom)" }}>
                <div className="flex justify-center pt-3 pb-1 cursor-pointer" onClick={() => setOpen(false)}>
                  <div className="w-9 h-1 rounded-full" style={{ background: "var(--border2)" }} />
                </div>
                {menuContent}
              </div>
            </>,
            document.body,
          );
        }

        return (
          <div
            className="absolute right-0 w-[240px] overflow-hidden z-[600]"
            style={{
              top: "calc(100% + 10px)",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-lg)",
              boxShadow: "var(--shadow-md)",
              animation: "slideDown 0.18s var(--ease-out)",
            }}
          >
            {menuContent}
          </div>
        );
      })()}

      {/* Org-code modal — triggered from "Join organization" in the dropdown.
          Mounted here (not in dashboard) so candidates can open it from any
          portal page. */}
      {orgModalOpen && accessToken && (
        <OrgCodeModal
          accessToken={accessToken}
          onJoined={() => setOrgModalOpen(false)}
          onSkip={() => setOrgModalOpen(false)}
        />
      )}

      {/* In-app profile popup — replaces the old "open public page in new tab"
          flow. Stays inside the website, no navigation, works on phone + laptop. */}
      {profilePopupSlug && (
        <ProfilePopup slug={profilePopupSlug} onClose={() => setProfilePopupSlug(null)} />
      )}

      {/* Delete account confirmation modal */}
      {deleteConfirm && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[1400]" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
            onClick={() => { if (!deleting) { setDeleteConfirm(false); setDeleteInput(""); } }} />
          <div className="fixed inset-0 z-[1401] flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "rgba(224,82,82,0.12)", border: "1px solid rgba(224,82,82,0.3)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e05252" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </div>
              <p className="text-[14px] font-semibold text-center mb-1" style={{ color: "var(--w)" }}>Delete your account?</p>
              <p className="text-[12px] text-center mb-5" style={{ color: "var(--w3)" }}>
                All your data will be permanently removed. Files are archived in Google Drive.<br />
                This cannot be undone.
              </p>
              <p className="text-[11px] mb-2 font-medium" style={{ color: "var(--w3)" }}>
                Type <span className="font-bold" style={{ color: "var(--w)" }}>DELETE</span> to confirm
              </p>
              <input
                autoFocus
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && deleteInput === "DELETE") deleteAccount(); }}
                placeholder="DELETE"
                className="w-full rounded-xl px-3 py-2 text-[13px] outline-none mb-4"
                style={{ background: "var(--bg2)", border: `1px solid ${deleteInput === "DELETE" ? "#e05252" : "var(--border)"}`, color: "var(--w)" }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setDeleteConfirm(false); setDeleteInput(""); }}
                  disabled={deleting}
                  className="flex-1 py-2 rounded-xl text-[12px] font-medium"
                  style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                  Cancel
                </button>
                <button
                  onClick={deleteAccount}
                  disabled={deleteInput !== "DELETE" || deleting}
                  className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-opacity disabled:opacity-40"
                  style={{ background: "rgba(224,82,82,0.15)", color: "#e05252", border: "1px solid rgba(224,82,82,0.35)" }}>
                  {deleting ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
