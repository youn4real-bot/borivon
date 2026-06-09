"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fetchMyRole, cachedRole } from "@/lib/myRole";
import { ASSIGNMENTS_TOPIC } from "@/lib/serverBroadcast";
import { Bell, CheckCircle2, XCircle, FilePen, Calendar } from "@/components/PortalIcons";

import { Spinner } from "@/components/ui/states";
import { useLang } from "@/components/LangContext";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { relativeTimeShort } from "@/lib/relativeTime";
import { playNotifChime } from "@/lib/notifSound";
import { translateDocLabel } from "@/lib/fileKeys";
import { useDismiss } from "@/lib/useDismiss";

// ── Minimal bell-specific translations ─────────────────────────────────────────
const BELL_T = {
  fr: {
    title: "Notifications",
    activity: "Activité",
    allTab: "Tous",
    unreadTab: "Non lus",
    allCaughtUp: "Tout vu",
    noNotifs: "Pas encore de notifications",
    noNotifsHint: "Vous serez notifié de toute activité ici",
    noUnread: "Aucune notification non lue",
    noUnreadActivity: "Aucune activité non lue",
    noActivityYet: "Pas encore d'activité",
    verified: "🎉 Vous êtes vérifié !",
    verifiedNext: "Prochaine étape : téléchargez votre **Lebenslauf** pour continuer.",
    placed: "🎉 Vous avez été sélectionné !",
    placedWith: "Associé à",
    placedNext: "Consultez votre tableau de bord pour voir les détails.",
    // One PDF = one notification, regardless of sign / fill / both. All four
    // labels resolve to the same string so the bell never splits one slot
    // into multiple cards.
    signRequest: "Action requise",
    signRequestSign: "Action requise",
    signRequestFill: "Action requise",
    signRequestBoth: "Action requise",
    signRequestNext: "Ouvrez votre tableau de bord pour ouvrir le document.",
    approved: "a été approuvé",
    rejected: "a été refusé",
    goToDashboard: "Voir le tableau de bord →",
    tapToReview: "Appuyer pour voir →",
    eventInvite: "Borivon vous a invité à un événement",
    viewCalendar: "Voir le calendrier →",
    justSignedUp: "vient de s'inscrire",
    uploadedDoc: "a téléversé un document",
    signedDoc: "a signé un document",
    viewCandidate: "Voir le candidat →",
    quickReview: "Révision rapide →",
    reviewNow: "Réviser maintenant →",
    waiting48h: (n: number) => `${n} candidat${n !== 1 ? "s" : ""} en attente > 48 h`,
  },
  en: {
    title: "Notifications",
    activity: "Activity",
    allTab: "All",
    unreadTab: "Unread",
    allCaughtUp: "All caught up",
    noNotifs: "No notifications yet",
    noNotifsHint: "You'll be notified of any activity here",
    noUnread: "No unread notifications",
    noUnreadActivity: "No unread activity",
    noActivityYet: "No activity yet",
    verified: "🎉 You're verified!",
    verifiedNext: "Next step: upload your **Lebenslauf** to continue.",
    placed: "🎉 You've been matched!",
    placedWith: "Placed with",
    placedNext: "Check your dashboard to see the details.",
    // One PDF = one notification (sign / fill / both unified).
    signRequest: "Action required",
    signRequestSign: "Action required",
    signRequestFill: "Action required",
    signRequestBoth: "Action required",
    signRequestNext: "Open your dashboard to open the document.",
    approved: "has been approved",
    rejected: "has been rejected",
    goToDashboard: "Go to dashboard →",
    tapToReview: "Tap to review →",
    eventInvite: "Borivon invited you to an event",
    viewCalendar: "View calendar →",
    justSignedUp: "just signed up",
    uploadedDoc: "uploaded a document",
    signedDoc: "signed a document",
    viewCandidate: "View candidate →",
    quickReview: "Quick review →",
    reviewNow: "Review now →",
    waiting48h: (n: number) => `${n} candidate${n !== 1 ? "s" : ""} waiting > 48 hours`,
  },
  de: {
    title: "Benachrichtigungen",
    activity: "Aktivität",
    allTab: "Alle",
    unreadTab: "Ungelesen",
    allCaughtUp: "Alles gelesen",
    noNotifs: "Noch keine Benachrichtigungen",
    noNotifsHint: "Sie werden über jede Aktivität hier benachrichtigt",
    noUnread: "Keine ungelesenen Benachrichtigungen",
    noUnreadActivity: "Keine ungelesene Aktivität",
    noActivityYet: "Noch keine Aktivität",
    verified: "🎉 Ihr Profil ist verifiziert!",
    verifiedNext: "Nächster Schritt: Laden Sie Ihren **Lebenslauf** hoch.",
    placed: "🎉 Sie wurden ausgewählt!",
    placedWith: "Zugeordnet zu",
    placedNext: "Sehen Sie die Details in Ihrem Dashboard.",
    // One PDF = one notification (sign / fill / both unified).
    signRequest: "Aktion erforderlich",
    signRequestSign: "Aktion erforderlich",
    signRequestFill: "Aktion erforderlich",
    signRequestBoth: "Aktion erforderlich",
    signRequestNext: "Öffnen Sie Ihr Dashboard, um das Dokument zu öffnen.",
    approved: "wurde genehmigt",
    rejected: "wurde abgelehnt",
    goToDashboard: "Zum Dashboard →",
    tapToReview: "Tippen zum Überprüfen →",
    eventInvite: "Borivon hat Sie zu einem Termin eingeladen",
    viewCalendar: "Zum Kalender →",
    justSignedUp: "hat sich gerade registriert",
    uploadedDoc: "hat ein Dokument hochgeladen",
    signedDoc: "hat ein Dokument unterschrieben",
    viewCandidate: "Kandidaten anzeigen →",
    quickReview: "Schnellprüfung →",
    reviewNow: "Jetzt prüfen →",
    waiting48h: (n: number) => `${n} Kandidat${n !== 1 ? "en" : ""} wartet seit > 48 Stunden`,
  },
} as const;
// ── UUID guard: hide raw phase_slots UUIDs that leaked into legacy DB rows.
// New inserts resolve to labels server-side; this is the read-time safety net.
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cleanLabel(s: string | null | undefined, fallback = "Dokument"): string {
  const v = (s ?? "").trim();
  if (!v || UUID_RX.test(v)) return fallback;
  return v;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CandidateNotif = {
  id: string;
  doc_id: string | null;
  doc_name: string;
  doc_type: string;
  action: "approved" | "rejected" | "verified" | "placed" | "sign_request" | "event_invite" | "follow_up" | "live_class";
  feedback: string | null;
  read: boolean;
  created_at: string;
};

type AdminNotif = {
  id: string;
  type: "signup" | "upload" | "doc-signed";
  user_name: string;
  user_email: string;
  doc_type: string | null;
  doc_name: string | null;
  read: boolean;
  created_at: string;
  user_photo: string | null;
  user_verified: boolean;
};

// Per-recipient calendar invite. Admins / sub-admins receive these in their bell
// too (not only candidates) — keyed by their own user_id in the `notifications`
// table, so a tagged sub-admin gets the same instant ping + chime.
type InviteNotif = {
  id: string;
  doc_name: string;   // the event title
  read: boolean;
  created_at: string;
};

// ── New-arrival tracker ───────────────────────────────────────────────────────
// Robust chime + entry-animation, independent of HOW the refresh arrived
// (realtime push, poll, or open). The realtime channel is flaky for
// admin_notifications (RLS-gated); driving the chime off id-diffing in the
// fetch path means the sound + slide-in always fire, even when only the poll
// delivered the new row. boot=first load → no chime for the initial backlog.
function useNewArrivals() {
  const seen  = useRef<Set<string>>(new Set());
  const boot  = useRef(true);
  const clrT  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const track = useCallback((ids: string[], shouldChime: (id: string) => boolean) => {
    if (boot.current) {
      ids.forEach(i => seen.current.add(i));
      boot.current = false;
      return;
    }
    const fresh = ids.filter(i => !seen.current.has(i));
    ids.forEach(i => seen.current.add(i));
    if (!fresh.length) return;
    if (fresh.some(shouldChime)) playNotifChime();
    setNewIds(new Set(fresh));
    if (clrT.current) clearTimeout(clrT.current);
    clrT.current = setTimeout(() => setNewIds(new Set()), 700);
  }, []);
  useEffect(() => () => { if (clrT.current) clearTimeout(clrT.current); }, []);
  return { newIds, track };
}

// ── Bell button ───────────────────────────────────────────────────────────────

function BellButton({ unread, open, onClick }: { unread: number; open: boolean; onClick: () => void }) {
  const { t } = useLang();
  return (
    <button
      onClick={onClick}
      aria-label={t.nbAria}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls="bv-notif-dropdown"
      className="relative flex items-center justify-center w-9 h-9 cursor-pointer hover:scale-110 active:scale-95 transition-transform"
      style={{
        background: "transparent",
        border: "none",
        color: unread > 0 || open ? "var(--gold)" : "var(--w3)",
        transition: "color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease)",
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

function EmptyState({ msg, hint }: { msg?: string; hint?: string }) {
  return (
    <div className="py-12 text-center">
      <span className="mx-auto mb-3 flex items-center justify-center w-11 h-11 rounded-full"
        style={{ background: "var(--gdim)", border: "1px solid var(--border-gold)", color: "var(--gold)" }}>
        <Bell size={20} strokeWidth={1.6} />
      </span>
      <p className="text-xs font-medium" style={{ color: "var(--w2)" }}>{msg}</p>
      {hint && <p className="text-[11px] mt-1" style={{ color: "var(--w3)" }}>{hint}</p>}
    </div>
  );
}

// ── Dropdown shell with All/Unread tabs ───────────────────────────────────────

function NotifDropdown({ label, total, unread, tab, onTabChange, onClose, children, allTab, unreadTab, allCaughtUp }: {
  label: string; total: number; unread: number;
  tab: "all" | "unread"; onTabChange: (t: "all" | "unread") => void;
  onClose: () => void;
  children: React.ReactNode;
  allTab: string; unreadTab: string; allCaughtUp: string;
}) {
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 639.98px)").matches;

  const header = (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold" style={{ color: "var(--w)" }}>{label}</p>
        {unread === 0 && total > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: "var(--w3)" }}>
            <CheckCircle2 size={10} strokeWidth={1.8} /> {allCaughtUp}
          </span>
        )}
      </div>
      <div role="tablist" aria-label={label} className="flex gap-1.5">
        {(["all", "unread"] as const).map(t => (
          <button key={t} onClick={() => onTabChange(t)}
            role="tab"
            aria-selected={tab === t}
            id={`bv-notif-tab-${t}`}
            className="px-3.5 py-1 rounded-full text-[11px] font-semibold transition-all"
            style={{
              background: tab === t ? "var(--gold)" : "var(--bg2)",
              color:      tab === t ? "#131312"    : "var(--w3)",
              border:     tab === t ? "none"        : "1px solid var(--border)",
            }}>
            {t === "all" ? `${allTab}${total ? ` (${total})` : ""}` : `${unreadTab}${unread ? ` (${unread})` : ""}`}
          </button>
        ))}
      </div>
    </>
  );

  if (isMobile && typeof document !== "undefined") {
    return createPortal(
      <>
        <div className="fixed inset-0" style={{ zIndex: 1299, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }} onClick={onClose} />
        <div id="bv-notif-dropdown" role="dialog" aria-modal="false" aria-label={label}
          className="fixed bottom-0 left-0 right-0 flex flex-col rounded-t-[22px]"
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
    <div id="bv-notif-dropdown" role="dialog" aria-modal="false" aria-label={label}
      className="absolute right-0 w-[320px] rounded-2xl overflow-hidden z-[600]"
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
  const { lang } = useLang();
  const bt = BELL_T[lang] ?? BELL_T.fr;
  const { newIds, track } = useNewArrivals();

  const fetch_ = useCallback(async () => {
    // doc_type='placement' is excluded: candidate must never see an
    // org-match notification (user request 2026-05). Any legacy rows
    // from before the silent-placement switch stay in the DB but never
    // reach the bell. Same goes for the 15s realtime poll below — it
    // calls this same fetch.
    const { data, error } = await supabase
      .from("notifications")
      .select("id, doc_id, doc_name, doc_type, action, feedback, read, created_at")
      .eq("user_id", userId)
      .neq("doc_type", "placement")
      .order("created_at", { ascending: false })
      .limit(30);
    // On Supabase error: keep the existing notifications list rather than
    // wiping it to []. Wiping silently makes the unread badge disappear and
    // the user thinks they're caught up when really the fetch failed.
    if (error) {
      console.error("[NotificationBell] fetch failed:", error.message);
      return;
    }
    const list = (data ?? []) as CandidateNotif[];
    setNotifs(list);
    track(list.map(n => n.id), id => !list.find(x => x.id === id)?.read);
  }, [userId, track]);

  useEffect(() => {
    fetch_();
    // Poll backstop: realtime can silently not deliver (publication / RLS /
    // dropped socket). 15s poll guarantees the bell — and the chime, now
    // driven by fetch_ — fires even with realtime down. Realtime just makes
    // it instant when it IS up.
    const timer = setInterval(fetch_, 15_000);
    const ch = supabase
      .channel(`notifs-${userId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { fetch_(); }
      )
      .subscribe();
    return () => { clearInterval(timer); supabase.removeChannel(ch); };
  }, [userId, fetch_]);

  // Outside-press + Esc handled via shared hook (lib/useDismiss).
  // skipMobile=true → phones use a dedicated bottom-sheet backdrop, not the
  // global outside-press dismiss.
  useDismiss(ref, open, () => setOpen(false), { skipMobile: true });

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
  // Issue 14.1: show a spinner on the tapped notification while resolving the doc
  const [pendingNotifId, setPendingNotifId] = useState<string | null>(null);

  function toggle() { if (!open) fetch_(); setOpen(o => !o); }

  async function markOneRead(n: CandidateNotif) {
    if (n.read) return;
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    supabase.from("notifications").update({ read: true }).eq("id", n.id).then(() => {});
  }

  async function handleClick(n: CandidateNotif) {
    if (pendingNotifId) return; // prevent double-tap
    markOneRead(n);
    setOpen(false);

    // "sign_request" deep-link. Two routing paths:
    //   doc_type starts with "slot_setup" (incl. _sign / _fill / _sign_fill)
    //     → wizard-driven B/V slot → ?slot=<slotId>
    //     (dashboard auto-opens fillForm + highlights the sig zone)
    //   doc_type="sign_request" → legacy stand-alone sign_request → ?sign=<id>
    if (n.action === "sign_request") {
      const sid = n.doc_id ?? "";
      const isSlot = n.doc_type.startsWith("slot_setup");
      const param = isSlot ? "slot" : "sign";
      router.push(`/portal/dashboard${sid ? `?${param}=${encodeURIComponent(sid)}` : ""}`);
      return;
    }
    // "live_class" — the admin assigned them to a class that's live NOW → jump
    // straight into the room (/portal/classroom auto-joins after the consent gate).
    if (n.action === "live_class") {
      const room = n.doc_id ?? "";
      router.push(`/portal/classroom${room ? `?room=${encodeURIComponent(room)}` : ""}`);
      return;
    }
    // "placed" — just go to dashboard
    if (n.action === "placed") {
      router.push("/portal/dashboard");
      return;
    }
    // "event_invite" — deep-link to the Calendar tab (the event is masked as
    // coming from "Borivon"; the candidate never sees the individual admin).
    if (n.action === "event_invite") {
      router.push("/portal/calendar");
      return;
    }
    // "follow_up" — a Borivon reminder; just open the dashboard (no doc to resolve).
    if (n.action === "follow_up") {
      router.push("/portal/dashboard");
      return;
    }

    let docId = n.doc_id ?? null;

    if (!docId) {
      setPendingNotifId(n.id);
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
      } finally {
        setPendingNotifId(null);
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
        <NotifDropdown label={bt.title} total={notifs.length} unread={unread} tab={tab} onTabChange={setTab} onClose={() => setOpen(false)}
          allTab={bt.allTab} unreadTab={bt.unreadTab} allCaughtUp={bt.allCaughtUp}>
          {displayed.length === 0 ? (
            <EmptyState msg={tab === "unread" ? bt.noUnread : bt.noNotifs} hint={tab === "unread" ? undefined : bt.noNotifsHint} />
          ) : displayed.map((n, i) => {
            const verified    = n.action === "verified";
            const approved    = n.action === "approved";
            const placed      = n.action === "placed";
            const signRequest = n.action === "sign_request";
            const eventInvite = n.action === "event_invite";
            const followUp    = n.action === "follow_up";
            const liveClass   = n.action === "live_class";
            const iconSt = (verified || placed || signRequest || eventInvite || followUp || liveClass)
              ? { bg: "var(--gdim)", color: "var(--gold)", border: "1.5px solid var(--border-gold)" }
              : approved
              ? { bg: "var(--success-bg)",  color: "var(--success)",     border: "1.5px solid var(--success-border)" }
              : { bg: "var(--danger-bg)",  color: "var(--danger)",     border: "1.5px solid var(--danger-border)" };
            // Parse "**Lebenslauf**" bold markers in verifiedNext
            const verifiedNextParts = bt.verifiedNext.split(/\*\*(.*?)\*\*/g);
            return (
              <div key={n.id} style={newIds.has(n.id) ? { animation: "bvNotifIn .34s var(--ease-out) both" } : undefined}>
                {i > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                <button
                  className="bv-row-hover w-full text-left px-4 py-3 flex items-start gap-3"
                  style={{
                    background: n.read ? "transparent" : "var(--gdim)",
                    borderLeft: n.read ? "2px solid transparent" : "2px solid var(--border-gold)",
                    borderTop: "none", borderRight: "none", borderBottom: "none",
                    cursor: pendingNotifId === n.id ? "wait" : "pointer",
                    opacity: pendingNotifId === n.id ? 0.7 : 1,
                  }}
                  disabled={pendingNotifId !== null}
                  onClick={() => handleClick(n)}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: iconSt.bg, color: iconSt.color, border: iconSt.border }}>
                    {pendingNotifId === n.id ? <Spinner size="xs" /> : liveClass ? <span style={{ fontSize: 15 }}>🎥</span> : verified ? <CheckCircle2 size={15} strokeWidth={1.8} /> : placed ? <span style={{ fontSize: 15 }}>🏢</span> : eventInvite ? <Calendar size={15} strokeWidth={1.8} /> : signRequest ? <FilePen size={14} strokeWidth={1.8} /> : followUp ? <span style={{ fontSize: 15 }}>🔔</span> : approved ? <CheckCircle2 size={15} strokeWidth={1.8} /> : <XCircle size={15} strokeWidth={1.8} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Line 1: doc / event TITLE (bold). Line 2+: body text wrapping. */}
                    {liveClass ? (
                      <>
                        <p className="text-xs font-semibold truncate" style={{ color: "var(--gold)" }}>
                          {lang === "de" ? "Live-Kurs läuft" : lang === "fr" ? "Cours en direct" : "Live class started"}
                        </p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--w2)" }}>
                          {lang === "de" ? "Tippe, um jetzt live beizutreten." : lang === "fr" ? "Touche pour rejoindre en direct." : "Tap to join the class live now."}
                        </p>
                      </>
                    ) : verified ? (
                      <>
                        <p className="text-xs font-semibold flex items-center gap-1 truncate" style={{ color: "var(--gold)" }}>
                          <span className="truncate">{bt.verified}</span>
                        </p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--w2)", wordBreak: "break-word" }}>
                          {verifiedNextParts.map((p, i) => i % 2 === 1 ? <strong key={i}>{p}</strong> : p)}
                        </p>
                      </>
                    ) : placed ? (
                      <>
                        <p className="text-xs font-semibold flex items-center gap-1 truncate" style={{ color: "var(--gold)" }}>
                          <span className="truncate">{bt.placed}</span>
                        </p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--w2)", wordBreak: "break-word" }}>
                          {bt.placedNext}
                        </p>
                        {n.doc_name && (
                          <p className="text-[11px] mt-1 px-2 py-1 rounded-lg leading-snug inline-block truncate"
                            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", maxWidth: "100%" }}>
                            {bt.placedWith}: <strong>{cleanLabel(n.doc_name, lang === "de" ? "Agentur" : lang === "fr" ? "Agence" : "Agency")}</strong>
                          </p>
                        )}
                      </>
                    ) : eventInvite ? (
                      <>
                        {/* Line 1: event title. Line 2: masked sender — always
                            "Borivon", never the individual admin who created it. */}
                        <p className="text-xs font-semibold flex items-center gap-1 truncate" style={{ color: "var(--w)" }}>
                          <span className="truncate">{cleanLabel(n.doc_name, lang === "de" ? "Termin" : lang === "fr" ? "Événement" : "Event")}</span>
                        </p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--gold)", wordBreak: "break-word" }}>
                          {bt.eventInvite}
                        </p>
                      </>
                    ) : signRequest ? (
                      <>
                        {/* Line 1: doc name (truncate) — mirrors admin "name first" pattern. */}
                        <p className="text-xs font-semibold flex items-center gap-1 truncate" style={{ color: "var(--w)" }}>
                          <span className="truncate">{cleanLabel(n.doc_name)}</span>
                        </p>
                        {/* Line 2: action — one PDF = one label regardless of
                            sign / fill / both per user directive. */}
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--gold)", wordBreak: "break-word" }}>
                          {bt.signRequest}
                        </p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--w2)", wordBreak: "break-word" }}>
                          {bt.signRequestNext}
                        </p>
                      </>
                    ) : followUp ? (
                      <>
                        <p className="text-xs font-semibold flex items-center gap-1 truncate" style={{ color: "var(--w)" }}>
                          <span className="truncate">{lang === "de" ? "Erinnerung von Borivon" : lang === "fr" ? "Rappel de Borivon" : "Reminder from Borivon"}</span>
                        </p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--gold)", wordBreak: "break-word" }}>
                          {lang === "de" ? "Bitte öffne dein Portal — es gibt etwas zu erledigen."
                            : lang === "fr" ? "Merci d'ouvrir ton portail — une action t'attend."
                            : "Please open your portal — there's something to take care of."}
                        </p>
                        {n.feedback && (
                          <p className="text-[11px] mt-1.5 px-2 py-1.5 rounded-lg leading-snug"
                            style={{ background: "var(--gdim)", color: "var(--w2)", border: "1px solid var(--border-gold)" }}>
                            {n.feedback}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        {/* Line 1: doc type. Line 2: status. */}
                        <p className="text-xs font-semibold flex items-center gap-1 truncate" style={{ color: "var(--w)" }}>
                          <span className="truncate">{cleanLabel(translateDocLabel(n.doc_type, lang as "fr" | "en" | "de"))}</span>
                        </p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: approved ? "var(--success)" : "var(--danger)", wordBreak: "break-word" }}>
                          {approved ? bt.approved : bt.rejected}
                        </p>
                      </>
                    )}
                    {!verified && !placed && !followUp && n.feedback && (
                      <p className="text-[11px] mt-1.5 px-2 py-1.5 rounded-lg leading-snug"
                        style={{
                          background: approved ? "var(--success-bg)" : "var(--danger-bg)",
                          color: approved ? "var(--success)" : "var(--danger)",
                          border: `1px solid ${approved ? "var(--success-bg)" : "var(--danger-border)"}`,
                        }}>
                        {n.feedback}
                      </p>
                    )}
                    <p className="text-[10px] mt-1.5 flex items-center gap-1" style={{ color: "var(--w3)" }}>
                      {relativeTimeShort(n.created_at, lang)}
                      <span style={{ color: "var(--border)" }}>·</span>
                      <span style={{ color: verified || placed || signRequest || eventInvite || followUp ? "var(--gold)" : approved ? "var(--success)" : "var(--danger)" }}>
                        {eventInvite ? bt.viewCalendar : verified || placed || signRequest || followUp ? bt.goToDashboard : bt.tapToReview}
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
  );
}

// ── Admin bell ────────────────────────────────────────────────────────────────

function AdminBell({ userId, accessToken }: { userId: string; accessToken: string }) {
  const [notifs, setNotifs]   = useState<AdminNotif[]>([]);
  const [invites, setInvites] = useState<InviteNotif[]>([]);
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState<"all" | "unread">("all");
  const ref    = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { lang } = useLang();
  const t = BELL_T[lang as keyof typeof BELL_T] ?? BELL_T.en;
  const { newIds, track } = useNewArrivals();

  const fetch_ = useCallback(async () => {
    // Two sources feed the admin bell:
    //   1. admin_notifications — the global candidate-activity feed (signup /
    //      upload / doc-signed), via the scoped API.
    //   2. notifications (action='event_invite') — THIS admin's own calendar
    //      invites, keyed by user_id. This is how a tagged sub-admin gets the
    //      same instant ping + chime as a candidate would.
    const [adminRes, inviteRes] = await Promise.allSettled([
      fetch("/api/portal/admin/notifications", { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => (r.ok ? r.json() : null)),
      supabase
        .from("notifications")
        .select("id, doc_name, read, created_at")
        .eq("user_id", userId)
        .eq("action", "event_invite")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const adminList  = (adminRes.status === "fulfilled" && adminRes.value?.notifications ? adminRes.value.notifications : []) as AdminNotif[];
    const inviteList = (inviteRes.status === "fulfilled" && !inviteRes.value.error ? (inviteRes.value.data ?? []) : []) as InviteNotif[];
    setNotifs(adminList);
    setInvites(inviteList);
    // Chime + slide-in are driven HERE, not in the realtime callback (realtime
    // is RLS-gated and often doesn't deliver). id-diffing across BOTH sources
    // fires the same sound for a new candidate-activity row OR a new invite.
    const ids   = [...adminList.map(n => n.id), ...inviteList.map(n => n.id)];
    const byId  = new Map<string, boolean>([...adminList.map(n => [n.id, n.read] as const), ...inviteList.map(n => [n.id, n.read] as const)]);
    track(ids, id => !byId.get(id));
  }, [accessToken, userId, track]);

  useEffect(() => {
    fetch_();
    // 15s poll backstop (was 60s) so the bell stays live even when the
    // realtime socket is down — the common case for admin_notifications.
    const timer = setInterval(fetch_, 15_000);
    const channel = supabase
      .channel("admin-notifs-bell")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "admin_notifications" },
        () => { fetch_(); },
      )
      .subscribe();
    // Assignment bus: a candidate (un)assigned to/from an org pings here so an
    // org admin's SCOPED list drops/regains that candidate instantly. The
    // refetch goes through the scoped endpoint, so this is safe for every role.
    const assignCh = supabase
      .channel(ASSIGNMENTS_TOPIC)
      .on("broadcast", { event: "changed" }, () => { fetch_(); })
      .subscribe();
    // This admin's OWN calendar invites land in `notifications` (per-user) —
    // subscribe so a tagged sub-admin gets the ping the instant it's created.
    const inviteCh = supabase
      .channel(`admin-invites-${userId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { fetch_(); },
      )
      .subscribe();
    return () => { clearInterval(timer); supabase.removeChannel(channel); supabase.removeChannel(assignCh); supabase.removeChannel(inviteCh); };
  }, [fetch_, userId]);

  // Outside-press + Esc handled via shared hook (lib/useDismiss).
  useDismiss(ref, open, () => setOpen(false), { skipMobile: true });

  async function markAllRead() {
    const prev = notifs, prevInv = invites;
    setNotifs(p => p.map(n => ({ ...n, read: true })));
    setInvites(p => p.map(n => ({ ...n, read: true })));
    try {
      const res = await fetch("/api/portal/admin/notifications", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) setNotifs(prev);
    } catch { setNotifs(prev); }
    // Calendar invites live in a separate table — mark those read too.
    if (prevInv.some(n => !n.read)) {
      const { error } = await supabase.from("notifications")
        .update({ read: true }).eq("user_id", userId).eq("action", "event_invite").eq("read", false);
      if (error) setInvites(prevInv);
    }
  }

  const unread = notifs.filter(n => !n.read).length + invites.filter(n => !n.read).length;

  // ── Recency sort + overdue counter ───────────────────────────────────────
  // Newest first. ageHours only feeds the overdue banner (candidate activity).
  const HOUR = 60 * 60 * 1000;
  const ageHours = (iso: string) => (Date.now() - new Date(iso).getTime()) / HOUR;
  const overdueCount = notifs.filter(n => !n.read && ageHours(n.created_at) >= 48).length;

  // Merge the candidate-activity feed + this admin's own calendar invites,
  // newest first, so an invite slots in by time like any other row.
  type Row = { t: "admin"; n: AdminNotif } | { t: "invite"; n: InviteNotif };
  const merged: Row[] = [
    ...notifs.map((n): Row => ({ t: "admin", n })),
    ...invites.map((n): Row => ({ t: "invite", n })),
  ].sort((a, b) => new Date(b.n.created_at).getTime() - new Date(a.n.created_at).getTime());
  const displayed = tab === "unread" ? merged.filter(r => !r.n.read) : merged;

  function toggle() { if (!open) fetch_(); setOpen(o => !o); }

  async function markOneRead(n: AdminNotif) {
    if (n.read) return;
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    fetch("/api/portal/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ ids: [n.id] }),
    }).catch(() => {});
  }

  // Calendar invite row: mark read (own notifications row) + jump to the event.
  function handleInviteClick(inv: InviteNotif) {
    if (!inv.read) {
      setInvites(prev => prev.map(x => x.id === inv.id ? { ...x, read: true } : x));
      supabase.from("notifications").update({ read: true }).eq("id", inv.id).then(() => {});
    }
    setOpen(false);
    router.push("/portal/calendar");
  }

  async function handleClick(n: AdminNotif) {
    markOneRead(n);
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

    // Doc-signed → navigate to candidate and scroll to sign request panel
    if (n.type === "doc-signed") {
      router.push(`/portal/admin?nav_email=${encodeURIComponent(n.user_email)}`);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("bv-admin-deep-link", {
          detail: { email: n.user_email, docId: null, scrollTo: "sign-requests" },
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
          <NotifDropdown label={t.activity} total={notifs.length} unread={unread} tab={tab} onTabChange={setTab} onClose={() => setOpen(false)}
            allTab={t.allTab} unreadTab={t.unreadTab} allCaughtUp={t.allCaughtUp}>
            {/* Overdue banner — shows count of unread items >48h old */}
            {overdueCount > 0 && (
              <div className="mx-3 mt-3 mb-1 px-3 py-2 inline-flex items-center gap-2 text-[11.5px] font-semibold tracking-tight"
                style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)", borderRadius: "var(--r-sm)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--danger)", animation: "pls 2s ease-in-out infinite" }} />
                {t.waiting48h(overdueCount)}
              </div>
            )}
            {displayed.length === 0 ? (
              <EmptyState msg={tab === "unread" ? t.noUnreadActivity : t.noActivityYet} />
            ) : displayed.map((row, i) => {
              // Calendar invite row (this admin / sub-admin was tagged on an event).
              if (row.t === "invite") {
                const inv = row.n;
                return (
                  <div key={inv.id} style={newIds.has(inv.id) ? { animation: "bvNotifIn .34s var(--ease-out) both" } : undefined}>
                    {i > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                    <button
                      className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-[rgba(255,255,255,0.03)]"
                      style={{
                        background: inv.read ? "transparent" : "var(--gdim)",
                        borderLeft: inv.read ? "2px solid transparent" : "2px solid var(--border-gold)",
                        borderTop: "none", borderRight: "none", borderBottom: "none",
                        cursor: "pointer",
                      }}
                      onClick={() => handleInviteClick(inv)}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                        <Calendar size={15} strokeWidth={1.8} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold flex items-center gap-1 truncate" style={{ color: "var(--w)" }}>
                          <span className="truncate">{cleanLabel(inv.doc_name, lang === "de" ? "Termin" : lang === "fr" ? "Événement" : "Event")}</span>
                        </p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--gold)", wordBreak: "break-word" }}>
                          {t.eventInvite}
                        </p>
                        <p className="text-[10px] mt-1.5 flex items-center gap-1" style={{ color: "var(--w3)" }}>
                          {relativeTimeShort(inv.created_at, lang)}
                          <span style={{ color: "var(--border)" }}>·</span>
                          <span style={{ color: "var(--gold)" }}>{t.viewCalendar}</span>
                        </p>
                      </div>
                      {!inv.read && (
                        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ background: "var(--gold)" }} />
                      )}
                    </button>
                  </div>
                );
              }
              const n = row.n;
              const isSignup   = n.type === "signup";
              const isDocSigned = n.type === "doc-signed";
              const iconSt = isSignup
                ? { bg: "var(--info-bg)",  color: "var(--info)",     border: "1px solid var(--info-border)" }
                : isDocSigned
                ? { bg: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }
                : { bg: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" };
              return (
                <div key={n.id} style={newIds.has(n.id) ? { animation: "bvNotifIn .34s var(--ease-out) both" } : undefined}>
                  {i > 0 && <div style={{ height: 1, background: "var(--border)" }} />}
                  <button
                    className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-[rgba(255,255,255,0.03)]"
                    style={{
                      background: n.read ? "transparent" : "var(--gdim)",
                      borderLeft: n.read ? "2px solid transparent" : "2px solid var(--border-gold)",
                      borderTop: "none", borderRight: "none", borderBottom: "none",
                      cursor: "pointer",
                    }}
                    onClick={() => handleClick(n)}>
                    {/* Candidate avatar — photo if available, initials fallback */}
                    <div className="flex-shrink-0 mt-0.5">
                      {n.user_photo ? (
                        <img src={n.user_photo} alt={n.user_name}
                          className="w-8 h-8 rounded-full object-cover"
                          style={{ border: "1px solid var(--border)" }} />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold"
                          style={{ background: iconSt.bg, color: iconSt.color, border: iconSt.border }}>
                          {n.user_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Line 1: candidate name (+ verified). Always on its own row. */}
                      <p className="text-xs font-semibold flex items-center gap-1 truncate" style={{ color: "var(--w)" }}>
                        <span className="truncate">{n.user_name}</span>
                        {n.user_verified && <VerifiedBadge verified size="xs" color="gold" />}
                      </p>
                      {/* Line 2: action text, wraps to multiple lines if needed. */}
                      <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--w2)", wordBreak: "break-word" }}>
                        {isSignup ? t.justSignedUp : isDocSigned ? t.signedDoc : t.uploadedDoc}
                      </p>
                      {/* Optional supporting line: email (signup) or doc pill (upload / sign). */}
                      {isSignup && n.user_email && (
                        <p className="text-[11px] mt-1 truncate" style={{ color: "var(--w3)" }}>{n.user_email}</p>
                      )}
                      {isDocSigned && n.doc_name && (
                        <p className="text-[11px] mt-1 px-2 py-1 rounded-lg leading-snug inline-flex items-center gap-1"
                          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", maxWidth: "100%" }}>
                          <FilePen size={10} strokeWidth={1.8} className="flex-shrink-0" />
                          <span className="truncate">{cleanLabel(n.doc_name)}</span>
                        </p>
                      )}
                      {!isSignup && !isDocSigned && n.doc_type && (
                        <p className="text-[11px] mt-1 px-2 py-1 rounded-lg leading-snug inline-block truncate"
                          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", maxWidth: "100%" }}>
                          {cleanLabel(translateDocLabel(n.doc_type, lang as "fr" | "en" | "de"))}
                        </p>
                      )}
                      <p className="text-[10px] mt-1.5 flex items-center gap-1" style={{ color: "var(--w3)" }}>
                        {relativeTimeShort(n.created_at, lang)}
                        <span style={{ color: "var(--border)" }}>·</span>
                        <span style={{ color: "var(--gold)" }}>
                          {isSignup ? t.viewCandidate : isDocSigned ? t.reviewNow : t.quickReview}
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
    | { kind: "admin";     userId: string; accessToken: string }
    | { kind: "candidate"; userId: string; accessToken: string }
    | { kind: "none" }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const apply = async (session: { user?: { id: string } | null; access_token?: string } | null) => {
      const user = session?.user ?? null;
      if (!user) { if (!cancelled) setState({ kind: "none" }); return; }
      const token = session?.access_token ?? "";
      // Sub-admins share the supreme admin's candidate notification queue, so
      // both admin + sub_admin → AdminBell; everyone else → CandidateBell.
      const toState = (role: string | null) =>
        (role === "admin" || role === "sub_admin")
          ? { kind: "admin" as const, userId: user.id, accessToken: token }
          : { kind: "candidate" as const, userId: user.id, accessToken: token };
      // Render the correct bell INSTANTLY from the cached role (no network wait)
      // so the icon never staggers in behind the others on a reload.
      const cr = cachedRole(user.id);
      if (cr && !cancelled) setState(toState(cr));
      // Refresh from the shared (deduped) role request. On failure keep the
      // cached variant rather than blanking the bell.
      const info = await fetchMyRole(token, user.id);
      if (cancelled) return;
      if (info.role) setState(toState(info.role));
      else if (!cr) setState(toState(null));
    };
    supabase.auth.getSession().then(({ data: { session } }) => apply(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  if (state.kind === "loading" || state.kind === "none") return null;
  if (state.kind === "admin")     return <AdminBell userId={state.userId} accessToken={state.accessToken} />;
  return <CandidateBell userId={state.userId} accessToken={state.accessToken} />;
}
