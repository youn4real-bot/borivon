"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Bell, Paperclip, CheckCircle2, XCircle, User } from "@/components/PortalIcons";
import { X as XIcon } from "lucide-react";
import { Spinner } from "@/components/ui/states";
// ── Types ─────────────────────────────────────────────────────────────────────

type CandidateNotif = {
  id: string;
  doc_id: string | null;
  doc_name: string;
  doc_type: string;
  action: "approved" | "rejected";
  feedback: string | null;
  read: boolean;
  created_at: string;
};

type AdminNotif = {
  id: string;
  type: "signup" | "upload";
  user_name: string;
  user_email: string;
  doc_type: string | null;
  doc_name: string | null;
  read: boolean;
  created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = diff / 3_600_000;
  const d = diff / 86_400_000;
  if (h < 1)  return "Just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  if (d < 7)  return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

// ── Bell button ───────────────────────────────────────────────────────────────

function BellButton({ unread, open, onClick }: { unread: number; open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Notifications"
      className="relative flex items-center justify-center w-9 h-9 cursor-pointer hover:scale-110 active:scale-95 transition-transform"
      style={{
        background: "transparent",
        border: "none",
        color: unread > 0 || open ? "var(--gold)" : "var(--w3)",
        transition: "color 0.2s, transform 0.15s",
      }}
      onMouseEnter={(e) => { if (!open && unread === 0) e.currentTarget.style.color = "var(--w)"; }}
      onMouseLeave={(e) => { if (!open && unread === 0) e.currentTarget.style.color = "var(--w3)"; }}
    >
      <Bell size={18} strokeWidth={1.7} />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-[9px] font-bold"
          style={{ minWidth: 15, height: 15, paddingInline: 3, background: "var(--gold)", color: "#131312", lineHeight: 1 }}>
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}

function EmptyState({ msg }: { msg?: string }) {
  return (
    <div className="py-12 text-center">
      <span className="mx-auto mb-3 flex items-center justify-center w-11 h-11 rounded-full"
        style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", color: "var(--gold)" }}>
        <Bell size={20} strokeWidth={1.6} />
      </span>
      <p className="text-xs font-medium" style={{ color: "var(--w2)" }}>{msg ?? "No notifications yet"}</p>
      <p className="text-[11px] mt-1" style={{ color: "var(--w3)" }}>You&apos;ll be notified of any activity here</p>
    </div>
  );
}

// ── Dropdown shell with All/Unread tabs ───────────────────────────────────────

function NotifDropdown({ label, total, unread, tab, onTabChange, onClose, children }: {
  label: string; total: number; unread: number;
  tab: "all" | "unread"; onTabChange: (t: "all" | "unread") => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 639.98px)").matches;

  const header = (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold" style={{ color: "var(--w)" }}>{label}</p>
        {unread === 0 && total > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: "var(--w3)" }}>
            <CheckCircle2 size={10} strokeWidth={1.8} /> All caught up
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        {(["all", "unread"] as const).map(t => (
          <button key={t} onClick={() => onTabChange(t)}
            className="px-3.5 py-1 rounded-full text-[11px] font-semibold transition-all"
            style={{
              background: tab === t ? "var(--gold)" : "var(--bg2)",
              color:      tab === t ? "#1a1a1a"    : "var(--w3)",
              border:     tab === t ? "none"        : "1px solid var(--border)",
            }}>
            {t === "all" ? `All${total ? ` (${total})` : ""}` : `Unread${unread ? ` (${unread})` : ""}`}
          </button>
        ))}
      </div>
    </>
  );

  if (isMobile && typeof document !== "undefined") {
    return createPortal(
      <>
        <div className="fixed inset-0" style={{ zIndex: 1299, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} onClick={onClose} />
        <div className="fixed bottom-0 left-0 right-0 flex flex-col rounded-t-[22px]"
          style={{ zIndex: 1300, background: "var(--card)", border: "1px solid var(--border)", borderBottom: "none", boxShadow: "0 -12px 40px rgba(0,0,0,0.32)", animation: "bvSlideUp 0.28s var(--ease-out)", maxHeight: "80dvh", overflow: "hidden" }}>
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-pointer" onClick={onClose}>
            <div className="w-9 h-1 rounded-full" style={{ background: "var(--border2)" }} />
          </div>
          <div className="px-4 pt-3 pb-0 flex-shrink-0">{header}</div>
          <div style={{ height: 1, background: "var(--border)", marginTop: 12 }} />
          <div className="overflow-y-auto flex-1" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {children}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  return (
    <div className="absolute right-0 w-[320px] rounded-2xl overflow-hidden z-[600]"
      style={{ top: "calc(100% + 8px)", background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.28)" }}>
      <div className="px-4 pt-4 pb-0">{header}</div>
      <div style={{ height: 1, background: "var(--border)", marginTop: 12 }} />
      <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
        {children}
      </div>
    </div>
  );
}


// ── Candidate bell ────────────────────────────────────────────────────────────

function CandidateBell({ userId, accessToken }: { userId: string; accessToken: string }) {
  const [notifs, setNotifs] = useState<CandidateNotif[]>([]);
  const [open, setOpen]     = useState(false);
  const [tab, setTab]       = useState<"all" | "unread">("all");
  const ref    = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetch_ = useCallback(async () => {
    const { data } = await supabase
      .from("notifications")
      .select("id, doc_id, doc_name, doc_type, action, feedback, read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    setNotifs(data ?? []);
  }, [userId]);

  useEffect(() => {
    fetch_();
    const ch = supabase
      .channel(`notifs-${userId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (p) => setNotifs(prev => [p.new as CandidateNotif, ...prev])
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, fetch_]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (window.matchMedia("(max-width: 639.98px)").matches) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key  = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, []);

  async function markAllRead() {
    const prev = notifs;
    setNotifs(p => p.map(n => ({ ...n, read: true })));
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    // Rollback optimistic update if the DB write failed
    if (error) setNotifs(prev);
  }

  const unread    = notifs.filter(n => !n.read).length;
  const displayed = tab === "unread" ? notifs.filter(n => !n.read) : notifs;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead();
  }

  async function handleClick(n: CandidateNotif) {
    setOpen(false);

    let docId = n.doc_id ?? null;

    if (!docId) {
      try {
        const res = await fetch(`/api/portal/notifications/${encodeURIComponent(n.id)}/doc`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const { doc } = await res.json();
          if (doc?.id) docId = doc.id;
        }
      } catch (e) {
        console.error("[notif click] doc lookup failed:", e);
      }
    }

    router.push(`/portal/dashboard${docId ? `?nav_doc_id=${encodeURIComponent(docId)}` : ""}`);
    if (docId) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("bv-nav-doc", { detail: { docId } }));
      }, 30);
    }
  }

  return (
    <div ref={ref} className="relative">
      <BellButton unread={unread} open={open} onClick={toggle} />
      {open && (
        <NotifDropdown label="Notifications" total={notifs.length} unread={unread} tab={tab} onTabChange={setTab} onClose={() => setOpen(false)}>
          {displayed.length === 0 ? (
            <EmptyState msg={tab === "unread" ? "No unread notifications" : undefined} />
          ) : displayed.map((n, i) => {
            const approved = n.action === "approved";
            const iconSt = approved
              ? { bg: "rgba(52,199,89,0.12)", color: "#34c759", border: "1.5px solid rgba(52,199,89,0.25)" }
              : { bg: "rgba(224,82,82,0.12)", color: "#e05252", border: "1.5px solid rgba(224,82,82,0.25)" };
            return (
              <div key={n.id}>
                {i > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                <button
                  className="bv-row-hover w-full text-left px-4 py-3 flex items-start gap-3"
                  style={{ background: n.read ? "transparent" : "rgba(212,175,55,0.04)", border: "none", cursor: "pointer" }}
                  onClick={() => handleClick(n)}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: iconSt.bg, color: iconSt.color, border: iconSt.border }}>
                    {approved ? <CheckCircle2 size={15} strokeWidth={1.8} /> : <XCircle size={15} strokeWidth={1.8} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-snug" style={{ color: "var(--w)" }}>
                      <span className="font-semibold">{n.doc_type}</span>
                      {approved ? " has been approved" : " has been rejected"}
                    </p>
                    {n.feedback && (
                      <p className="text-[11px] mt-1.5 px-2 py-1.5 rounded-lg leading-snug"
                        style={{
                          background: approved ? "rgba(52,199,89,0.07)" : "rgba(224,82,82,0.07)",
                          color: approved ? "#34c759" : "#e05252",
                          border: `1px solid ${approved ? "rgba(52,199,89,0.15)" : "rgba(224,82,82,0.15)"}`,
                        }}>
                        {n.feedback}
                      </p>
                    )}
                    <p className="text-[10px] mt-1.5 flex items-center gap-1" style={{ color: "var(--w3)" }}>
                      {relTime(n.created_at)}
                      <span style={{ color: "var(--border)" }}>·</span>
                      <span style={{ color: approved ? "#34c759" : "#e05252" }}>Tap to review →</span>
                    </p>
                  </div>
                  {!n.read && (
                    <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ background: "var(--gold)" }} />
                  )}
                </button>
              </div>
            );
          })}
        </NotifDropdown>
      )}
    </div>
  );
}

// ── Admin bell ────────────────────────────────────────────────────────────────

function AdminBell({ accessToken }: { accessToken: string }) {
  const [notifs, setNotifs]   = useState<AdminNotif[]>([]);
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState<"all" | "unread">("all");
  const ref    = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetch_ = useCallback(async () => {
    const res = await fetch("/api/portal/admin/notifications", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return;
    const json = await res.json();
    setNotifs(json.notifications ?? []);
  }, [accessToken]);

  useEffect(() => {
    fetch_();
    const timer = setInterval(fetch_, 20_000);
    return () => clearInterval(timer);
  }, [fetch_]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (window.matchMedia("(max-width: 639.98px)").matches) return;
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key  = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, []);

  async function markAllRead() {
    const prev = notifs;
    setNotifs(p => p.map(n => ({ ...n, read: true })));
    const res = await fetch("/api/portal/admin/notifications", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Rollback optimistic update if the server write failed
    if (!res.ok) setNotifs(prev);
  }

  const unread = notifs.filter(n => !n.read).length;

  // ── Urgency sort: surface stuck items first ──────────────────────────────
  // Tier 1: unread + > 48h old  (most stuck — needs attention now)
  // Tier 2: unread + > 24h old
  // Tier 3: unread + recent
  // Tier 4: read items
  const HOUR = 60 * 60 * 1000;
  const ageHours = (n: AdminNotif) => (Date.now() - new Date(n.created_at).getTime()) / HOUR;
  const tier = (n: AdminNotif) => {
    if (n.read) return 4;
    const h = ageHours(n);
    if (h >= 48) return 1;
    if (h >= 24) return 2;
    return 3;
  };
  const sorted = [...notifs].sort((a, b) => {
    const ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    // Within tier 1 surface oldest first (most stuck); other tiers newest first
    if (ta === 1) return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const overdueCount = sorted.filter(n => !n.read && ageHours(n) >= 48).length;
  const displayed = tab === "unread" ? sorted.filter(n => !n.read) : sorted;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) markAllRead();
  }

  async function handleClick(n: AdminNotif) {
    setOpen(false);

    // Signup → navigate to admin candidate view
    if (n.type === "signup") {
      router.push(`/portal/admin?nav_email=${encodeURIComponent(n.user_email)}`);
      // Also dispatch in case admin is already on the page (router.push
      // doesn't re-run the URL-param effect on the same route).
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("bv-admin-deep-link", {
          detail: { email: n.user_email, docId: null },
        }));
      }, 30);
      return;
    }

    // Upload → resolve the doc, navigate AND dispatch event. The admin page
    // listens for the event and opens the same preview popup the admin gets
    // from a normal row click. URL is also updated so a refresh works.
    try {
      const res = await fetch(`/api/portal/admin/notifications/${encodeURIComponent(n.id)}/doc`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const { doc } = await res.json();
        if (doc?.id && doc?.user_id) {
          const email = n.user_email || "";
          router.push(`/portal/admin?nav_email=${encodeURIComponent(email)}&nav_doc_id=${encodeURIComponent(doc.id)}`);
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("bv-admin-deep-link", {
              detail: { email, docId: doc.id, userId: doc.user_id, fileType: doc.file_type },
            }));
          }, 30);
          return;
        }
      }
    } catch (e) {
      console.error("[notif click] doc lookup failed:", e);
    }
    // Fallback: at least navigate to the candidate
    router.push(`/portal/admin?nav_email=${encodeURIComponent(n.user_email || "")}`);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("bv-admin-deep-link", {
        detail: { email: n.user_email, docId: null },
      }));
    }, 30);
  }

  return (
    <>
      <div ref={ref} className="relative">
        <BellButton unread={unread} open={open} onClick={toggle} />
        {open && (
          <NotifDropdown label="Activity" total={notifs.length} unread={unread} tab={tab} onTabChange={setTab} onClose={() => setOpen(false)}>
            {/* Overdue banner — shows count of unread items >48h old */}
            {overdueCount > 0 && (
              <div className="mx-3 mt-3 mb-1 px-3 py-2 inline-flex items-center gap-2 text-[11.5px] font-semibold tracking-tight"
                style={{ background: "rgba(224,82,82,0.08)", color: "#e05252", border: "1px solid rgba(224,82,82,0.22)", borderRadius: "var(--r-sm)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#e05252", animation: "pls 2s ease-in-out infinite" }} />
                {overdueCount} candidate{overdueCount !== 1 ? "s" : ""} waiting &gt; 48 hours
              </div>
            )}
            {displayed.length === 0 ? (
              <EmptyState msg={tab === "unread" ? "No unread activity" : undefined} />
            ) : displayed.map((n, i) => {
              const isSignup = n.type === "signup";
              const iconSt = isSignup
                ? { bg: "rgba(74,144,217,0.12)",  color: "#4a90d9",     border: "1px solid rgba(74,144,217,0.25)",  Icon: User }
                : { bg: "rgba(212,175,55,0.12)", color: "var(--gold)", border: "1px solid rgba(212,175,55,0.25)",  Icon: Paperclip };
              return (
                <div key={n.id}>
                  {i > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                  <button
                    className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-[rgba(255,255,255,0.03)]"
                    style={{ background: n.read ? "transparent" : "rgba(212,175,55,0.04)", border: "none", cursor: "pointer" }}
                    onClick={() => handleClick(n)}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: iconSt.bg, border: iconSt.border, color: iconSt.color }}>
                      <iconSt.Icon size={14} strokeWidth={1.7} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {isSignup ? (
                        <>
                          <p className="text-xs leading-snug" style={{ color: "var(--w)" }}>
                            <span className="font-semibold">{n.user_name}</span> just signed up
                          </p>
                          {n.user_email && (
                            <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--w3)" }}>{n.user_email}</p>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="text-xs leading-snug" style={{ color: "var(--w)" }}>
                            <span className="font-semibold">{n.user_name}</span> uploaded a document
                          </p>
                          {n.doc_type && (
                            <p className="text-[11px] mt-0.5 px-2 py-1 rounded-lg leading-snug"
                              style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                              {n.doc_type}
                            </p>
                          )}
                        </>
                      )}
                      <p className="text-[10px] mt-1.5 flex items-center gap-1" style={{ color: "var(--w3)" }}>
                        {relTime(n.created_at)}
                        <span style={{ color: "var(--border)" }}>·</span>
                        <span style={{ color: "var(--gold)" }}>
                          {isSignup ? "View candidate →" : "Quick review →"}
                        </span>
                      </p>
                    </div>
                    {!n.read && (
                      <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ background: "var(--gold)" }} />
                    )}
                  </button>
                </div>
              );
            })}
          </NotifDropdown>
        )}
      </div>
    </>
  );
}

// ── Public export ─────────────────────────────────────────────────────────────

export function NotificationBell() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "admin";     accessToken: string }
    | { kind: "candidate"; userId: string; accessToken: string }
    | { kind: "none" }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const apply = async (session: { user?: { id: string } | null; access_token?: string } | null) => {
      const user = session?.user ?? null;
      if (!user) { if (!cancelled) setState({ kind: "none" }); return; }
      // Ask the server for our role; never compare against a NEXT_PUBLIC_ admin email.
      let role: "admin" | "sub_admin" | null = null;
      try {
        if (session?.access_token) {
          const res = await fetch("/api/portal/me/role", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          ({ role } = await res.json().catch(() => ({ role: null })));
        }
      } catch { /* offline */ }
      if (cancelled) return;
      if (role === "admin") setState({ kind: "admin", accessToken: session?.access_token ?? "" });
      else                  setState({ kind: "candidate", userId: user.id, accessToken: session?.access_token ?? "" });
    };
    supabase.auth.getSession().then(({ data: { session } }) => apply(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  if (state.kind === "loading" || state.kind === "none") return null;
  if (state.kind === "admin")     return <AdminBell accessToken={state.accessToken} />;
  return <CandidateBell userId={state.userId} accessToken={state.accessToken} />;
}
