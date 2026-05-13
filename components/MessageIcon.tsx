"use client";

/**
 * Direct messaging.
 *
 *   - Candidate clicks chat icon → a CONVERSATION MODAL opens (centered on
 *     desktop, full-screen sheet on mobile). Single thread with the admin.
 *   - Admin clicks chat icon → small INBOX DROPDOWN under the icon listing
 *     all candidate conversations. Click a row → that row's unread clears
 *     instantly and a CONVERSATION MODAL opens for the thread.
 *   - Sub-admins don't get an inbox.
 *
 * Live updates:
 *   - Candidate uses Supabase Realtime (RLS lets them subscribe to their own
 *     thread → admin replies arrive instantly via websocket).
 *   - Admin polls fast (1.5 s on an open thread, 3 s on the inbox list, 20 s
 *     when nothing is open). Both sides also refetch on tab focus.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { Send, X as XIcon, Image as ImageIcon, Bug, Maximize2, Minimize2, Download } from "lucide-react";
import { Spinner } from "@/components/ui/states";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { relativeTime, dayLabel, clockTime } from "@/lib/relativeTime";
import { useDismiss } from "@/lib/useDismiss";

type Role = "candidate" | "admin";
type Kind = "message" | "bug";

type Msg = {
  id: string;
  sender_role: Role;
  body: string;
  attachment: string | null;
  kind: Kind;
  created_at: string;
  read_by_candidate?: boolean;
  read_by_admin?: boolean;
};

type AdminConversation = {
  threadUserId: string;
  name: string;
  email: string;
  lastBody: string;
  lastKind: Kind;
  lastSender: Role;
  lastAt: string;
  hasAttachment: boolean;
  unread: number;
  verified?: boolean;
  photoUrl?: string | null;
  paymentTier?: string | null;
  isOrgMember?: boolean;
};

type ViewState =
  | { kind: "anon" }
  | { kind: "candidate"; userId: string; accessToken: string }
  | { kind: "admin"; userId: string; accessToken: string };

export function MessageIcon() {
  const [state, setState] = useState<ViewState>({ kind: "anon" });

  useEffect(() => {
    let mounted = true;
    // Evaluate the user's role and retry on transient network errors. Falling
    // back to "candidate" on a single failed fetch is wrong — an admin who
    // hits a slow request would suddenly see the candidate chat UI instead
    // of their inbox. Retry up to 3 times with backoff before giving up.
    const evaluate = async (session: { user: { id: string; email?: string | null }; access_token?: string } | null) => {
      if (!session?.user) { if (mounted) setState({ kind: "anon" }); return; }
      const accessToken = session.access_token ?? "";

      const fetchRole = async (attempt: number): Promise<void> => {
        try {
          const res = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!res.ok) throw new Error(`role ${res.status}`);
          const json = await res.json();
          if (!mounted) return;
          if (json?.role === "admin") {
            setState({ kind: "admin", userId: session.user.id, accessToken });
          } else if (json?.role === "sub_admin") {
            setState({ kind: "anon" });
          } else if (json?.role === "candidate") {
            setState({ kind: "candidate", userId: session.user.id, accessToken });
          } else {
            // Unexpected payload — treat as anon rather than misclassifying.
            setState({ kind: "anon" });
          }
        } catch {
          if (!mounted) return;
          if (attempt < 3) {
            // Backoff retry — keep current state (don't flash candidate UI).
            setTimeout(() => fetchRole(attempt + 1), 400 * attempt);
          } else {
            // Persistent failure — hide the chat icon entirely instead of
            // showing the wrong UI to an admin or sub-admin.
            console.error("[MessageIcon] role fetch failed after retries");
            setState({ kind: "anon" });
          }
        }
      };
      fetchRole(1);
    };

    supabase.auth.getSession().then(({ data: { session } }) => evaluate(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, session) => evaluate(session));
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  if (state.kind === "anon") return null;
  if (state.kind === "admin")     return <AdminInbox accessToken={state.accessToken} />;
  return <CandidateChat accessToken={state.accessToken} userId={state.userId} />;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function compressImage(file: File, maxW: number, quality: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const ratio = img.width > maxW ? maxW / img.width : 1;
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej; r.readAsDataURL(file);
      });
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Visual primitives ────────────────────────────────────────────────────────

function ChatIconBtn({ unread, open, onClick, label }: { unread: number; open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="relative flex items-center justify-center w-9 h-9 cursor-pointer hover:scale-110 active:scale-95 transition-transform"
      style={{
        background: "transparent",
        border: "none",
        color: open ? "var(--gold)" : "var(--w3)",
        transition: "color 0.2s, transform 0.15s",
      }}
      onMouseEnter={(e) => { if (!open) e.currentTarget.style.color = "var(--w)"; }}
      onMouseLeave={(e) => { if (!open) e.currentTarget.style.color = "var(--w3)"; }}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
          style={{ background: "var(--gold)", color: "#131312" }}>
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}

// Round avatar — initial-based for now. Profile photos will replace this once
// candidates' CV photos are stored centrally; the API just needs to return
// `senderAvatar` per message and the component reads `avatarUrl`.
function Avatar({ initial, avatarUrl, size = 32, isAdmin = false }: {
  initial: string; avatarUrl?: string | null; size?: number; isAdmin?: boolean;
}) {
  const fontSize = size >= 32 ? 13 : 11;
  return avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatarUrl} alt={initial} width={size} height={size}
      className="rounded-full object-cover flex-shrink-0"
      style={{ border: "1px solid var(--border)" }} />
  ) : (
    <span
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
      style={{
        width: size, height: size, fontSize,
        background: isAdmin ? "var(--gold)" : "var(--gdim)",
        color: isAdmin ? "#131312" : "var(--gold)",
        border: `1px solid ${isAdmin ? "var(--gold)" : "var(--border-gold)"}`,
      }}>
      {(initial || "?").toUpperCase()}
    </span>
  );
}


function MessageBubble({ msg, mine, lang, showAvatar, senderInitial, senderAvatarUrl, onOpenImage }: {
  msg: Msg; mine: boolean; lang: string;
  showAvatar: boolean;          // false when the previous bubble was from the same sender within a short window
  senderInitial: string;        // first letter of the sender's name (or "B" for admin) — fallback if no photo
  senderAvatarUrl?: string | null; // actual photo URL for the avatar (candidate photo or admin logo)
  onOpenImage: (src: string) => void;
}) {
  const { t } = useLang();
  const isBug = msg.kind === "bug";
  return (
    <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"} ${showAvatar ? "mt-3" : "mt-1"}`}>
      <div className="w-8 flex-shrink-0">
        {showAvatar && (
          <Avatar initial={senderInitial} avatarUrl={senderAvatarUrl} isAdmin={msg.sender_role === "admin"} size={32} />
        )}
      </div>
      <div className={`flex flex-col ${mine ? "items-end" : "items-start"} max-w-[78%]`}>
        {showAvatar && (
          // Only timestamp above the bubble — no name or badge inside the conversation
          <p className={`text-[10px] mb-0.5 ${mine ? "text-right" : ""}`}
            style={{ color: "var(--w3)" }}>
            {clockTime(msg.created_at)}
          </p>
        )}
        <div className="px-3.5 py-2 rounded-2xl"
          style={{
            background: mine ? "var(--gold)" : "var(--bg2)",
            color: mine ? "#131312" : "var(--w)",
            border: mine ? "none" : "1px solid var(--border)",
            borderBottomRightRadius: mine ? "6px" : "16px",
            borderBottomLeftRadius:  mine ? "16px" : "6px",
          }}>
          {isBug && (
            <p className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] mb-1"
              style={{ color: mine ? "rgba(19,19,18,0.7)" : "var(--danger)" }}>
              <Bug size={10} strokeWidth={2.2} /> {lang === "fr" ? "Rapport de bug" : lang === "de" ? "Fehlerbericht" : "Bug report"}
            </p>
          )}
          {/* Attachment first, caption below — matches WhatsApp/Telegram convention. */}
          {msg.attachment && (
            <button type="button"
              onClick={() => onOpenImage(msg.attachment!)}
              aria-label={lang === "fr" ? "Agrandir l'image" : lang === "de" ? "Bild vergrößern" : "Open image"}
              className="block p-0 m-0 cursor-zoom-in"
              style={{ background: "transparent", border: "none" }}>
              { /* eslint-disable-next-line @next/next/no-img-element */ }
              <img src={msg.attachment} alt={t.miAttachment}
                className="max-h-[200px] rounded-md block"
                style={{ border: "1px solid var(--border)" }} />
            </button>
          )}
          {msg.body && (
            <p className={`text-[13.5px] leading-snug whitespace-pre-wrap break-words ${msg.attachment ? "mt-2" : ""}`}>
              {msg.body}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
      <span className="text-[10.5px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--w3)" }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </div>
  );
}

// Build a render plan for the message list: groups consecutive messages from
// the same sender within 5 minutes (only first shows the avatar/header), and
// inserts a day separator whenever the calendar date changes.
function renderItems(
  msgs: Msg[], lang: string,
  otherInitial: string, ownInitial: string,
  otherAvatarUrl: string | null | undefined, ownAvatarUrl: string | null | undefined,
  mineRole: Role, onOpenImage: (src: string) => void,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastDay = "";
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) {
      out.push(<DaySeparator key={`d-${day}`} label={dayLabel(m.created_at, lang)} />);
      lastDay = day;
    }
    const prev = i > 0 ? msgs[i - 1] : null;
    const sameDayPrev = prev && new Date(prev.created_at).toDateString() === day;
    const sameSender = prev && prev.sender_role === m.sender_role && sameDayPrev;
    const close = prev && (new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60 * 1000;
    const showAvatar = !sameSender || !close;
    const mine = m.sender_role === mineRole;
    out.push(
      <MessageBubble key={m.id} msg={m} mine={mine} lang={lang}
        showAvatar={!!showAvatar}
        senderInitial={mine ? ownInitial : otherInitial}
        senderAvatarUrl={mine ? ownAvatarUrl : otherAvatarUrl}
        onOpenImage={onOpenImage} />,
    );
  }
  return out;
}

// Fullscreen image lightbox — opened on click of any message attachment.
// Centered on desktop, fills the screen on mobile. Click backdrop / X / Esc
// to close — and only the lightbox closes, the chat modal underneath stays
// open (we stopPropagation on every click so the chat backdrop never sees it).
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const { t } = useLang();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture phase + stopImmediatePropagation so the underlying chat
        // modal's Esc handler does NOT also fire (which would close the
        // whole conversation).
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey, true); document.body.style.overflow = prev; };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  function close(e: React.MouseEvent) {
    // Critical: stop propagation so the underlying chat modal's backdrop
    // click handler doesn't ALSO fire and close the chat.
    e.stopPropagation();
    onClose();
  }

  function download(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const a = document.createElement("a");
      a.href = src;
      // Try to derive a sensible filename + extension from the data URL.
      const m = src.match(/^data:image\/(\w+)/);
      const ext = m ? m[1] : "png";
      a.download = `borivon-attachment-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch { /* ignore */ }
  }

  const node = (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center p-2 sm:p-6"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)", animation: "bvFadeRise .18s var(--ease-out)" }}
      onClick={close}
      onMouseDown={e => e.stopPropagation()}>
      <div className="fixed top-3 right-3 sm:top-5 sm:right-5 flex items-center gap-2 z-10"
        onClick={e => e.stopPropagation()}>
        <button onClick={download} aria-label={t.miDownload}
          className="w-10 h-10 flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}>
          <Download size={17} strokeWidth={1.8} />
        </button>
        <button onClick={close} aria-label={t.miClose}
          className="w-10 h-10 flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
          style={{ background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}>
          <XIcon size={18} strokeWidth={1.8} />
        </button>
      </div>
      { /* eslint-disable-next-line @next/next/no-img-element */ }
      <img src={src} alt={t.miAttachment}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
          borderRadius: "8px", boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
          animation: "bvFadeRise .22s var(--ease-out)",
        }} />
    </div>
  );
  return createPortal(node, document.body);
}

function ComposeBar({
  onSend, lang, disabled,
}: {
  onSend: (text: string, attachment: string | null) => Promise<void>;
  lang: string; disabled?: boolean;
}) {
  const { t } = useLang();
  const [text, setText] = useState("");
  const [attach, setAttach] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ph = lang === "fr" ? "Écrire un message…" : lang === "de" ? "Nachricht schreiben…" : "Write a message…";
  const tooLarge = lang === "fr" ? "Image trop grande (max ~600 Ko)." : lang === "de" ? "Bild zu groß (max ~600 KB)." : "Image too large (max ~600 KB).";
  const sendFailedLabel = lang === "fr" ? "Échec de l'envoi — réessayer" : lang === "de" ? "Senden fehlgeschlagen — erneut versuchen" : "Send failed — try again";

  async function handleAttach(file: File | null) {
    if (!file || !file.type.startsWith("image/")) return;
    const data = await compressImage(file, 1280, 0.78);
    if (data.length > 800_000) { alert(tooLarge); return; }
    setAttach(data);
  }

  async function send() {
    if (sending || (!text.trim() && !attach)) return;
    setSending(true);
    setSendErr(null);
    try {
      await onSend(text.trim(), attach);
      setText(""); setAttach(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      // Keep the text in the input + show inline error so the user can retry.
      setSendErr((e as Error).message || sendFailedLabel);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--card)" }}
      // Lift above iOS Safari home indicator
      className="pb-[env(safe-area-inset-bottom)]">
      {sendErr && (
        <div role="alert" aria-live="assertive"
          className="px-3 pt-2 pb-0 text-[11.5px]" style={{ color: "var(--danger)" }}>
          {sendFailedLabel}
        </div>
      )}
      {attach && (
        <div className="px-3 pt-2.5 flex items-start gap-2">
          { /* eslint-disable-next-line @next/next/no-img-element */ }
          <img src={attach} alt={t.miPreview} className="max-h-[80px] rounded-md"
            style={{ border: "1px solid var(--border)" }} />
          <button onClick={() => setAttach(null)} aria-label={t.miRemoveAttach}
            className="bv-icon-btn w-7 h-7 flex items-center justify-center rounded-full"
            style={{ color: "var(--w3)" }}>
            <XIcon size={12} strokeWidth={2} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2.5">
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => handleAttach(e.target.files?.[0] ?? null)} />
        <button onClick={() => fileRef.current?.click()} aria-label={t.miAttachImg}
          disabled={disabled || sending}
          className="bv-icon-btn w-10 h-10 flex items-center justify-center rounded-full flex-shrink-0 disabled:opacity-50"
          style={{ color: "var(--w2)" }}>
          <ImageIcon size={15} strokeWidth={1.8} />
        </button>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={ph}
          aria-label={ph}
          rows={1}
          disabled={disabled || sending}
          className="flex-1 resize-none outline-none px-3 py-2 text-[14px]"
          style={{
            background: "var(--bg2)", color: "var(--w)",
            border: "1px solid var(--border)", borderRadius: "var(--r-md)",
            maxHeight: "120px", minHeight: "40px",
          }}
        />
        <button onClick={send} aria-label={t.miSend}
          disabled={disabled || sending || (!text.trim() && !attach)}
          className="w-10 h-10 flex items-center justify-center rounded-lg flex-shrink-0 disabled:opacity-40"
          style={{ background: "var(--gold)", color: "#131312" }}>
          {sending ? <Spinner size="xs" color="#131312" /> : <Send size={14} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}

// ── Conversation modal — centered card on desktop, full-screen sheet on mobile
//
// Used by candidates as their primary chat view, and by admin once they pick
// a conversation from the inbox dropdown. Sized so it never feels cramped on
// a phone.

function ThreadModal({
  title, subtitle, msgs, mineRole, scrollRef, onSend, onClose, lang,
  otherInitial, otherName, ownInitial, ownName, verifiedOther, isAdminOther,
  otherAvatarUrl, ownAvatarUrl, otherBadgeColor,
}: {
  title: string;
  subtitle?: string;
  msgs: Msg[];
  mineRole: Role;                                      // which side renders as "mine" (right-aligned)
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onSend: (text: string, attachment: string | null) => Promise<void>;
  onClose: () => void;
  lang: string;
  otherInitial: string; otherName: string;
  ownInitial: string;   ownName: string;
  /** Show the verified badge next to the other party's name in the header */
  verifiedOther?: boolean;
  /** true = Borivon admin badge (starburst + "Official"), false = candidate badge */
  isAdminOther?: boolean;
  /** Actual photo URL for the other party (candidate photo or admin logo) */
  otherAvatarUrl?: string | null;
  /** Override badge color for the other party (e.g. "red" for org admins) */
  otherBadgeColor?: "gold" | "red" | "black";
  /** Actual photo URL for the current user (candidate photo or admin logo) */
  ownAvatarUrl?: string | null;
}) {
  const { t } = useLang();
  // Compact = passport-popup-sized (max-w-md ~448px / max-h 90vh).
  // Expanded = roomier chat window (max-w-2xl ~672px / max-h 95vh) — better
  // for long conversations. Persisted per-user so it sticks across sessions.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try { setExpanded(localStorage.getItem("bv-chat-expanded") === "1"); } catch { /* ignore */ }
  }, []);
  function toggleExpand() {
    setExpanded(v => {
      const next = !v;
      try { localStorage.setItem("bv-chat-expanded", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }

  // Lightbox state for image attachments.
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Auto-scroll behaviour:
  //   - On first open, snap to bottom (most recent message visible).
  //   - When NEW messages arrive, only scroll to bottom if the user was
  //     already near the bottom. If they scrolled up to read older messages
  //     we leave them there.
  const stickToBottomRef = useRef(true);
  const didInitialScrollRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!didInitialScrollRef.current && msgs.length > 0) {
      el.scrollTop = el.scrollHeight;
      didInitialScrollRef.current = true;
      return;
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.length]);

  // Update "stick to bottom" flag whenever the user scrolls. Re-run when
  // the modal opens (msgs.length changes from 0 → N) so the listener
  // attaches once the scrollable element is mounted — refs don't trigger
  // re-renders so we can't depend on `scrollRef.current` directly.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      stickToBottomRef.current = distance < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [msgs.length]);
  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const empty = lang === "fr" ? "Aucun message pour l'instant."
              : lang === "de" ? "Noch keine Nachrichten."
              : "No messages yet.";

  // Render through a portal to document.body. The MessageIcon lives inside
  // <Navbar>, which uses `backdrop-filter` (creates a containing block that
  // traps position:fixed descendants). Without a portal the modal would
  // position relative to the navbar instead of the viewport — pinned to the
  // top, header off-screen. Portal escapes that.
  if (typeof document === "undefined") return null;

  const expandLabel = expanded
    ? (lang === "fr" ? "Réduire" : lang === "de" ? "Verkleinern" : "Shrink")
    : (lang === "fr" ? "Agrandir" : lang === "de" ? "Vergrößern" : "Expand");

  const node = (
    <div className="fixed inset-x-0 bottom-0 top-[58px] sm:top-0 z-[1200] flex items-center justify-center p-2 sm:p-4 bv-thread-modal-outer"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise .22s var(--ease-out)" }}
      onClick={onClose}>
      {/* Mobile only: leave space for the bottom action bar so the modal
          becomes a true popup (navbar visible above, action bar visible
          below). The X button in the header naturally lands directly
          below the floating bug button in the navbar. */}
      <style>{`
        @media (max-width: 639.98px) {
          .bv-thread-modal-outer { padding-bottom: calc(0.5rem + 72px) !important; }
          .bv-thread-modal-card  {
            height: calc(100dvh - 58px - 0.5rem - 72px - 0.5rem) !important;
            max-height: calc(100dvh - 58px - 0.5rem - 72px - 0.5rem) !important;
          }
        }
      `}</style>
      <div className={`bv-thread-modal-card w-full overflow-hidden flex flex-col rounded-2xl ${expanded ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
        style={{
          background: "var(--card)", border: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          animation: "bvFadeRise .28s var(--ease-out)",
          transition: "max-width 200ms var(--ease), height 200ms var(--ease)",
        }}
        // Mobile: rounded popup that respects the top navbar AND the bottom
        // mobile action bar — height comes from the CSS rule above.
        // Desktop: compact (~600px) or expanded (~820px) centered card.
        ref={el => {
          if (!el) return;
          const isMobile = window.matchMedia("(max-width: 639.98px)").matches;
          if (isMobile) {
            // Height handled via .bv-thread-modal-card CSS rule
            el.style.borderRadius = "var(--r-2xl)";
          } else {
            el.style.height = expanded ? "min(92vh, 820px)" : "min(75vh, 600px)";
            el.style.borderRadius = "var(--r-2xl)";
          }
        }}
        onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}>
          {/* Expand / shrink toggle (left side, like Skool) — desktop only */}
          <button onClick={toggleExpand} aria-label={expandLabel} title={expandLabel}
            className="hidden sm:flex w-8 h-8 items-center justify-center rounded-lg flex-shrink-0 hover:scale-110"
            style={{ background: "transparent", color: "var(--w3)", border: "none", transition: "color 0.2s, transform 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--w)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--w3)"; }}>
            {expanded ? <Minimize2 size={13} strokeWidth={1.8} /> : <Maximize2 size={13} strokeWidth={1.8} />}
          </button>
          <Avatar initial={otherInitial} avatarUrl={otherAvatarUrl} isAdmin={mineRole === "candidate"} size={32} />
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold tracking-tight truncate inline-flex items-center gap-0.5" style={{ color: "var(--w)" }}>
              {title}
              {verifiedOther && <VerifiedBadge verified size="xs" isAdmin={!!isAdminOther} color={otherBadgeColor ?? (isAdminOther ? "black" : "gold")} />}
            </p>
            {subtitle && <p className="text-[11px] truncate" style={{ color: "var(--w3)" }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label={t.miClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 hover:scale-110"
            style={{ background: "transparent", color: "var(--w3)", border: "none", transition: "color 0.2s, transform 0.15s" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--w)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--w3)"; }}>
            <XIcon size={13} strokeWidth={1.8} />
          </button>
        </div>

        {/* ── Messages ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-3"
          style={{ background: "var(--bg)", overscrollBehavior: "contain", minHeight: 0 }}>
          {msgs.length === 0 ? (
            <p className="text-center text-[13px] mt-10 px-6" style={{ color: "var(--w3)" }}>{empty}</p>
          ) : (
            renderItems(msgs, lang, otherInitial, ownInitial, otherAvatarUrl, ownAvatarUrl, mineRole, setLightboxSrc)
          )}
        </div>

        {/* ── Compose ── */}
        <ComposeBar onSend={onSend} lang={lang} />
      </div>
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </div>
  );

  return createPortal(node, document.body);
}

// ── Inbox dropdown shell (admin only, conversations list) ────────────────────

function InboxDropdown({
  title, subtitle, children, onClose,
}: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void }) {
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 639.98px)").matches;

  if (isMobile && typeof document !== "undefined") {
    return createPortal(
      <>
        <div className="fixed inset-0" style={{ zIndex: 1299, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }} onClick={onClose} />
        <div className="fixed bottom-0 left-0 right-0 flex flex-col rounded-t-[22px]"
          style={{ zIndex: 1300, background: "var(--card)", border: "1px solid var(--border)", borderBottom: "none", boxShadow: "0 -12px 40px rgba(0,0,0,0.32)", animation: "bvSlideUp 0.28s var(--ease-out)", maxHeight: "80dvh", overflow: "hidden" }}>
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-pointer" onClick={onClose}>
            <div className="w-9 h-1 rounded-full" style={{ background: "var(--border2)" }} />
          </div>
          <div className="px-5 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{title}</p>
            {subtitle && <p className="text-[11px] mt-0.5" style={{ color: "var(--w3)" }}>{subtitle}</p>}
          </div>
          <div className="overflow-y-auto flex-1" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            {children}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  return (
    <div className="absolute right-0 rounded-2xl overflow-hidden z-[700] flex flex-col"
      style={{
        top: "calc(100% + 8px)",
        background: "var(--card)",
        border: "1px solid var(--border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
        maxHeight: 520,
        animation: "bvFadeRise .22s var(--ease-out)",
      }}>
      <div className="w-[360px] flex flex-col" style={{ maxHeight: "inherit" }}>
        <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-semibold tracking-tight truncate" style={{ color: "var(--w)" }}>{title}</p>
            {subtitle && <p className="text-[10.5px] truncate" style={{ color: "var(--w3)" }}>{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Candidate side ───────────────────────────────────────────────────────────

// Fallback logo when the admin has no profile photo uploaded.
const ADMIN_LOGO_URL = "/favicon.png";

function CandidateChat({ accessToken, userId }: { accessToken: string; userId: string }) {
  const { lang, t } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Same two-stage flow as admin: dropdown list first, then modal.
  const [inboxOpen, setInboxOpen] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [unread, setUnread] = useState(0);
  // Candidate's own display name and profile photo.
  const [candidateName, setCandidateName] = useState("You");
  const [candidatePhoto, setCandidatePhoto] = useState<string | null>(null);
  // Admin's profile photo (real upload or fallback logo).
  const [adminPhoto, setAdminPhoto] = useState<string>(ADMIN_LOGO_URL);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data?.user) return;
      const meta = data.user.user_metadata as Record<string, unknown> | undefined;
      const fn = meta && typeof meta.full_name === "string" ? meta.full_name : "";
      const fallback = data.user.email ?? "You";
      setCandidateName(fn || fallback);
    });
    // Fetch the candidate's own photo and the admin's photo in parallel.
    fetch("/api/portal/me/profile-photo", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j?.photo) setCandidatePhoto(j.photo); })
      .catch(() => {});
    fetch("/api/portal/admin-photo", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j?.photo) setAdminPhoto(j.photo); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accessToken]);

  // Keep candidatePhoto in sync when CV builder updates the photo — same
  // mechanism as ProfileIcon in the navbar so all avatars change at once.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ photo: string | null }>).detail;
      setCandidatePhoto(detail.photo ?? null);
    };
    window.addEventListener("bv-profile-photo-changed", onChange);
    return () => window.removeEventListener("bv-profile-photo-changed", onChange);
  }, []);

  const candidateInitial = (candidateName || "?").charAt(0).toUpperCase();

  const fetchMsgs = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/messages", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return;
      const json = await res.json();
      const next: Msg[] = json.messages ?? [];
      setMsgs(next);
      setUnread(next.filter(m => m.sender_role === "admin" && !m.read_by_candidate).length);
    } catch { /* offline / hot-reload */ }
  }, [accessToken]);

  useEffect(() => { fetchMsgs(); const t = setInterval(fetchMsgs, 30_000); return () => clearInterval(t); }, [fetchMsgs]);

  // Live updates via Supabase Realtime (RLS lets candidate subscribe to own thread).
  useEffect(() => {
    let cancelled = false;
    const channel = supabase
      // Per-user channel name so two simultaneous mounts (e.g. dev hot-reload
      // or a future preview view) won't collide on the same global key.
      .channel(`messages-candidate-${userId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "messages" },
        () => { if (!cancelled) fetchMsgs(); },
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [fetchMsgs, userId]);

  // Refetch on focus / visibility regain.
  useEffect(() => {
    const onFocus = () => fetchMsgs();
    const onVis = () => { if (document.visibilityState === "visible") fetchMsgs(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchMsgs]);

  // Click-outside / Esc → close the inbox dropdown via shared hook.
  // skipMobile=true: the mobile portal backdrop handles dismissal itself.
  // We gate on `inboxOpen && !threadOpen` so the listener detaches while the
  // thread modal is open (its own Esc handler takes over).
  useDismiss(ref, inboxOpen && !threadOpen, () => setInboxOpen(false), { skipMobile: true });

  function openThread() {
    // Optimistic: clear unread + mark local admin messages as read.
    setInboxOpen(false);
    setThreadOpen(true);
    if (unread > 0) {
      setUnread(0);
      setMsgs(prev => prev.map(m => m.sender_role === "admin" ? { ...m, read_by_candidate: true } : m));
      fetch("/api/portal/messages", { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}` } });
    }
  }

  // While the modal is OPEN, fast-poll as a Realtime fallback.
  useEffect(() => {
    if (!threadOpen) return;
    const t = setInterval(fetchMsgs, 2_000);
    return () => clearInterval(t);
  }, [threadOpen, fetchMsgs]);

  // Auto-scroll behaviour is handled inside ThreadModal — keeps the user's
  // scroll position when they scroll up, only sticks to bottom when they're
  // already at the bottom.

  async function send(text: string, attachment: string | null) {
    const res = await fetch("/api/portal/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ body: text, attachment }),
    });
    if (!res.ok) {
      // Surface failure to ComposeBar so the message stays in the input and
      // the user sees an error instead of a silent reset.
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || `Send failed (${res.status})`);
    }
    await fetchMsgs();
  }

  const title = lang === "fr" ? "Messages" : lang === "de" ? "Nachrichten" : "Messages";
  const teamName = "Youness Taoufiq";

  // Build a single fake "conversation" row from the candidate's thread so the
  // list dropdown looks like the admin's. Last message preview = last msg body.
  const last = msgs[msgs.length - 1];
  const lastBody = last?.body ?? "";
  const lastAt = last?.created_at ?? new Date(0).toISOString();
  const hasAttachment = !!last?.attachment;
  const lastSender: Role = last?.sender_role ?? "admin";

  const startConversation = lang === "fr" ? "Démarrer une conversation"
                          : lang === "de" ? "Konversation starten"
                          : "Start a conversation";

  return (
    <>
      <div ref={ref} className="relative">
        <ChatIconBtn unread={unread} open={inboxOpen} onClick={() => setInboxOpen(o => !o)} label={title} />
        {inboxOpen && !threadOpen && (
          <InboxDropdown title={title} onClose={() => setInboxOpen(false)}>
            <div className="overflow-y-auto" style={{ background: "var(--bg)", maxHeight: 460 }}>
              <button onClick={openThread}
                className="bv-row-hover w-full text-left px-3.5 py-3 flex items-center gap-2.5 transition-colors">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={adminPhoto} alt="Borivon"
                  className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                  style={{ border: `1px solid ${unread > 0 ? "var(--border-gold)" : "var(--border)"}` }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold truncate inline-flex items-center" style={{ color: "var(--w)" }}>
                      {teamName}<VerifiedBadge verified size="xs" isAdmin title="Borivon" color="black" />
                    </p>
                    {last && <span className="text-[9.5px] flex-shrink-0" style={{ color: "var(--w3)" }}>{relativeTime(lastAt, lang)}</span>}
                  </div>
                  <p className="text-[11px] truncate flex items-center gap-1 mt-0.5"
                    style={{ color: unread > 0 ? "var(--w2)" : "var(--w3)", fontWeight: unread > 0 ? 500 : 400 }}>
                    {!last ? (
                      <span className="truncate" style={{ color: "var(--w3)" }}>{startConversation}</span>
                    ) : (
                      <>
                        {lastSender === "candidate" && <span style={{ color: "var(--w3)", flexShrink: 0 }}>{lang === "fr" ? "Vous : " : lang === "de" ? "Sie: " : "You: "}</span>}
                        <span className="truncate">{hasAttachment && !lastBody ? `📎 ${t.miImage}` : (lastBody || "—")}</span>
                      </>
                    )}
                  </p>
                </div>
                {unread > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[9.5px] font-bold flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--gold)", color: "#131312" }}>
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
            </div>
          </InboxDropdown>
        )}
      </div>
      {threadOpen && (
        <ThreadModal
          title={teamName}
          msgs={msgs} mineRole="candidate"
          scrollRef={scrollRef}
          onSend={send}
          onClose={() => setThreadOpen(false)}
          lang={lang}
          otherInitial="B"        otherName={teamName}
          ownInitial={candidateInitial} ownName={candidateName}
          otherAvatarUrl={adminPhoto}
          ownAvatarUrl={candidatePhoto}
          verifiedOther isAdminOther
        />
      )}
    </>
  );
}

// ── Admin side ───────────────────────────────────────────────────────────────

function AdminInbox({ accessToken }: { accessToken: string }) {
  const { lang, t } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [convs, setConvs] = useState<AdminConversation[]>([]);
  const [activeThread, setActiveThread] = useState<AdminConversation | null>(null);
  const [threadMsgs, setThreadMsgs] = useState<Msg[]>([]);
  const [ownPhoto, setOwnPhoto] = useState<string>(ADMIN_LOGO_URL);

  useEffect(() => {
    fetch("/api/portal/me/profile-photo", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.photo) setOwnPhoto(j.photo); })
      .catch(() => {});
  }, [accessToken]);

  const fetchConvs = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/admin/messages", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) return;
      const json = await res.json();
      setConvs(json.conversations ?? []);
    } catch { /* offline / hot-reload */ }
  }, [accessToken]);

  useEffect(() => { fetchConvs(); const t = setInterval(fetchConvs, 20_000); return () => clearInterval(t); }, [fetchConvs]);

  useEffect(() => {
    const onFocus = () => fetchConvs();
    const onVis   = () => { if (document.visibilityState === "visible") fetchConvs(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchConvs]);

  // Click-outside / Escape close the INBOX dropdown (the thread modal handles
  // its own close — Esc / X / backdrop click).
  // On mobile the portal backdrop handles dismissal — no mousedown listener needed.
  // Click-outside / Esc → close the admin inbox via shared hook.
  // skipMobile=true: mobile portal backdrop owns dismissal.
  // Detaches while a thread modal is open (its own Esc takes over).
  useDismiss(ref, inboxOpen && !activeThread, () => setInboxOpen(false), { skipMobile: true });

  // Fast-poll the inbox list while it's open.
  useEffect(() => {
    if (!inboxOpen || activeThread) return;
    const t = setInterval(fetchConvs, 3_000);
    return () => clearInterval(t);
  }, [inboxOpen, activeThread, fetchConvs]);

  const fetchThread = useCallback(async (uid: string) => {
    try {
      const res = await fetch(`/api/portal/admin/messages?threadUserId=${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      setThreadMsgs(json.messages ?? []);
    } catch { /* offline / hot-reload */ }
  }, [accessToken]);

  // When activeThread is opened, fetch + mark read.
  useEffect(() => {
    if (!activeThread) return;
    fetchThread(activeThread.threadUserId);
    fetch("/api/portal/admin/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ threadUserId: activeThread.threadUserId }),
    }).then(fetchConvs);
  }, [activeThread, fetchThread, accessToken, fetchConvs]);

  // Fast-poll the active thread.
  useEffect(() => {
    if (!activeThread) return;
    const uid = activeThread.threadUserId;
    const t = setInterval(() => { fetchThread(uid); fetchConvs(); }, 1_500);
    return () => clearInterval(t);
  }, [activeThread, fetchThread, fetchConvs]);

  // Auto-scroll behaviour lives inside ThreadModal so the user's scroll
  // position is preserved when they read older messages.

  function pickConversation(c: AdminConversation) {
    // Optimistic: zero this conversation's unread count IMMEDIATELY so the
    // bell badge & inbox row clear on click — no waiting for the PATCH.
    setConvs(prev => prev.map(x => x.threadUserId === c.threadUserId ? { ...x, unread: 0 } : x));
    setInboxOpen(false);
    setActiveThread({ ...c, unread: 0 });
  }

  async function reply(text: string, attachment: string | null) {
    if (!activeThread) return;
    const res = await fetch("/api/portal/admin/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ threadUserId: activeThread.threadUserId, body: text, attachment }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || `Send failed (${res.status})`);
    }
    await fetchThread(activeThread.threadUserId);
    await fetchConvs();
  }

  function closeThread() {
    setActiveThread(null);
    fetchConvs();
  }

  const totalUnread = convs.reduce((sum, c) => sum + c.unread, 0);
  const titleList = lang === "fr" ? "Boîte de réception" : lang === "de" ? "Posteingang" : "Inbox";

  return (
    <>
      <div ref={ref} className="relative">
        <ChatIconBtn unread={totalUnread} open={inboxOpen} onClick={() => setInboxOpen(o => !o)} label={titleList} />
        {inboxOpen && !activeThread && (
          <InboxDropdown title={titleList} onClose={() => setInboxOpen(false)}
            subtitle={convs.length > 0
              ? (lang === "fr" ? `${convs.length} conversation${convs.length !== 1 ? "s" : ""}` : lang === "de" ? `${convs.length} Konversation${convs.length !== 1 ? "en" : ""}` : `${convs.length} conversation${convs.length !== 1 ? "s" : ""}`)
              : undefined}>
            <ConversationList convs={convs} onPick={pickConversation} lang={lang} />
          </InboxDropdown>
        )}
      </div>
      {activeThread && (
        <ThreadModal
          // key on threadUserId so refs reset between conversations.
          key={activeThread.threadUserId}
          title={activeThread.name}
          subtitle={activeThread.email}
          msgs={threadMsgs}
          mineRole="admin"
          scrollRef={scrollRef}
          onSend={reply}
          onClose={closeThread}
          lang={lang}
          otherInitial={(activeThread.name || activeThread.email || "?").charAt(0).toUpperCase()}
          otherName={activeThread.name || activeThread.email}
          ownInitial="B"
          ownName="Youness Taoufiq"
          otherAvatarUrl={activeThread.photoUrl ?? null}
          ownAvatarUrl={ownPhoto}
          verifiedOther={!!activeThread.verified}
          otherBadgeColor={activeThread.isOrgMember ? "red" : "gold"}
        />
      )}
    </>
  );
}


function ConversationList({
  convs, onPick, lang,
}: { convs: AdminConversation[]; onPick: (c: AdminConversation) => void; lang: string }) {
  const { t } = useLang();
  if (convs.length === 0) {
    return (
      <div className="px-6 py-10 text-center" style={{ background: "var(--bg)" }}>
        <p className="text-[12px]" style={{ color: "var(--w3)" }}>
          {lang === "fr" ? "Aucune conversation pour l'instant." : lang === "de" ? "Noch keine Konversationen." : "No conversations yet."}
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-y-auto" style={{ background: "var(--bg)", maxHeight: 460 }}>
      {convs.map((c, i) => (
        <button key={c.threadUserId}
          onClick={() => onPick(c)}
          className="bv-row-hover w-full text-left px-3.5 py-3 flex items-center gap-2.5 transition-colors"
          style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
          {c.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.photoUrl} alt={(c.name || c.email).charAt(0)}
              className="w-9 h-9 rounded-full object-cover flex-shrink-0"
              style={{ border: `1px solid ${c.unread > 0 ? "var(--border-gold)" : "var(--border)"}` }} />
          ) : (
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12.5px] font-bold flex-shrink-0"
              style={{
                background: c.unread > 0 ? "var(--gdim)" : "var(--bg2)",
                color: c.unread > 0 ? "var(--gold)" : "var(--w3)",
                border: `1px solid ${c.unread > 0 ? "var(--border-gold)" : "var(--border)"}`,
              }}>
              {(c.name || c.email).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold truncate inline-flex items-center gap-0.5" style={{ color: "var(--w)" }}>
                {c.name}
                <VerifiedBadge verified={!!c.verified} size="xs" color={c.isOrgMember ? "red" : "gold"} />
              </p>
              <span className="text-[9.5px] flex-shrink-0" style={{ color: "var(--w3)" }}>{relativeTime(c.lastAt, lang)}</span>
            </div>
            <p className="text-[11px] truncate flex items-center gap-1 mt-0.5"
              style={{ color: c.unread > 0 ? "var(--w2)" : "var(--w3)", fontWeight: c.unread > 0 ? 500 : 400 }}>
              {c.lastKind === "bug" && <Bug size={10} strokeWidth={2.2} style={{ color: "var(--danger)", flexShrink: 0 }} />}
              {c.lastSender === "admin" && <span style={{ color: "var(--w3)", flexShrink: 0 }}>{lang === "fr" ? "Vous : " : lang === "de" ? "Sie: " : "You: "}</span>}
              <span className="truncate">{c.hasAttachment && !c.lastBody ? `📎 ${t.miImage}` : (c.lastBody || "—")}</span>
            </p>
          </div>
          {c.unread > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[9.5px] font-bold flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--gold)", color: "#131312" }}>
              {c.unread > 9 ? "9+" : c.unread}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
