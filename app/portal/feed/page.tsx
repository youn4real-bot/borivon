"use client";

/**
 * /portal/feed — Community feed
 *
 * Required Supabase SQL (run once):
 *   ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS title TEXT CHECK (char_length(title) <= 100);
 *   ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
 *   ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS gif_url TEXT;
 *   ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
 *
 *   CREATE TABLE IF NOT EXISTS feed_comment_likes (
 *     comment_id UUID NOT NULL REFERENCES feed_comments(id) ON DELETE CASCADE,
 *     user_id UUID NOT NULL,
 *     PRIMARY KEY (comment_id, user_id)
 *   );
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { tickColor, tickAccent, type TickColor } from "@/lib/roleTick";
import { Heart, MessageCircle, Trash2, Send, Loader2, Pin, ImagePlus, Smile, Link2, ChevronUp, Sparkles, X } from "lucide-react";
import { relativeTime } from "@/lib/relativeTime";

// ── Categories ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { value: "general",  emoji: "💬", label: { fr: "Général",     en: "General",    de: "Allgemein"   } },
  { value: "progress", emoji: "🏆", label: { fr: "Progrès",     en: "Progress",   de: "Fortschritt" } },
  { value: "question", emoji: "❓", label: { fr: "Question",    en: "Question",   de: "Frage"       } },
  { value: "tip",      emoji: "💡", label: { fr: "Conseil",     en: "Tip",        de: "Tipp"        } },
] as const;
type Category = typeof CATEGORIES[number]["value"];

// ── Types ─────────────────────────────────────────────────────────────────────
type Author = {
  name: string; email: string; photo: string | null;
  verified: boolean; tier: string | null; isBorivonTeam: boolean;
  isSuperAdmin: boolean; isOrgMember: boolean;
};
type Post = {
  id: string; title: string | null; content: string; category: string;
  imageUrl: string | null; gifUrl: string | null;
  pinned: boolean; createdAt: string;
  author: Author; authorId: string; isOwn: boolean;
  likeCount: number; commentCount: number; likedByMe: boolean;
  commenterAvatars: { photo: string | null; name: string }[];
};
type Comment = {
  id: string; content: string; createdAt: string;
  authorId: string; authorName: string; authorPhoto: string | null;
  authorVerified: boolean; isBorivonTeam: boolean; isOwn: boolean;
  likeCount: number; likedByMe: boolean;
  isSuperAdmin: boolean; isOrgMember: boolean;
};

// ── Translations ──────────────────────────────────────────────────────────────
const T = {
  fr: {
    placeholder: "Qu'est-ce que vous avez en tête ?",
    titlePlaceholder: "Titre du post",
    post: "Publier", posting: "Publication…",
    addPhoto: "Photo", addGif: "GIF", addVideo: "Vidéo",
    gifSearchPlaceholder: "Rechercher un GIF…",
    gifTrending: "Tendances", gifPoweredBy: "Propulsé par GIPHY",
    videoUrlPlaceholder: "URL YouTube ou Loom",
    noPostsTitle: "Aucune publication", noPostsSub: "Soyez le premier à partager !",
    like: "J'aime", comment: "Commenter", deletePost: "Supprimer",
    writeComment: "Écrire un commentaire…", send: "Envoyer",
    reply: "Répondre", replyingTo: "Répondre à",
    showComments: (n: number) => n === 1 ? "1 commentaire" : `${n} commentaires`,
    hideComments: "Masquer",
    borivonTeam: "Youness Taoufiq",
    loadMore: "Voir plus", loadingMore: "Chargement…",
    confirmDelete: "Supprimer cette publication ?",
    pinPost: "Épingler", unpinPost: "Désépingler", pinnedBadge: "Épinglé",
    filterAll: "Tout",
    newPosts: (n: number) => n === 1 ? "1 nouveau post" : `${n} nouveaux posts`,
    titleRequired: "Le titre est obligatoire",
    categoryLabel: "Catégorie",
  },
  en: {
    placeholder: "What's on your mind?",
    titlePlaceholder: "Post title",
    post: "Post", posting: "Posting…",
    addPhoto: "Photo", addGif: "GIF", addVideo: "Video",
    gifSearchPlaceholder: "Search for a GIF…",
    gifTrending: "Trending", gifPoweredBy: "Powered by GIPHY",
    videoUrlPlaceholder: "YouTube or Loom URL",
    noPostsTitle: "No posts yet", noPostsSub: "Be the first to share something!",
    like: "Like", comment: "Comment", deletePost: "Delete",
    writeComment: "Write a comment…", send: "Send",
    reply: "Reply", replyingTo: "Replying to",
    showComments: (n: number) => n === 1 ? "1 comment" : `${n} comments`,
    hideComments: "Hide",
    borivonTeam: "Youness Taoufiq",
    loadMore: "Load more", loadingMore: "Loading…",
    confirmDelete: "Delete this post?",
    pinPost: "Pin", unpinPost: "Unpin", pinnedBadge: "Pinned",
    filterAll: "All",
    newPosts: (n: number) => n === 1 ? "1 new post" : `${n} new posts`,
    titleRequired: "Title is required",
    categoryLabel: "Category",
  },
  de: {
    placeholder: "Was haben Sie auf dem Herzen?",
    titlePlaceholder: "Titel des Beitrags",
    post: "Posten", posting: "Wird gepostet…",
    addPhoto: "Foto", addGif: "GIF", addVideo: "Video",
    gifSearchPlaceholder: "GIF suchen…",
    gifTrending: "Trends", gifPoweredBy: "Unterstützt von GIPHY",
    videoUrlPlaceholder: "YouTube- oder Loom-URL",
    noPostsTitle: "Noch keine Beiträge", noPostsSub: "Seien Sie der Erste!",
    like: "Gefällt mir", comment: "Kommentieren", deletePost: "Löschen",
    writeComment: "Kommentar schreiben…", send: "Senden",
    reply: "Antworten", replyingTo: "Antwort an",
    showComments: (n: number) => n === 1 ? "1 Kommentar" : `${n} Kommentare`,
    hideComments: "Verbergen",
    borivonTeam: "Youness Taoufiq",
    loadMore: "Mehr laden", loadingMore: "Laden…",
    confirmDelete: "Diesen Beitrag löschen?",
    pinPost: "Anheften", unpinPost: "Lösen", pinnedBadge: "Angeheftet",
    filterAll: "Alle",
    newPosts: (n: number) => n === 1 ? "1 neuer Beitrag" : `${n} neue Beiträge`,
    titleRequired: "Titel ist erforderlich",
    categoryLabel: "Kategorie",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoEmbed(text: string): { type: "youtube" | "loom"; id: string } | null {
  const yt = text.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: "youtube", id: yt[1] };
  const loom = text.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (loom) return { type: "loom", id: loom[1] };
  return null;
}

function getCategoryMeta(value: string, lang: string) {
  const cat = CATEGORIES.find(c => c.value === value) ?? CATEGORIES[0];
  return { emoji: cat.emoji, label: cat.label[lang as keyof typeof cat.label] ?? cat.label.en };
}

// ── Avatar ────────────────────────────────────────────────────────────────────
// Thin wrappers over the single source of truth (lib/roleTick). NOTE: black
// = Borivon TEAM (supreme admin OR sub-admin), so we key off isBorivonTeam,
// not isSuperAdmin — otherwise sub-admins would wrongly show the gold tick.
function deriveTickColor(isBorivonTeam: boolean | undefined, isOrgMember: boolean | undefined, verified: boolean): TickColor {
  return tickColor({ isBorivonTeam, isOrgAdmin: isOrgMember, candidateVerified: verified });
}

function derivePostAccent(isBorivonTeam: boolean, isOrgMember: boolean, verified: boolean) {
  return tickAccent(tickColor({ isBorivonTeam, isOrgAdmin: isOrgMember, candidateVerified: verified }));
}

function Avatar({ photo, name, size = 36, isBorivonTeam = false, tickColor = "default" }: {
  photo: string | null; name: string; size?: number; isBorivonTeam?: boolean;
  tickColor?: "gold" | "black" | "red" | "default";
}) {
  const initials = name.split(" ").map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
  const borderColor = tickColor === "red" ? "var(--danger)" : tickColor === "gold" ? "var(--gold)" : "var(--border)";
  if (tickColor === "black") return (
    <div className="flex-shrink-0 rounded-full"
      style={{ padding: 2, background: "linear-gradient(135deg,#4a4a4a 0%,#1c1c1e 40%,#000000 100%)", boxSizing: "content-box", alignSelf: "flex-start" }}>
      <div className="rounded-full overflow-hidden" style={{ width: size, height: size }}>
        {photo
          ? <img src={photo} alt={name} className="w-full h-full object-cover" />
          : <div className="w-full h-full rounded-full flex items-center justify-center font-bold"
              style={{ fontSize: Math.max(9, size * 0.3), background: "var(--gdim)", color: "var(--gold)" }}>
              {name.split(" ").map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("")}
            </div>
        }
      </div>
    </div>
  );
  if (photo) return (
    <div className="flex-shrink-0 rounded-full overflow-hidden"
      style={{ width: size, height: size, border: `2px solid ${borderColor}`, boxSizing: "content-box" }}>
      <img src={photo} alt={name} className="w-full h-full object-cover" />
    </div>
  );
  return (
    <div className="flex-shrink-0 rounded-full flex items-center justify-center font-bold"
      style={{
        width: size, height: size, fontSize: Math.max(9, size * 0.3),
        background: isBorivonTeam ? "var(--gdim)" : "var(--bg2)",
        border: `2px solid ${borderColor}`,
        color: isBorivonTeam ? "var(--gold)" : "var(--w2)",
      }}>
      {initials || "?"}
    </div>
  );
}

// ── Stacked commenter avatars ─────────────────────────────────────────────────
function CommenterAvatars({ avatars }: { avatars: { photo: string | null; name: string }[] }) {
  if (!avatars.length) return null;
  return (
    <div className="flex items-center" style={{ marginRight: 4 }}>
      {avatars.slice(0, 3).map((a, i) => (
        <div key={i} className="rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{ width: 18, height: 18, marginLeft: i === 0 ? 0 : -5, border: "1.5px solid var(--card)", zIndex: 3 - i, position: "relative", background: "var(--bg2)" }}>
          {a.photo
            ? <img src={a.photo} alt={a.name} className="w-full h-full object-cover" />
            : <span style={{ fontSize: 7, fontWeight: 700, color: "var(--w3)" }}>{a.name[0]?.toUpperCase() ?? "?"}</span>
          }
        </div>
      ))}
    </div>
  );
}

// ── Comments popup modal ──────────────────────────────────────────────────────
function CommentsModal({
  post, t, lang, isAdmin,
  flatComments, commentText, replyTo, commentsLoaded, sendingComment, commentError, likingComment,
  onClose, onLikeComment, onReply, onDeleteComment, onChangeText, onAddComment, onClearReply,
  inputRef,
}: {
  post: Post; t: typeof T["en"]; lang: string; isAdmin: boolean;
  flatComments: Array<{ c: Comment; isReply: boolean }>;
  commentText: string; replyTo: string | null;
  commentsLoaded: boolean;
  sendingComment: boolean; commentError: string | null;
  likingComment: Record<string, boolean>;
  onClose: () => void;
  onLikeComment: (id: string, liked: boolean, count: number) => void;
  onReply: (name: string) => void;
  onDeleteComment: (id: string) => void;
  onChangeText: (v: string) => void;
  onAddComment: () => void;
  onClearReply: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 top-[58px] z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] flex flex-col"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-lg)",
          maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <MessageCircle size={14} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0 }} />
            <span className="text-[13px] font-semibold truncate" style={{ color: "var(--w)" }}>
              {post.title ?? post.content.slice(0, 48)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 ml-2 w-7 h-7 flex items-center justify-center rounded-full transition-opacity hover:opacity-70"
            style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w3)", cursor: "pointer" }}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </div>

        {/* Comments list — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 0 }}>
          {!commentsLoaded ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} strokeWidth={1.8} className="animate-spin" style={{ color: "var(--gold)" }} />
            </div>
          ) : flatComments.length === 0 ? (
            <p className="text-center text-[12.5px] py-8" style={{ color: "var(--w3)" }}>{t.writeComment}</p>
          ) : (
            flatComments.map(item => (
              <div key={item.c.id} className={item.isReply ? "flex gap-2 ml-8 mt-1.5" : "flex gap-2"}>
                <Avatar photo={item.c.authorPhoto} name={item.c.authorName} size={item.isReply ? 22 : 28} isBorivonTeam={item.c.isBorivonTeam} tickColor={deriveTickColor(item.c.isBorivonTeam, item.c.isOrgMember, item.c.authorVerified)} />
                <div className="flex-1 min-w-0">
                  <div className="rounded-2xl px-3 py-2" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-[11.5px] font-semibold" style={{ color: "var(--w)" }}>{item.c.authorName}</span>
                      {(() => {
                        const tc = deriveTickColor(item.c.isBorivonTeam, item.c.isOrgMember, item.c.authorVerified);
                        return tc !== "default"
                          ? <VerifiedBadge verified size="xs" isAdmin={tc === "black"} color={tc} name={item.c.authorName} />
                          : null;
                      })()}
                    </div>
                    <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--w2)", wordBreak: "break-word" }}>{item.c.content}</p>
                  </div>
                  <div className="flex items-center gap-3 mt-1 ml-1">
                    <span className="text-[10px]" style={{ color: "var(--w3)" }}>{relativeTime(item.c.createdAt, lang)}</span>
                    <button onClick={() => onLikeComment(item.c.id, item.c.likedByMe, item.c.likeCount)} disabled={!!likingComment[item.c.id]}
                      className="flex items-center gap-1 text-[10px] font-medium transition-all hover:opacity-70"
                      style={{ color: item.c.likedByMe ? "var(--danger)" : "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                      <Heart size={10} strokeWidth={2} fill={item.c.likedByMe ? "var(--danger)" : "none"} />
                      {item.c.likeCount > 0 && <span>{item.c.likeCount}</span>}
                    </button>
                    <button onClick={() => onReply(item.c.authorName)}
                      className="text-[10px] font-semibold hover:opacity-70 transition-opacity"
                      style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                      {t.reply}
                    </button>
                    {(item.c.isOwn || isAdmin) && (
                      <button onClick={() => onDeleteComment(item.c.id)}
                        className="text-[10px] hover:opacity-70 transition-opacity"
                        style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                        {t.deletePost}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input — sticky at bottom */}
        <div className="px-4 pb-4 pt-2 flex-shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
          {replyTo && (
            <div className="flex items-center gap-1.5 mb-1.5 ml-1">
              <span className="text-[10.5px]" style={{ color: "var(--w3)" }}>
                {t.replyingTo} <span className="font-semibold" style={{ color: "var(--gold)" }}>@{replyTo}</span>
              </span>
              <button onClick={onClearReply}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--w3)", lineHeight: 1, padding: 0 }}>
                ×
              </button>
            </div>
          )}
          <div className="flex gap-2.5">
            <div className="flex-1 flex items-center gap-1.5 rounded-full px-3 py-1.5"
              style={{ background: "var(--bg2)", border: `1px solid ${replyTo ? "var(--gold)" : "var(--border)"}`, transition: "border-color var(--dur-1) var(--ease)" }}>
              <input ref={inputRef} value={commentText} onChange={e => onChangeText(e.target.value.slice(0, 300))}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onAddComment(); } }}
                placeholder={replyTo ? `${t.replyingTo} @${replyTo}…` : t.writeComment}
                className="flex-1 text-[10px] outline-none bg-transparent" style={{ color: "var(--w)", border: "none" }}
                autoFocus
              />
              <button onClick={onAddComment} disabled={!commentText.trim() || sendingComment}
                style={{ background: "transparent", border: "none", cursor: commentText.trim() ? "pointer" : "default", color: commentText.trim() ? "var(--gold)" : "var(--w3)", transition: "color var(--dur-1) var(--ease)" }}>
                {sendingComment ? <Loader2 size={13} strokeWidth={2} className="animate-spin" /> : <Send size={13} strokeWidth={2} />}
              </button>
            </div>
          </div>
          {commentError && (
            <p role="alert" aria-live="assertive" className="text-[11px] mt-1.5 ml-1" style={{ color: "var(--danger)" }}>
              {commentError}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Post card ─────────────────────────────────────────────────────────────────
function PostCard({
  post, authToken, t, lang, isAdmin,
  onLike, onDelete, onPin, onCommentAdded,
}: {
  post: Post; authToken: string; t: typeof T["en"]; lang: string;
  isAdmin: boolean;
  onLike: (id: string, liked: boolean, count: number) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onCommentAdded: (id: string, photo: string | null, name: string) => void;
}) {
  const { t: gT } = useLang();
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [sendingComment, setSendingComment] = useState(false);

  const [pinning, setPinning] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [likingComment, setLikingComment] = useState<Record<string, boolean>>({});
  const commentInputRef = useRef<HTMLInputElement>(null);

  const videoEmbed = extractVideoEmbed(post.content);

  const loadComments = useCallback(async () => {
    if (commentsLoaded) return;
    try {
      const res = await fetch(`/api/portal/feed/${post.id}/comments`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) { const j = await res.json().catch(() => ({})); setComments(j.comments ?? []); setCommentsLoaded(true); }
    } catch { /* offline */ }
  }, [post.id, authToken, commentsLoaded]);

  const handleCloseComments = () => {
    setShowComments(false);
    setReplyTo(null);
    setCommentText("");
  };

  const toggleComments = () => {
    if (!showComments) {
      setShowComments(true);
      if (!commentsLoaded) loadComments();
    } else {
      handleCloseComments();
    }
  };

  const handleLike = () => {
    const optimisticLiked = !post.likedByMe;
    const optimisticCount = post.likeCount + (optimisticLiked ? 1 : -1);
    onLike(post.id, optimisticLiked, optimisticCount);
    fetch(`/api/portal/feed/${post.id}/like`, { method: "POST", headers: { Authorization: `Bearer ${authToken}` } })
      .then(res => res.ok ? res.json() : null)
      .then(j => { if (j) onLike(post.id, j.liked, j.likeCount); });
  };

  const handleLikeComment = async (commentId: string, currentlyLiked: boolean, currentCount: number) => {
    if (likingComment[commentId]) return; // double-click guard per-comment
    setLikingComment(prev => ({ ...prev, [commentId]: true }));
    try {
    const res = await fetch(`/api/portal/feed/${post.id}/comments`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ commentId }),
    });
    if (res.ok) {
      const j = await res.json();
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, likedByMe: j.liked, likeCount: j.likeCount } : c));
    } else {
      // optimistic fallback if table doesn't exist yet
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, likedByMe: !currentlyLiked, likeCount: currentCount + (currentlyLiked ? -1 : 1) } : c));
    }
    } finally {
      setLikingComment(prev => { const n = { ...prev }; delete n[commentId]; return n; });
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || sendingComment) return;
    setSendingComment(true);
    setCommentError(null);
    try {
      const res = await fetch(`/api/portal/feed/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ content: commentText.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setCommentError(j?.error || gT.fdPostFail);
        return;
      }
      const j = await res.json();
      setComments(c => [...c, j.comment]);
      setCommentsLoaded(true);
      setCommentText("");
      setReplyTo(null);
      onCommentAdded(post.id, j.comment.authorPhoto, j.comment.authorName);
    } catch {
      setCommentError(gT.fdNetErr);
    } finally { setSendingComment(false); }
  };

  const handleReply = (name: string) => {
    setReplyTo(name);
    const prefix = `@${name} `;
    setCommentText(prev => prev.startsWith(prefix) ? prev : prefix + prev.replace(/^@\S+ /, ""));
    if (!showComments) { toggleComments(); }
    setTimeout(() => { commentInputRef.current?.focus(); }, 80);
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const res = await fetch(`/api/portal/feed/${post.id}/comments?commentId=${commentId}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) setComments(c => c.filter(x => x.id !== commentId));
    } catch { /* offline */ }
  };

  const handlePin = async () => {
    if (pinning) return;
    setPinning(true);
    try {
      const res = await fetch(`/api/portal/feed/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ pinned: !post.pinned }),
      });
      if (res.ok) onPin(post.id, !post.pinned);
    } finally { setPinning(false); }
  };

  const commentCount = Math.max(post.commentCount, comments.length);

  // Build flat threaded list: @replies inserted right after the mentioned comment
  const flatComments: Array<{ c: Comment; isReply: boolean }> = [];
  comments.forEach(c => {
    const trimmed = c.content.trimStart();
    if (trimmed.charAt(0) === "@") {
      const mention = trimmed.slice(1).split(" ")[0].toLowerCase();
      for (let i = flatComments.length - 1; i >= 0; i--) {
        if (!flatComments[i].isReply) {
          const nm = flatComments[i].c.authorName;
          const first = nm.split(" ")[0].toLowerCase();
          const full  = nm.toLowerCase().split(" ").join("");
          if (first === mention || full === mention) {
            let idx = i + 1;
            while (idx < flatComments.length && flatComments[idx].isReply) idx++;
            flatComments.splice(idx, 0, { c, isReply: true });
            return;
          }
        }
      }
    }
    flatComments.push({ c, isReply: false });
  });

  const accent = derivePostAccent(post.author.isBorivonTeam, post.author.isOrgMember, post.author.verified);

  return (
    <>
    <div className="rounded-2xl overflow-hidden"
      style={{
        background: `linear-gradient(var(--card), var(--card)) padding-box,
                     linear-gradient(to bottom, ${accent.border} 0%, transparent 55%) border-box`,
        border: "1px solid transparent",
      }}>

      {/* Pinned banner */}
      {post.pinned && (
        <div className="px-4 py-2 flex items-center gap-1.5"
          style={{ background: "var(--gdim)", borderBottom: "1px solid var(--gdim)" }}>
          <span style={{ fontSize: 11 }}>📌</span>
          <span className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>{t.pinnedBadge}</span>
        </div>
      )}

      {/* Author-role accent line */}
      {!post.pinned && accent.line && (
        <div className="h-[2px]" style={{ background: accent.gradient }} />
      )}

      <div className="px-4 pt-4 pb-3">
        {/* Author row */}
        <div className="flex items-start gap-3 mb-3">
          <Avatar photo={post.author.photo} name={post.author.name} size={38} isBorivonTeam={post.author.isBorivonTeam} tickColor={deriveTickColor(post.author.isBorivonTeam, post.author.isOrgMember, post.author.verified)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{post.author.name}</span>
              {(() => {
                const tc = deriveTickColor(post.author.isBorivonTeam, post.author.isOrgMember, post.author.verified);
                return tc !== "default"
                  ? <VerifiedBadge verified size="xs" isAdmin={tc === "black"} color={tc} name={post.author.name} />
                  : null;
              })()}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px]" style={{ color: "var(--w3)" }}>{relativeTime(post.createdAt, lang)}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {isAdmin && (
              <button onClick={handlePin} disabled={pinning} title={post.pinned ? t.unpinPost : t.pinPost}
                className="p-1.5 rounded-lg transition-all hover:opacity-70"
                style={{ color: post.pinned ? "var(--gold)" : "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                <Pin size={13} strokeWidth={2} fill={post.pinned ? "var(--gold)" : "none"} />
              </button>
            )}
            {(post.isOwn || isAdmin) && (
              <button onClick={() => { if (window.confirm(t.confirmDelete)) onDelete(post.id); }}
                className="p-1.5 rounded-lg transition-all hover:opacity-70"
                style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                <Trash2 size={13} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>

        {/* Title */}
        {post.title && (
          <h2 className="text-[15px] font-bold mb-1.5 leading-snug" style={{ color: "var(--w)" }}>
            {post.title}
          </h2>
        )}

        {/* Content */}
        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap mb-3" style={{ color: "var(--w2)", wordBreak: "break-word" }}>
          {post.content}
        </p>

        {/* Photo */}
        {post.imageUrl && (
          <div className="rounded-xl overflow-hidden mb-3" style={{ maxHeight: 400 }}>
            <img src={post.imageUrl} alt="" className="w-full object-cover" style={{ maxHeight: 400 }} />
          </div>
        )}

        {/* GIF */}
        {post.gifUrl && (
          <div className="rounded-xl overflow-hidden mb-3" style={{ maxHeight: 320 }}>
            <img src={post.gifUrl} alt="GIF" className="w-full object-contain"
              style={{ maxHeight: 320, background: "var(--bg2)" }} />
          </div>
        )}

        {/* Video embed */}
        {videoEmbed && (
          <div className="rounded-xl overflow-hidden mb-3" style={{ aspectRatio: "16/9" }}>
            <iframe
              src={videoEmbed.type === "youtube" ? `https://www.youtube.com/embed/${videoEmbed.id}` : `https://www.loom.com/embed/${videoEmbed.id}`}
              className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen style={{ border: "none" }} />
          </div>
        )}

        {/* Actions — no divider, use padding */}
        <div className="flex items-center gap-3 pt-2">
          {/* Like */}
          <button onClick={handleLike}
            className="flex items-center gap-1.5 text-[12px] font-medium py-1 transition-all hover:opacity-80"
            style={{ color: post.likedByMe ? "var(--danger)" : "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
            <Heart size={15} strokeWidth={2} fill={post.likedByMe ? "var(--danger)" : "none"} />
            {post.likeCount > 0 && <span>{post.likeCount}</span>}
          </button>
          {/* Comment icon */}
          <button onClick={toggleComments}
            className="flex items-center gap-1.5 text-[12px] font-medium py-1 transition-all hover:opacity-80"
            style={{ color: showComments ? "var(--gold)" : "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
            <MessageCircle size={15} strokeWidth={2} />
            {commentCount > 0 && <span>{commentCount}</span>}
          </button>
          {/* Commenter avatars */}
          {post.commenterAvatars.length > 0 && (
            <button onClick={toggleComments}
              className="flex items-center py-1 transition-all hover:opacity-80"
              style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <CommenterAvatars avatars={post.commenterAvatars} />
            </button>
          )}
        </div>
      </div>

    </div>

    {showComments && (
      <CommentsModal
        post={post} t={t} lang={lang} isAdmin={isAdmin}
        flatComments={flatComments}
        commentText={commentText} replyTo={replyTo}
        commentsLoaded={commentsLoaded}
        sendingComment={sendingComment} commentError={commentError}
        likingComment={likingComment}
        onClose={handleCloseComments}
        onLikeComment={handleLikeComment}
        onReply={handleReply}
        onDeleteComment={handleDeleteComment}
        onChangeText={setCommentText}
        onAddComment={handleAddComment}
        onClearReply={() => { setReplyTo(null); setCommentText(""); }}
        inputRef={commentInputRef}
      />
    )}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FeedPage() {
  const router = useRouter();
  const { lang, t: gT } = useLang();
  const t = T[lang as keyof typeof T] ?? T.en;

  const [authToken, setAuthToken] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [userMeta, setUserMeta] = useState<{ name: string; photo: string | null; isBorivonTeam: boolean; isSuperAdmin: boolean; isOrgMember: boolean; verified: boolean }>({ name: "", photo: null, isBorivonTeam: false, isSuperAdmin: false, isOrgMember: false, verified: false });
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Communities — global Borivon community + every org community the user
  // can access. Org admins only see their own org. Candidates see Borivon
  // plus every org they're approved-linked to.
  type Community = { kind: "global" | "org"; id: string | null; name: string };
  const [communities, setCommunities] = useState<Community[]>([{ kind: "global", id: null, name: "Borivon" }]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  // Composer
  const [titleDraft, setTitleDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState("");
  const [gifResults, setGifResults] = useState<{ id: string; preview: string; url: string; title: string }[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const gifSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postsLoadError, setPostsLoadError] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch GIFs from Tenor whenever the picker opens or search query changes
  useEffect(() => {
    if (!showGifPicker || !authToken) return;
    if (gifSearchTimer.current) clearTimeout(gifSearchTimer.current);
    gifSearchTimer.current = setTimeout(async () => {
      setGifLoading(true);
      try {
        const q = gifSearch.trim();
        const url = q
          ? `/api/portal/feed/gifs?q=${encodeURIComponent(q)}`
          : `/api/portal/feed/gifs`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
        if (res.ok) {
          const j = await res.json();
          setGifResults(j.gifs ?? []);
        }
      } catch { /* offline */ }
      finally { setGifLoading(false); }
    }, gifSearch.trim() ? 400 : 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGifPicker, gifSearch, authToken]);

  // New posts banner
  const [pendingPosts, setPendingPosts] = useState<Post[]>([]);
  const postIdsRef = useRef<Set<string>>(new Set());

  // Session init — fires role check, profile, communities, and posts in
  // parallel so the feed reveals once with everything ready instead of the
  // old sequential-await chain that paid full latency for each step.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { router.replace("/portal"); return; }
      if (cancelled) return;

      const tk = session.access_token ?? "";
      setAuthToken(tk);

      // Fire the 3 independent fetches together. loadPosts needs activeOrgId
      // but the default org isn't known until communities resolves — so we
      // still fire it last, but in parallel with profile (which it doesn't
      // need either).
      const [roleResult, profileResult, communitiesResult] = await Promise.allSettled([
        fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } })
          .then(r => r.json().catch(() => ({ role: null })))
          .catch(() => ({ role: null })),
        supabase
          .from("candidate_profiles")
          .select("profile_photo, manually_verified")
          .eq("user_id", session.user.id)
          .maybeSingle(),
        fetch("/api/portal/feed/communities", { headers: { Authorization: `Bearer ${tk}` } })
          .then(r => r.ok ? r.json() as Promise<{ communities: Community[] }> : { communities: [] })
          .catch(() => ({ communities: [] as Community[] })),
      ]);

      if (cancelled) return;

      const role = roleResult.status === "fulfilled" ? (roleResult.value as { role: string | null }).role : null;
      const adminFlag = role === "admin" || role === "sub_admin";
      setIsAdmin(adminFlag);

      const profile = profileResult.status === "fulfilled"
        ? (profileResult.value.data as { profile_photo?: string | null; manually_verified?: boolean } | null)
        : null;
      const name = session.user.user_metadata?.full_name ?? session.user.email ?? "";
      const isSuperAdmin = role === "admin";
      const isOrgMember = role === "org_member";
      const selfVerified = adminFlag || (profile?.manually_verified ?? false);
      setUserMeta({ name, photo: profile?.profile_photo ?? null, isBorivonTeam: adminFlag, isSuperAdmin, isOrgMember, verified: selfVerified });

      const communities = communitiesResult.status === "fulfilled"
        ? (communitiesResult.value as { communities: Community[] }).communities
        : [];
      let firstOrgId: string | null = null;
      if (communities.length) {
        setCommunities(communities);
        firstOrgId = communities[0].id;
        setActiveOrgId(firstOrgId);
      }

      await loadPosts(tk, 0, firstOrgId);
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep postIds ref in sync for the new-posts banner
  useEffect(() => { postIdsRef.current = new Set(posts.map(p => p.id)); }, [posts]);

  // Poll for new posts every 90s
  useEffect(() => {
    if (!authToken) return;
    const timer = setInterval(async () => {
      if (!authToken) return;
      const orgParam = activeOrgId ? `&orgId=${encodeURIComponent(activeOrgId)}` : "";
      const res = await fetch(`/api/portal/feed?page=0${orgParam}`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!res.ok) return;
      const j = await res.json();
      const fresh = ((j.posts ?? []) as Post[]).filter(p => !postIdsRef.current.has(p.id));
      if (fresh.length > 0) setPendingPosts(fresh);
    }, 90_000);
    return () => clearInterval(timer);
  }, [authToken, activeOrgId]);

  // Reload when active community changes
  useEffect(() => {
    if (!authToken) return;
    setPosts([]);
    setPendingPosts([]);
    loadPosts(authToken, 0, activeOrgId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, authToken]);

  async function loadPosts(tk: string, p: number, orgId: string | null) {
    if (p === 0) setPostsLoadError(false);
    const orgParam = orgId ? `&orgId=${encodeURIComponent(orgId)}` : "";
    const res = await fetch(`/api/portal/feed?page=${p}${orgParam}`, { headers: { Authorization: `Bearer ${tk}` } });
    if (!res.ok) { if (p === 0) setPostsLoadError(true); return; }
    const j = await res.json();
    if (p === 0) setPosts(j.posts ?? []);
    else setPosts(prev => [...prev, ...(j.posts ?? [])]);
    setHasMore(j.hasMore ?? false);
    setPage(p);
  }

  const handlePost = async () => {
    if (!titleDraft.trim()) { setTitleError(true); return; }
    if (!draft.trim() || posting) return;
    setTitleError(false);
    setPostError(null);
    setPosting(true);
    try {
      const res = await fetch("/api/portal/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: titleDraft.trim(), content: draft.trim(), imageBase64, gifUrl, orgId: activeOrgId }),
      });
      if (res.ok) {
        const j = await res.json();
        setPosts(prev => [j.post, ...prev]);
        setTitleDraft(""); setDraft(""); setImageBase64(null); setImagePreview(null);
        setGifUrl(null); setShowGifPicker(false); setGifSearch(""); setGifResults([]); setShowVideoInput(false);
      } else {
        const j = await res.json().catch(() => ({}));
        setPostError(j.error ?? gT.fdPostFail);
      }
    } catch {
      setPostError(gT.fdNetErr);
    } finally { setPosting(false); }
  };

  const processImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = ev => { const b64 = ev.target?.result as string; setImageBase64(b64); setImagePreview(b64); setGifUrl(null); };
    reader.readAsDataURL(file);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    processImageFile(file);
    e.target.value = "";
  };

  const handleComposerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  };

  const handleLike = (id: string, liked: boolean, likeCount: number) =>
    setPosts(prev => prev.map(p => p.id === id ? { ...p, likedByMe: liked, likeCount } : p));

  const handleCommentAdded = (id: string, photo: string | null, name: string) =>
    setPosts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const alreadyShown = p.commenterAvatars.some(a => a.name === name);
      return {
        ...p,
        commentCount: p.commentCount + 1,
        commenterAvatars: alreadyShown ? p.commenterAvatars : p.commenterAvatars.length < 3 ? [...p.commenterAvatars, { photo, name }] : p.commenterAvatars,
      };
    }));

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/portal/feed/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) setPosts(prev => prev.filter(p => p.id !== id));
    } catch { /* offline */ }
  };

  const handlePin = (id: string, pinned: boolean) => {
    setPosts(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, pinned } : p);
      return [...updated].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    });
  };

  const draftVideoEmbed = extractVideoEmbed(draft);
  const canPost = !!titleDraft.trim() && !!draft.trim() && !posting;

  if (loading) return (
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 size={24} strokeWidth={1.8} className="animate-spin" style={{ color: "var(--gold)" }} />
      </div>
    </main>
  );

  return (
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[640px] mx-auto px-4 pt-5 pb-24 sm:px-6">

        {/* ── Composer ────────────────────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden mb-4"
          onDragOver={e => { e.preventDefault(); setDraggingOver(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingOver(false); }}
          onDrop={handleComposerDrop}
          style={{ background: "var(--card)", border: `1px solid ${draggingOver ? "var(--gold)" : titleError ? "var(--danger-border)" : "var(--border)"}`, transition: "border-color var(--dur-2) var(--ease)" }}>
          <div className="p-4">
            <div className="flex gap-3">
              <Avatar photo={userMeta.photo} name={userMeta.name} size={38} isBorivonTeam={userMeta.isBorivonTeam} tickColor={deriveTickColor(userMeta.isBorivonTeam, userMeta.isOrgMember, userMeta.verified)} />
              <div className="flex-1 min-w-0">
                {/* Required title */}
                <input
                  value={titleDraft}
                  onChange={e => { setTitleDraft(e.target.value.slice(0, 100)); setTitleError(false); }}
                  placeholder={t.titlePlaceholder}
                  className="w-full outline-none text-[11px] font-semibold bg-transparent leading-snug"
                  style={{ color: titleError ? "var(--danger)" : "var(--w)", border: "none", fontFamily: "inherit" }}
                />
                {titleError && (
                  <p className="text-[10.5px] mt-0.5 mb-1" style={{ color: "var(--danger)" }}>{t.titleRequired}</p>
                )}
                {/* Content */}
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value.slice(0, 500))}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePost(); }}
                  placeholder={t.placeholder}
                  rows={3}
                  className="w-full resize-none outline-none text-[11px] leading-relaxed bg-transparent mt-1"
                  style={{ color: "var(--w2)", border: "none", fontFamily: "inherit" }}
                />
                {draft.length > 400 && (
                  <p className="text-[11px] text-right" style={{ color: draft.length >= 500 ? "var(--danger)" : "var(--w3)" }}>{draft.length}/500</p>
                )}
              </div>
            </div>

            {/* Image preview */}
            {imagePreview && (
              <div className="relative mt-3 rounded-xl overflow-hidden" style={{ maxHeight: 260 }}>
                <img src={imagePreview} alt="" className="w-full object-cover" style={{ maxHeight: 260 }} />
                <button onClick={() => { setImageBase64(null); setImagePreview(null); }}
                  className="absolute top-2 right-2 rounded-full p-1.5"
                  style={{ background: "rgba(0,0,0,0.65)", border: "none", cursor: "pointer", color: "#fff" }}>
                  ×
                </button>
              </div>
            )}

            {/* GIF picker */}
            {showGifPicker && !gifUrl && (
              <div className="mt-3 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg2)" }}>
                {/* Search bar */}
                <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <Smile size={13} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0 }} />
                  <input
                    autoFocus
                    value={gifSearch}
                    onChange={e => setGifSearch(e.target.value)}
                    placeholder={t.gifSearchPlaceholder}
                    className="flex-1 text-[12px] outline-none bg-transparent"
                    style={{ color: "var(--w)", border: "none" }}
                  />
                  {gifSearch && (
                    <button onClick={() => setGifSearch("")} style={{ color: "var(--w3)", background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}>×</button>
                  )}
                </div>
                {/* Label */}
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--w3)" }}>
                  {gifSearch.trim() ? gifSearch : t.gifTrending}
                </p>
                {/* Grid */}
                <div className="px-2 pb-2" style={{ maxHeight: 220, overflowY: "auto" }}>
                  {gifLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 size={18} strokeWidth={1.8} className="animate-spin" style={{ color: "var(--gold)" }} />
                    </div>
                  ) : gifResults.length === 0 ? (
                    <p className="text-center text-[11px] py-6" style={{ color: "var(--w3)" }}>No GIFs found</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {gifResults.map(g => (
                        <button key={g.id} onClick={() => { setGifUrl(g.url); setShowGifPicker(false); }}
                          className="rounded-lg overflow-hidden aspect-square transition-opacity hover:opacity-80 active:scale-95"
                          style={{ background: "var(--border)", border: "none", padding: 0, cursor: "pointer" }}
                          title={g.title}>
                          <img src={g.preview} alt={g.title} className="w-full h-full object-cover" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Selected GIF preview */}
            {gifUrl && (
              <div className="mt-2 relative rounded-xl overflow-hidden" style={{ maxHeight: 220 }}>
                <img src={gifUrl} alt="GIF" className="w-full object-contain" style={{ maxHeight: 220, background: "var(--bg2)" }} />
                <button onClick={() => { setGifUrl(null); setShowGifPicker(true); }}
                  className="absolute top-2 right-2 rounded-full p-1.5"
                  style={{ background: "rgba(0,0,0,0.65)", border: "none", cursor: "pointer", color: "#fff" }}>
                  ×
                </button>
              </div>
            )}

            {/* Video input */}
            {showVideoInput && (
              <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                <Link2 size={13} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0 }} />
                <input
                  placeholder={t.videoUrlPlaceholder}
                  onChange={e => {
                    const url = e.target.value;
                    setDraft(d => {
                      const cleaned = d.replace(/\n?https?:\/\/\S+/g, "").trimEnd();
                      return url ? `${cleaned}\n${url}`.trim() : cleaned;
                    });
                  }}
                  className="flex-1 text-[12px] outline-none bg-transparent" style={{ color: "var(--w)", border: "none" }} />
              </div>
            )}
            {draftVideoEmbed && (
              <div className="mt-2 rounded-xl overflow-hidden" style={{ aspectRatio: "16/9" }}>
                <iframe src={draftVideoEmbed.type === "youtube" ? `https://www.youtube.com/embed/${draftVideoEmbed.id}` : `https://www.loom.com/embed/${draftVideoEmbed.id}`}
                  className="w-full h-full" allowFullScreen style={{ border: "none" }} />
              </div>
            )}
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 pb-3 gap-2"
            style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div className="flex items-center gap-0.5">
              <button onClick={() => fileRef.current?.click()} title={t.addPhoto}
                className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                style={{ color: imagePreview ? "var(--gold)" : undefined,
                         background: imagePreview ? "var(--gdim) !important" : undefined }}>
                <ImagePlus size={15} strokeWidth={1.7} />
              </button>
              <button onClick={() => { setShowGifPicker(s => !s); setShowVideoInput(false); }} title={t.addGif}
                className="bv-icon-btn h-9 px-2.5 flex items-center justify-center rounded-full text-[11px] font-bold tracking-wider"
                style={{ color: (showGifPicker || gifUrl) ? "var(--gold)" : undefined }}>
                GIF
              </button>
              <button onClick={() => { setShowVideoInput(s => !s); setShowGifPicker(false); }} title={t.addVideo}
                className="bv-icon-btn w-9 h-9 flex items-center justify-center rounded-full"
                style={{ color: showVideoInput ? "var(--gold)" : undefined }}>
                <Link2 size={14} strokeWidth={1.7} />
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageSelect} />
            </div>
            <div className="flex flex-col items-end gap-1">
              {postError && (
                <p className="text-[11px]" style={{ color: "var(--danger)" }}>{postError}</p>
              )}
              <button onClick={handlePost} disabled={!canPost || posting}
                className="flex items-center gap-2 text-[12px] font-semibold px-5 py-2 rounded-full transition-all active:scale-[0.97]"
                style={{
                  background: canPost ? "var(--gold)" : "transparent",
                  color: canPost ? "#131312" : "var(--w3)",
                  border: `1px solid ${canPost ? "var(--gold)" : "var(--border)"}`,
                  cursor: canPost && !posting ? "pointer" : "default",
                  transition: "all var(--dur-1) var(--ease)",
                }}>
                {posting ? <><Loader2 size={12} strokeWidth={2} className="animate-spin" />{t.posting}</> : t.post}
              </button>
            </div>
          </div>
        </div>

        {/* ── Community switcher ────────────────────────────────────────────
             Only renders when the user has more than one community accessible
             (e.g. a candidate linked to one org sees Borivon + their org).
             Org admins with only their own org see no tabs (single community
             is implicit). */}
        {communities.length > 1 && (
          <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}
            role="tablist" aria-label="Community">
            {communities.map(c => {
              const active = activeOrgId === c.id;
              const key = c.id ?? "global";
              return (
                <button key={key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveOrgId(c.id)}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full transition-all flex-shrink-0 tracking-tight"
                  style={{
                    background: active ? "var(--gold)" : "var(--card)",
                    color: active ? "#131312" : "var(--w2)",
                    border: `1px solid ${active ? "var(--gold)" : "var(--border)"}`,
                    cursor: "pointer",
                    boxShadow: active ? "var(--shadow-gold-sm)" : "none",
                  }}>
                  {c.kind === "global"
                    ? <span aria-hidden="true">★</span>
                    : <span aria-hidden="true" style={{ fontSize: 11 }}>🏢</span>}
                  {c.name}
                </button>
              );
            })}
          </div>
        )}



        {/* ── New posts banner ─────────────────────────────────────────────── */}
        {pendingPosts.length > 0 && (
          <button
            onClick={() => { setPosts(prev => { const ids = new Set(prev.map(p => p.id)); return [...pendingPosts.filter(p => !ids.has(p.id)), ...prev]; }); setPendingPosts([]); }}
            className="w-full flex items-center justify-center gap-2 mb-4 py-2.5 rounded-xl text-[12.5px] font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", cursor: "pointer" }}>
            <ChevronUp size={14} strokeWidth={2.5} />
            {t.newPosts(pendingPosts.length)}
          </button>
        )}

        {/* ── Posts ────────────────────────────────────────────────────────── */}
        {postsLoadError ? (
          <div className="text-center py-16">
            <p className="text-[14px] font-semibold mb-2" style={{ color: "var(--w2)" }}>
              {lang === "de" ? "Feed konnte nicht geladen werden." : lang === "fr" ? "Impossible de charger le fil." : "Could not load the feed."}
            </p>
            <button onClick={() => loadPosts(authToken, 0, activeOrgId)}
              className="text-[12.5px] font-medium px-4 py-1.5 rounded-full"
              style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              {lang === "de" ? "Erneut versuchen" : lang === "fr" ? "Réessayer" : "Try again"}
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16">
            <div className="flex justify-center mb-4">
              <Sparkles size={36} strokeWidth={1.5} style={{ color: "var(--gold)" }} />
            </div>
            <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--w)" }}>{t.noPostsTitle}</p>
            <p className="text-[13px]" style={{ color: "var(--w3)" }}>{t.noPostsSub}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map(post => (
              <PostCard key={post.id} post={post} authToken={authToken} t={t} lang={lang}
                isAdmin={isAdmin} onLike={handleLike} onDelete={handleDelete} onPin={handlePin} onCommentAdded={handleCommentAdded} />
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mt-6 text-center">
            <button onClick={async () => { setLoadingMore(true); await loadPosts(authToken, page + 1, activeOrgId); setLoadingMore(false); }}
              disabled={loadingMore}
              className="px-6 py-2.5 rounded-xl text-[13px] font-semibold transition-all hover:opacity-80"
              style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)", cursor: "pointer" }}>
              {loadingMore ? t.loadingMore : t.loadMore}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
