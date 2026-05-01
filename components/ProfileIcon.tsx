"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { buildProfileSlug, ADMIN_PROFILE_SLUG } from "@/lib/profile-slug";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { OrgCodeModal } from "@/components/OrgCodeModal";
import { ProfilePopup } from "@/components/ProfilePopup";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";
import { PhotoCropModal } from "@/components/PhotoCropModal";
import { useLang } from "@/components/LangContext";

const t = {
  en: {
    organizations: "Organizations",
    manageAdmins: "Manage admins",
    myProfile: "My profile",
    joinOrganization: "Join organization",
    signOut: "Sign out",
    users: "Users",
    deleteAccountTitle: "Delete your account?",
    deleteAccountBody: "All your data will be permanently removed. Files are archived in Google Drive.\nThis cannot be undone.",
    typeToConfirm: "DELETE",
    typeToConfirmLabel: "Type",
    typeToConfirmSuffix: "to confirm",
    cancel: "Cancel",
    deleting: "Deleting…",
    deleteAccount: "Delete account",
    deleteFailedRetry: "Delete failed — please try again.",
    editPhoto: "Edit photo",
    changePhoto: "Change",
    uploadPhoto: "Add photo",
    deletePhoto: "Delete",
    savingPhoto: "Saving…",
    photoSaved: "Photo saved!",
    photoError: "Could not save photo.",
    adminOf: "Admin of",
  },
  fr: {
    organizations: "Organisations",
    manageAdmins: "Gérer les admins",
    myProfile: "Mon profil",
    joinOrganization: "Rejoindre une organisation",
    signOut: "Se déconnecter",
    users: "Utilisateurs",
    deleteAccountTitle: "Supprimer votre compte ?",
    deleteAccountBody: "Toutes vos données seront définitivement supprimées. Les fichiers sont archivés sur Google Drive.\nCela ne peut pas être annulé.",
    typeToConfirm: "SUPPRIMER",
    typeToConfirmLabel: "Tapez",
    typeToConfirmSuffix: "pour confirmer",
    cancel: "Annuler",
    deleting: "Suppression…",
    deleteAccount: "Supprimer le compte",
    deleteFailedRetry: "Suppression échouée — veuillez réessayer.",
    editPhoto: "Modifier la photo",
    changePhoto: "Changer",
    uploadPhoto: "Ajouter une photo",
    deletePhoto: "Supprimer",
    savingPhoto: "Enregistrement…",
    photoSaved: "Photo enregistrée !",
    photoError: "Impossible d'enregistrer la photo.",
    adminOf: "Admin de",
  },
  de: {
    organizations: "Organisationen",
    manageAdmins: "Admins verwalten",
    myProfile: "Mein Profil",
    joinOrganization: "Organisation beitreten",
    signOut: "Abmelden",
    users: "Benutzer",
    deleteAccountTitle: "Ihr Konto löschen?",
    deleteAccountBody: "Alle Ihre Daten werden dauerhaft gelöscht. Dateien werden in Google Drive archiviert.\nDies kann nicht rückgängig gemacht werden.",
    typeToConfirm: "LÖSCHEN",
    typeToConfirmLabel: "Geben Sie",
    typeToConfirmSuffix: "zur Bestätigung ein",
    cancel: "Abbrechen",
    deleting: "Wird gelöscht…",
    deleteAccount: "Konto löschen",
    deleteFailedRetry: "Löschen fehlgeschlagen — bitte erneut versuchen.",
    editPhoto: "Foto bearbeiten",
    changePhoto: "Ändern",
    uploadPhoto: "Foto hinzufügen",
    deletePhoto: "Löschen",
    savingPhoto: "Wird gespeichert…",
    photoSaved: "Foto gespeichert!",
    photoError: "Foto konnte nicht gespeichert werden.",
    adminOf: "Admin von",
  },
};

type UserInfo = {
  name: string;
  email: string;
  initials: string;
  isAdmin: boolean;
  /** True when the user is an org member (invited via org invite URL). Hides "Join organization". */
  isOrgMember: boolean;
  /** Slug for the candidate's public profile page (only set for non-admins). */
  profileSlug: string | null;
  /** Profile photo (data URL) — set when candidate has uploaded one in the CV builder. */
  photo: string | null;
  /** Whether this candidate has the blue verified tick (manually_verified or doc-based). */
  verified: boolean;
  /** True only for the supreme admin (role === "admin" && isSuperAdmin). */
  isSuperAdmin: boolean;
  /** Org name for org_member — shown as "Admin of X" in the profile modal. */
  orgName: string | null;
};

export function ProfileIcon() {
  const { lang } = useLang();
  const T = t[lang] ?? t.en;
  const [user, setUser] = useState<UserInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [accessToken, setAccessToken] = useState<string>("");
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [profilePopupSlug, setProfilePopupSlug] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [usersPanelOpen, setUsersPanelOpen] = useState(false);
  // Org-member profile photo modal
  const [orgProfileOpen, setOrgProfileOpen]     = useState(false);
  const [rawPhotoForCrop, setRawPhotoForCrop]   = useState<string | null>(null);
  const [photoSaving, setPhotoSaving]           = useState(false);
  const [photoSaveMsg, setPhotoSaveMsg]         = useState<"saved" | "error" | null>(null);
  const [photoMenuOpen, setPhotoMenuOpen]       = useState(false);
  const orgPhotoInputRef = useRef<HTMLInputElement>(null);
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
      let isOrgMember = false;
      let isSuperAdmin = false;
      let orgName: string | null = null;
      try {
        if (session?.access_token) {
          const res = await fetch("/api/portal/me/role", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const json = await res.json().catch(() => ({ role: null }));
          isAdmin      = json.role === "admin" || json.role === "sub_admin";
          isOrgMember  = json.role === "org_member";
          isSuperAdmin = json.isSuperAdmin === true;
          if (isOrgMember) orgName = json.orgName ?? null;
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
      // Admins always use the Borivon favicon as their permanent avatar.
      // Candidates use their CV-builder profile photo if uploaded.
      let photo: string | null = isAdmin ? "/favicon.png" : null;
      // Org members are always verified (invited and vetted via invite link).
      let verified = isAdmin || isOrgMember;
      if (!isAdmin && session?.access_token) {
        // Fetch photo and verification status in parallel
        const [photoRes, verifiedRes] = await Promise.allSettled([
          fetch("/api/portal/me/profile-photo", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
          fetch("/api/portal/me/verified", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }),
        ]);
        if (photoRes.status === "fulfilled" && photoRes.value.ok) {
          const j = await photoRes.value.json().catch(() => ({}));
          if (typeof j?.photo === "string") photo = j.photo;
        }
        if (verifiedRes.status === "fulfilled" && verifiedRes.value.ok) {
          const j = await verifiedRes.value.json().catch(() => ({}));
          if (j?.verified === true) verified = true;
        }
      }
      if (!cancelled) setUser({ name, email: u.email ?? "", initials, isAdmin, isOrgMember, isSuperAdmin, profileSlug, photo, verified, orgName });
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

  // Live verification updates — the dashboard dispatches this event when the
  // Supabase Realtime listener detects manually_verified changing to true.
  // This makes the blue tick appear in the navbar dropdown instantly.
  useEffect(() => {
    const onVerified = () => {
      setUser(prev => (prev ? { ...prev, verified: true } : prev));
    };
    window.addEventListener("bv-verified-changed", onVerified);
    return () => window.removeEventListener("bv-verified-changed", onVerified);
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
      if (!res.ok) { const { error } = await res.json().catch(() => ({})); alert(error ?? T.deleteFailedRetry); return; }
      // Clear local state then sign out
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i); if (k) localStorage.removeItem(k);
        }
      } catch { /* ignore */ }
      await supabase.auth.signOut();
      router.replace("/portal");
    } catch { alert(T.deleteFailedRetry); }
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
              {/* Avatar — candidates can click it to edit their photo */}
              {!user.isAdmin ? (
                <button
                  type="button"
                  onClick={() => { setOpen(false); setPhotoSaveMsg(null); setOrgProfileOpen(true); }}
                  className="relative w-11 h-11 rounded-full mx-auto mb-2.5 overflow-hidden group block cursor-pointer"
                  style={{ background: "none", border: "none", padding: 0 }}
                  title={T.editPhoto}
                >
                  {user.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.photo} alt={user.name}
                      className="w-full h-full object-cover rounded-full"
                      style={{ border: "1px solid var(--border-gold)" }} />
                  ) : (
                    <div className="w-full h-full rounded-full flex items-center justify-center text-[13px] font-semibold tracking-wider"
                      style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                      {user.initials}
                    </div>
                  )}
                  {/* Camera overlay on hover */}
                  <div className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.4)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </div>
                </button>
              ) : (
                user.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.photo} alt={user.name}
                    className="w-11 h-11 rounded-full object-cover mx-auto mb-2.5"
                    style={{ border: "1px solid var(--border-gold)" }} />
                ) : (
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-[13px] font-semibold tracking-wider mx-auto mb-2.5"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                    {user.initials}
                  </div>
                )
              )}
              <p className="text-[13px] font-semibold text-center truncate inline-flex items-center justify-center gap-0.5 w-full" style={{ color: "var(--w)" }}>
                {user.name}
                {user.verified && (
                  <VerifiedBadge verified size="xs" isAdmin={user.isAdmin}
                    color={user.isSuperAdmin ? "black" : user.isOrgMember ? "red" : "gold"} />
                )}
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
                    {T.organizations}
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
                    {T.manageAdmins}
                  </button>
                </>
              )}
              {user.profileSlug && !user.isOrgMember && (
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
                  {T.myProfile}
                </button>
              )}
              {/* Org members get a photo-editing "My Profile" (no public profile page) */}
              {user.isOrgMember && (
                <button
                  onClick={() => { setOpen(false); setPhotoSaveMsg(null); setOrgProfileOpen(true); }}
                  className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium flex items-center gap-2.5 transition-colors"
                  style={{ color: "var(--w2)", borderRadius: "var(--r-sm)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.color = "var(--w)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--w2)"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                  {T.myProfile}
                </button>
              )}
              {/* "Join organization" button removed — candidates are now linked
                  to organizations only by the supreme admin from the admin panel. */}
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
                {T.signOut}
              </button>
              {user.isAdmin && (
                <button
                  onClick={() => { setOpen(false); setUsersPanelOpen(true); }}
                  className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium flex items-center gap-2.5 transition-colors"
                  style={{ color: "var(--w2)", borderRadius: "var(--r-sm)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.color = "var(--w)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--w2)"; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  {T.users}
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

      {/* Admin users slide-over */}
      {usersPanelOpen && accessToken && (
        <AdminUsersPanel accessToken={accessToken} onClose={() => setUsersPanelOpen(false)} />
      )}

      {/* ── Org-member "My Profile" modal ───────────────────────────────────── */}
      {orgProfileOpen && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[1400]"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)" }}
            onClick={() => { if (!photoSaving) { setOrgProfileOpen(false); setPhotoMenuOpen(false); } }} />
          <div className="fixed inset-0 z-[1401] flex items-center justify-center p-4">
            <div className="w-full max-w-[340px] rounded-2xl overflow-hidden"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                boxShadow: "var(--shadow-lg)",
                animation: "bvFadeRise .22s var(--ease-out)",
              }}>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5"
                style={{ borderBottom: "1px solid var(--border)" }}>
                <p className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{T.myProfile}</p>
                <button onClick={() => { setOrgProfileOpen(false); setPhotoMenuOpen(false); }}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                  style={{ background: "transparent", border: "none", color: "var(--w3)", cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--bg2)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-col items-center px-6 pt-8 pb-7 gap-0">
                {/* Hidden file input */}
                <input ref={orgPhotoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    e.target.value = "";
                    setPhotoMenuOpen(false);
                    const reader = new FileReader();
                    reader.onload = ev => setRawPhotoForCrop(ev.target!.result as string);
                    reader.readAsDataURL(file);
                  }} />

                {/* Photo — clicking toggles the change/delete menu if photo exists, or opens picker if no photo */}
                <div className="relative mb-5" style={{ userSelect: "none" }}>
                  <button
                    type="button"
                    disabled={photoSaving}
                    onClick={() => {
                      if (user.photo) setPhotoMenuOpen(v => !v);
                      else orgPhotoInputRef.current?.click();
                    }}
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "block" }}>
                    <div className="w-[112px] h-[112px] rounded-full overflow-hidden flex items-center justify-center"
                      style={{ background: "var(--gdim)", border: "2.5px solid var(--border-gold)" }}>
                      {user.photo
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={user.photo} alt={user.name} className="w-full h-full object-cover" />
                        : <span className="text-[38px] font-bold select-none" style={{ color: "var(--gold)" }}>
                            {user.initials}
                          </span>
                      }
                    </div>
                    {/* "Add photo" overlay when no photo */}
                    {!user.photo && (
                      <div className="absolute inset-0 rounded-full flex flex-col items-center justify-center gap-1"
                        style={{ background: "rgba(0,0,0,0.32)" }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                          <circle cx="12" cy="13" r="4"/>
                        </svg>
                        <span className="text-[9.5px] font-semibold" style={{ color: "rgba(255,255,255,0.9)", letterSpacing: "0.04em" }}>{T.uploadPhoto}</span>
                      </div>
                    )}
                  </button>

                  {/* Change / Delete popup — appears on photo click */}
                  {photoMenuOpen && user.photo && (
                    <div className="absolute left-1/2 -translate-x-1/2 flex flex-col overflow-hidden z-10"
                      style={{
                        top: "calc(100% + 10px)",
                        background: "var(--bg2)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                        minWidth: "130px",
                        animation: "bvFadeRise .15s var(--ease-out)",
                      }}>
                      <button
                        type="button"
                        onClick={() => { setPhotoMenuOpen(false); orgPhotoInputRef.current?.click(); }}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-[12.5px] font-medium transition-colors"
                        style={{ color: "var(--w2)", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--bg)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                          <circle cx="12" cy="13" r="4"/>
                        </svg>
                        {T.changePhoto}
                      </button>
                      <div style={{ height: "1px", background: "var(--border)", margin: "0 10px" }} />
                      <button
                        type="button"
                        onClick={async () => {
                          setPhotoMenuOpen(false);
                          setPhotoSaving(true);
                          try {
                            const res = await fetch("/api/portal/me/profile-photo", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                              body: JSON.stringify({ photo: null }),
                            });
                            if (res.ok) {
                              setUser(prev => prev ? { ...prev, photo: null } : prev);
                              window.dispatchEvent(new CustomEvent("bv-profile-photo-changed", { detail: { photo: null } }));
                              setPhotoSaveMsg(null);
                            } else { setPhotoSaveMsg("error"); }
                          } catch { setPhotoSaveMsg("error"); }
                          setPhotoSaving(false);
                        }}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-[12.5px] font-medium transition-colors"
                        style={{ color: "#e05252", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(224,82,82,0.08)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                        {T.deletePhoto}
                      </button>
                    </div>
                  )}
                </div>

                {/* Name + verified + email */}
                <p className="text-[15.5px] font-semibold tracking-tight inline-flex items-center gap-1.5" style={{ color: "var(--w)" }}>
                  {user.name}
                  <VerifiedBadge verified size="xs" isAdmin={user.isSuperAdmin} color={user.isSuperAdmin ? "black" : "red"} />
                </p>
                <p className="text-[12px] mt-1" style={{ color: "var(--w3)" }}>{user.email}</p>

                {/* Org badge */}
                {user.orgName && (
                  <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full"
                    style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--gold)", flexShrink: 0 }}>
                      <path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>
                    </svg>
                    <span className="text-[11.5px] font-semibold" style={{ color: "var(--gold)" }}>
                      {T.adminOf} <span style={{ color: "var(--w)" }}>{user.orgName}</span>
                    </span>
                  </div>
                )}

                {photoSaving && (
                  <p className="mt-3 text-[11.5px]" style={{ color: "var(--w3)" }}>{T.savingPhoto}</p>
                )}
                {photoSaveMsg === "saved" && (
                  <p className="mt-3 text-[12px] font-medium" style={{ color: "var(--success)" }}>{T.photoSaved}</p>
                )}
                {photoSaveMsg === "error" && (
                  <p className="mt-3 text-[12px]" style={{ color: "var(--danger)" }}>{T.photoError}</p>
                )}
              </div>
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* PhotoCropModal — opens after org member picks a photo file */}
      {rawPhotoForCrop && (
        <PhotoCropModal
          src={rawPhotoForCrop}
          onCancel={() => setRawPhotoForCrop(null)}
          onSave={async (croppedUrl) => {
            setRawPhotoForCrop(null);
            setPhotoSaving(true);
            setPhotoSaveMsg(null);
            try {
              const res = await fetch("/api/portal/me/profile-photo", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
                body: JSON.stringify({ photo: croppedUrl }),
              });
              if (res.ok) {
                // Use the Storage URL returned by the API (not the local base64)
                const json = await res.json().catch(() => ({}));
                const savedUrl: string = json.photo ?? croppedUrl;
                setUser(prev => prev ? { ...prev, photo: savedUrl } : prev);
                window.dispatchEvent(new CustomEvent("bv-profile-photo-changed", { detail: { photo: savedUrl } }));
                setPhotoSaveMsg("saved");
              } else {
                setPhotoSaveMsg("error");
              }
            } catch {
              setPhotoSaveMsg("error");
            }
            setPhotoSaving(false);
          }}
        />
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
              <p className="text-[14px] font-semibold text-center mb-1" style={{ color: "var(--w)" }}>{T.deleteAccountTitle}</p>
              <p className="text-[12px] text-center mb-5" style={{ color: "var(--w3)" }}>
                {T.deleteAccountBody.split("\n").map((line, i) => (
                  i === 0 ? <span key={i}>{line}<br /></span> : <span key={i}>{line}</span>
                ))}
              </p>
              <p className="text-[11px] mb-2 font-medium" style={{ color: "var(--w3)" }}>
                {T.typeToConfirmLabel} <span className="font-bold" style={{ color: "var(--w)" }}>{T.typeToConfirm}</span> {T.typeToConfirmSuffix}
              </p>
              <input
                autoFocus
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && deleteInput === T.typeToConfirm) deleteAccount(); }}
                placeholder={T.typeToConfirm}
                className="w-full rounded-xl px-3 py-2 text-[13px] outline-none mb-4"
                style={{ background: "var(--bg2)", border: `1px solid ${deleteInput === T.typeToConfirm ? "#e05252" : "var(--border)"}`, color: "var(--w)" }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setDeleteConfirm(false); setDeleteInput(""); }}
                  disabled={deleting}
                  className="flex-1 py-2 rounded-xl text-[12px] font-medium"
                  style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                  {T.cancel}
                </button>
                <button
                  onClick={deleteAccount}
                  disabled={deleteInput !== T.typeToConfirm || deleting}
                  className="flex-1 py-2 rounded-xl text-[12px] font-semibold transition-opacity disabled:opacity-40"
                  style={{ background: "rgba(224,82,82,0.15)", color: "#e05252", border: "1px solid rgba(224,82,82,0.35)" }}>
                  {deleting ? T.deleting : T.deleteAccount}
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
