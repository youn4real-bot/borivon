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
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { Heart, MessageCircle, Trash2, Send, Loader2, Pin, ImagePlus, Smile, Link2, ChevronUp, Sparkles } from "lucide-react";

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
};

// ── Translations ──────────────────────────────────────────────────────────────
const T = {
  fr: {
    placeholder: "Qu'est-ce que vous avez en tête ?",
    titlePlaceholder: "Titre du post",
    post: "Publier", posting: "Publication…",
    addPhoto: "Photo", addGif: "GIF", addVideo: "Vidéo",
    gifUrlPlaceholder: "Collez l'URL d'un GIF…",
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
    justNow: "À l'instant", ago: "il y a", mins: "min", hours: "h", days: "j",
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
    gifUrlPlaceholder: "Paste a GIF URL…",
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
    justNow: "Just now", ago: "ago", mins: "min", hours: "h", days: "d",
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
    gifUrlPlaceholder: "GIF-URL einfügen…",
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
    justNow: "Gerade eben", ago: "vor", mins: "Min", hours: "Std", days: "T",
    pinPost: "Anheften", unpinPost: "Lösen", pinnedBadge: "Angeheftet",
    filterAll: "Alle",
    newPosts: (n: number) => n === 1 ? "1 neuer Beitrag" : `${n} neue Beiträge`,
    titleRequired: "Titel ist erforderlich",
    categoryLabel: "Kategorie",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function relTime(iso: string, t: typeof T["en"], lang: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return t.justNow;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return lang === "en" ? `${mins}${t.mins} ${t.ago}` : `${t.ago} ${mins} ${t.mins}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return lang === "en" ? `${hrs}${t.hours} ${t.ago}` : `${t.ago} ${hrs} ${t.hours}`;
  const days = Math.floor(hrs / 24);
  return lang === "en" ? `${days}${t.days} ${t.ago}` : `${t.ago} ${days} ${t.days}`;
}

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
function Avatar({ photo, name, size = 36, isBorivonTeam = false }: { photo: string | null; name: string; size?: number; isBorivonTeam?: boolean }) {
  const initials = name.split(" ").map(w => w[0]?.toUpperCase() ?? "").slice(0, 2).join("");
  if (photo) return (
    <div className="flex-shrink-0 rounded-full overflow-hidden" style={{ width: size, height: size }}>
      <img src={photo} alt={name} className="w-full h-full object-cover"
        style={{ border: isBorivonTeam ? "2px solid var(--gold)" : "2px solid var(--border)" }} />
    </div>
  );
  return (
    <div className="flex-shrink-0 rounded-full flex items-center justify-center font-bold"
      style={{
        width: size, height: size, fontSize: Math.max(9, size * 0.3),
        background: isBorivonTeam ? "var(--gdim)" : "var(--bg2)",
        border: isBorivonTeam ? "2px solid var(--border-gold)" : "2px solid var(--border)",
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
  const [liking, setLiking] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [likingComment, setLikingComment] = useState<Record<string, boolean>>({});
  const commentInputRef = useRef<HTMLInputElement>(null);

  const videoEmbed = extractVideoEmbed(post.content);
  const catMeta = getCategoryMeta(post.category ?? "general", lang);

  const loadComments = useCallback(async () => {
    if (commentsLoaded) return;
    try {
      const res = await fetch(`/api/portal/feed/${post.id}/comments`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) { const j = await res.json().catch(() => ({})); setComments(j.comments ?? []); setCommentsLoaded(true); }
    } catch { /* offline */ }
  }, [post.id, authToken, commentsLoaded]);

  const toggleComments = async () => {
    if (!showComments && !commentsLoaded) await loadComments();
    if (showComments) { setReplyTo(null); setCommentText(""); }
    setShowComments(s => !s);
  };

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    try {
      const res = await fetch(`/api/portal/feed/${post.id}/like`, { method: "POST", headers: { Authorization: `Bearer ${authToken}` } });
      if (res.ok) { const j = await res.json(); onLike(post.id, j.liked, j.likeCount); }
    } finally { setLiking(false); }
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

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--card)",
        border: post.pinned ? "1px solid var(--border-gold)" : post.author.isBorivonTeam ? "1px solid var(--border-gold)" : "1px solid var(--border)",
      }}>

      {/* Pinned banner */}
      {post.pinned && (
        <div className="px-4 py-2 flex items-center gap-1.5"
          style={{ background: "var(--gdim)", borderBottom: "1px solid var(--gdim)" }}>
          <span style={{ fontSize: 11 }}>📌</span>
          <span className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: "var(--gold)" }}>{t.pinnedBadge}</span>
        </div>
      )}

      {/* Borivon team accent */}
      {!post.pinned && post.author.isBorivonTeam && (
        <div className="h-[2px]" style={{ background: "linear-gradient(90deg,transparent,var(--gold),transparent)" }} />
      )}

      <div className="px-4 pt-4 pb-3">
        {/* Author row */}
        <div className="flex items-start gap-3 mb-3">
          <Avatar photo={post.author.photo} name={post.author.name} size={38} isBorivonTeam={post.author.isBorivonTeam} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>{post.author.name}</span>
              {post.author.verified && <VerifiedBadge verified size="xs" isAdmin={post.author.isBorivonTeam} color={post.author.isBorivonTeam ? "black" : "gold"} />}
              {post.author.isBorivonTeam && (
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}>
                  {t.borivonTeam}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px]" style={{ color: "var(--w3)" }}>{relTime(post.createdAt, t, lang)}</span>
              {/* Category badge */}
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
                {catMeta.emoji} {catMeta.label}
              </span>
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
          <button onClick={handleLike} disabled={liking}
            className="flex items-center gap-1.5 text-[12px] font-medium py-1 transition-all hover:opacity-80"
            style={{ color: post.likedByMe ? "var(--danger)" : "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
            <Heart size={15} strokeWidth={2} fill={post.likedByMe ? "var(--danger)" : "none"} />
            {post.likeCount > 0 && <span>{post.likeCount}</span>}
          </button>
          <button onClick={toggleComments}
            className="flex items-center gap-1.5 text-[12px] font-medium py-1 transition-all hover:opacity-80"
            style={{ color: showComments ? "var(--gold)" : "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
            <CommenterAvatars avatars={post.commenterAvatars} />
            <MessageCircle size={15} strokeWidth={2} />
            <span>{commentCount > 0 ? (showComments ? t.hideComments : t.showComments(commentCount)) : t.comment}</span>
          </button>
        </div>
      </div>

      {/* Comments */}
      {showComments && (
        <div className="px-4 pb-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="pt-3 space-y-3">
            {comments.map(c => (
              <div key={c.id} className="flex gap-2.5">
                <Avatar photo={c.authorPhoto} name={c.authorName} size={28} isBorivonTeam={c.isBorivonTeam} />
                <div className="flex-1 min-w-0">
                  <div className="rounded-2xl px-3 py-2" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-[11.5px] font-semibold" style={{ color: "var(--w)" }}>{c.authorName}</span>
                      {c.authorVerified && <VerifiedBadge verified size="xs" isAdmin={c.isBorivonTeam} color={c.isBorivonTeam ? "black" : "gold"} />}
                    </div>
                    <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--w2)", wordBreak: "break-word" }}>{c.content}</p>
                  </div>
                  <div className="flex items-center gap-3 mt-1 ml-1">
                    <span className="text-[10px]" style={{ color: "var(--w3)" }}>{relTime(c.createdAt, t, lang)}</span>
                    {/* Comment like */}
                    <button onClick={() => handleLikeComment(c.id, c.likedByMe, c.likeCount)} disabled={!!likingComment[c.id]}
                      className="flex items-center gap-1 text-[10px] font-medium transition-all hover:opacity-70"
                      style={{ color: c.likedByMe ? "var(--danger)" : "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                      <Heart size={10} strokeWidth={2} fill={c.likedByMe ? "var(--danger)" : "none"} />
                      {c.likeCount > 0 && <span>{c.likeCount}</span>}
                    </button>
                    {/* Reply */}
                    <button onClick={() => handleReply(c.authorName)}
                      className="text-[10px] font-semibold hover:opacity-70 transition-opacity"
                      style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                      {t.reply}
                    </button>
                    {(c.isOwn || isAdmin) && (
                      <button onClick={() => handleDeleteComment(c.id)}
                        className="text-[10px] hover:opacity-70 transition-opacity"
                        style={{ color: "var(--w3)", background: "transparent", border: "none", cursor: "pointer" }}>
                        {t.deletePost}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 mt-3">
            {replyTo && (
              <div className="flex items-center gap-1.5 ml-1">
                <span className="text-[10.5px]" style={{ color: "var(--w3)" }}>
                  {t.replyingTo} <span className="font-semibold" style={{ color: "var(--gold)" }}>@{replyTo}</span>
                </span>
                <button onClick={() => { setReplyTo(null); setCommentText(""); }}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--w3)", lineHeight: 1, padding: 0 }}>
                  ×
                </button>
              </div>
            )}
            <div className="flex gap-2.5">
            <div className="flex-1 flex items-center gap-2 rounded-2xl px-3 py-2"
              style={{ background: "var(--bg2)", border: `1px solid ${replyTo ? "var(--gold)" : "var(--border)"}`, transition: "border-color 0.15s" }}>
              <input ref={commentInputRef} value={commentText} onChange={e => setCommentText(e.target.value.slice(0, 300))}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                placeholder={replyTo ? `${t.replyingTo} @${replyTo}…` : t.writeComment}
                className="flex-1 text-[12.5px] outline-none bg-transparent" style={{ color: "var(--w)", border: "none" }} />
              <button onClick={handleAddComment} disabled={!commentText.trim() || sendingComment}
                style={{ background: "transparent", border: "none", cursor: commentText.trim() ? "pointer" : "default", color: commentText.trim() ? "var(--gold)" : "var(--w3)", transition: "color 0.15s" }}>
                {sendingComment ? <Loader2 size={15} strokeWidth={2} className="animate-spin" /> : <Send size={15} strokeWidth={2} />}
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
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FeedPage() {
  const router = useRouter();
  const { lang, t: gT } = useLang();
  const t = T[lang as keyof typeof T] ?? T.en;

  const [authToken, setAuthToken] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [userMeta, setUserMeta] = useState<{ name: string; photo: string | null; isBorivonTeam: boolean }>({ name: "", photo: null, isBorivonTeam: false });
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filter
  const [selectedCategory, setSelectedCategory] = useState<"all" | Category>("all");

  // Composer
  const [titleDraft, setTitleDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [postCategory, setPostCategory] = useState<Category>("general");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [gifInput, setGifInput] = useState("");
  const [showGifInput, setShowGifInput] = useState(false);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postsLoadError, setPostsLoadError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // New posts banner
  const [pendingPosts, setPendingPosts] = useState<Post[]>([]);
  const postIdsRef = useRef<Set<string>>(new Set());

  // Session init
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      let role: string | null = null;
      try {
        const res = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } });
        ({ role } = await res.json().catch(() => ({ role: null })));
        if (role === "org_member") { router.replace("/portal/org/dashboard"); return; }
      } catch { /* offline */ }

      setAuthToken(tk);
      const adminFlag = role === "admin" || role === "sub_admin";
      setIsAdmin(adminFlag);
      const name = session.user.user_metadata?.full_name ?? session.user.email ?? "";

      const { data: profile } = await supabase
        .from("candidate_profiles")
        .select("profile_photo")
        .eq("user_id", session.user.id)
        .maybeSingle();
      setUserMeta({ name, photo: (profile as { profile_photo?: string | null } | null)?.profile_photo ?? null, isBorivonTeam: adminFlag });

      await loadPosts(tk, 0, "all");
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep postIds ref in sync for the new-posts banner
  useEffect(() => { postIdsRef.current = new Set(posts.map(p => p.id)); }, [posts]);

  // Poll for new posts every 90s
  useEffect(() => {
    if (!authToken) return;
    const timer = setInterval(async () => {
      if (!authToken) return;
      const catParam = selectedCategory !== "all" ? `&category=${selectedCategory}` : "";
      const res = await fetch(`/api/portal/feed?page=0${catParam}`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!res.ok) return;
      const j = await res.json();
      const fresh = ((j.posts ?? []) as Post[]).filter(p => !postIdsRef.current.has(p.id));
      if (fresh.length > 0) setPendingPosts(fresh);
    }, 90_000);
    return () => clearInterval(timer);
  }, [authToken, selectedCategory]);

  // Reload when category filter changes
  useEffect(() => {
    if (!authToken) return;
    setPosts([]);
    setPendingPosts([]);
    loadPosts(authToken, 0, selectedCategory);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, authToken]);

  async function loadPosts(tk: string, p: number, category: string) {
    if (p === 0) setPostsLoadError(false);
    const catParam = category !== "all" ? `&category=${category}` : "";
    const res = await fetch(`/api/portal/feed?page=${p}${catParam}`, { headers: { Authorization: `Bearer ${tk}` } });
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
      const gifUrl = gifInput.trim().startsWith("http") ? gifInput.trim() : null;
      const res = await fetch("/api/portal/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: titleDraft.trim(), content: draft.trim(), imageBase64, gifUrl, category: postCategory }),
      });
      if (res.ok) {
        const j = await res.json();
        setPosts(prev => [j.post, ...prev]);
        setTitleDraft(""); setDraft(""); setImageBase64(null); setImagePreview(null);
        setGifInput(""); setShowGifInput(false); setShowVideoInput(false);
        setPostCategory("general");
      } else {
        const j = await res.json().catch(() => ({}));
        setPostError(j.error ?? gT.fdPostFail);
      }
    } catch {
      setPostError(gT.fdNetErr);
    } finally { setPosting(false); }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { const b64 = ev.target?.result as string; setImageBase64(b64); setImagePreview(b64); };
    reader.readAsDataURL(file);
    e.target.value = "";
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
          style={{ background: "var(--card)", border: `1px solid ${titleError ? "var(--danger-border)" : "var(--border)"}`, transition: "border-color 0.2s" }}>
          <div className="p-4">
            <div className="flex gap-3">
              <Avatar photo={userMeta.photo} name={userMeta.name} size={38} isBorivonTeam={userMeta.isBorivonTeam} />
              <div className="flex-1 min-w-0">
                {/* Required title */}
                <input
                  value={titleDraft}
                  onChange={e => { setTitleDraft(e.target.value.slice(0, 100)); setTitleError(false); }}
                  placeholder={t.titlePlaceholder}
                  className="w-full outline-none text-[14.5px] font-bold bg-transparent leading-snug"
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
                  className="w-full resize-none outline-none text-[13px] leading-relaxed bg-transparent mt-1.5"
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

            {/* GIF input */}
            {showGifInput && (
              <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                <Smile size={13} strokeWidth={1.8} style={{ color: "var(--gold)", flexShrink: 0 }} />
                <input value={gifInput} onChange={e => setGifInput(e.target.value)}
                  placeholder={t.gifUrlPlaceholder}
                  className="flex-1 text-[12px] outline-none bg-transparent" style={{ color: "var(--w)", border: "none" }} />
              </div>
            )}
            {gifInput.startsWith("http") && (
              <div className="mt-2 rounded-xl overflow-hidden" style={{ maxHeight: 200 }}>
                <img src={gifInput} alt="GIF" className="w-full object-contain" style={{ maxHeight: 200, background: "var(--bg2)" }} />
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

          {/* Category selector */}
          <div className="flex items-center gap-1.5 px-4 pb-3 flex-wrap">
            {CATEGORIES.map(cat => {
              const label = cat.label[lang as keyof typeof cat.label] ?? cat.label.en;
              const active = postCategory === cat.value;
              return (
                <button key={cat.value} onClick={() => setPostCategory(cat.value as Category)}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
                  style={{
                    background: active ? "var(--gdim)" : "transparent",
                    color: active ? "var(--gold)" : "var(--w3)",
                    border: `1px solid ${active ? "var(--border-gold)" : "var(--border)"}`,
                    cursor: "pointer",
                  }}>
                  <span>{cat.emoji}</span> {label}
                </button>
              );
            })}
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 pb-3 gap-2">
            <div className="flex items-center gap-1">
              <button onClick={() => fileRef.current?.click()} title={t.addPhoto}
                className="w-8 h-8 flex items-center justify-center rounded-xl transition-all hover:opacity-80"
                style={{ color: imagePreview ? "var(--gold)" : "var(--w3)", background: "var(--bg2)", border: "none", cursor: "pointer" }}>
                <ImagePlus size={15} strokeWidth={1.8} />
              </button>
              <button onClick={() => { setShowGifInput(s => !s); setShowVideoInput(false); }} title={t.addGif}
                className="w-8 h-8 flex items-center justify-center rounded-xl transition-all hover:opacity-80 text-[11px] font-bold"
                style={{ color: showGifInput ? "var(--gold)" : "var(--w3)", background: "var(--bg2)", border: "none", cursor: "pointer" }}>
                GIF
              </button>
              <button onClick={() => { setShowVideoInput(s => !s); setShowGifInput(false); }} title={t.addVideo}
                className="w-8 h-8 flex items-center justify-center rounded-xl transition-all hover:opacity-80"
                style={{ color: showVideoInput ? "var(--gold)" : "var(--w3)", background: "var(--bg2)", border: "none", cursor: "pointer" }}>
                <Link2 size={14} strokeWidth={1.8} />
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageSelect} />
            </div>
            <div className="flex flex-col items-end gap-1">
              {postError && (
                <p className="text-[11px]" style={{ color: "var(--danger)" }}>{postError}</p>
              )}
              <button onClick={handlePost} disabled={!canPost || posting}
                className="flex items-center gap-2 text-[13px] font-semibold px-5 py-2 rounded-xl transition-all active:scale-[0.97]"
                style={{
                  background: canPost ? "var(--gold)" : "var(--bg2)",
                  color: canPost ? "#131312" : "var(--w3)",
                  border: "none", cursor: canPost && !posting ? "pointer" : "default", transition: "all 0.15s",
                }}>
                {posting ? <><Loader2 size={13} strokeWidth={2} className="animate-spin" />{t.posting}</> : t.post}
              </button>
            </div>
          </div>
        </div>

        {/* ── Category filter bar ──────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
          <button onClick={() => setSelectedCategory("all")}
            className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-full transition-all flex-shrink-0"
            style={{
              background: selectedCategory === "all" ? "var(--gold)" : "var(--card)",
              color: selectedCategory === "all" ? "#131312" : "var(--w3)",
              border: `1px solid ${selectedCategory === "all" ? "var(--gold)" : "var(--border)"}`,
              cursor: "pointer",
            }}>
            {t.filterAll}
          </button>
          {CATEGORIES.map(cat => {
            const label = cat.label[lang as keyof typeof cat.label] ?? cat.label.en;
            const active = selectedCategory === cat.value;
            return (
              <button key={cat.value} onClick={() => setSelectedCategory(cat.value as Category)}
                className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-full transition-all flex-shrink-0"
                style={{
                  background: active ? "var(--gold)" : "var(--card)",
                  color: active ? "#131312" : "var(--w3)",
                  border: `1px solid ${active ? "var(--gold)" : "var(--border)"}`,
                  cursor: "pointer",
                }}>
                {cat.emoji} {label}
              </button>
            );
          })}
        </div>

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
            <button onClick={() => loadPosts(authToken, 0, selectedCategory)}
              className="text-[12.5px] font-medium px-4 py-1.5 rounded-full"
              style={{ background: "var(--bg2)", color: "var(--w3)", border: "1px solid var(--border)" }}>
              {lang === "de" ? "Erneut versuchen" : lang === "fr" ? "Réessayer" : "Try again"}
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16">
            <div className="flex justify-center mb-4">
              {selectedCategory !== "all"
                ? <span className="text-4xl">{getCategoryMeta(selectedCategory, lang).emoji}</span>
                : <Sparkles size={36} strokeWidth={1.5} style={{ color: "var(--gold)" }} />
              }
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
            <button onClick={async () => { setLoadingMore(true); await loadPosts(authToken, page + 1, selectedCategory); setLoadingMore(false); }}
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
