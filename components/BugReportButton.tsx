"use client";

/**
 * Floating "Report a bug" button anchored to the bottom-right of every portal
 * page. Click → small dialog with optional text + optional screenshot.
 *
 * Submitting posts a kind="bug" message to the candidate's thread (or to the
 * admin's own thread if the admin themselves files a bug). The admin sees it
 * in the Inbox tagged with a red "Bug report" label.
 *
 * Hidden when not signed in.
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { Bug, X as XIcon, Image as ImageIcon, Send } from "lucide-react";
import { Spinner } from "@/components/ui/states";

const MAX_ATTACH_CHARS = 800_000;

export function BugReportButton() {
  const { lang, t: globalT } = useLang();
  const [token, setToken] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Track the post-success auto-close timer so we can clear it on unmount —
  // prevents setState-on-unmounted-component if the user navigates within 1.6s.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    let mounted = true;
    // Use getUser() — does a server-side token check, never returns a stale
    // localStorage session after the user has signed out.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted) return;
      if (!user) { setToken(null); return; }
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (mounted) setToken(session?.access_token ?? null);
      });
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evt, session) => {
      if (evt === "SIGNED_OUT") {
        setToken(null); // clear immediately — don't wait for the next render cycle
        return;
      }
      setToken(session?.access_token ?? null);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // Esc closes the bug-report dialog — but NOT while a send is in flight.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, sending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!token) return null;

  const labelCTA       = lang === "fr" ? "Signaler un bug"        : lang === "de" ? "Fehler melden"        : "Report a bug";
  const labelTitle     = lang === "fr" ? "Signaler un bug"        : lang === "de" ? "Einen Fehler melden"  : "Report a bug";
  const labelSubtitle  = lang === "fr" ? "Décrivez ce qui ne va pas. Capture d'écran optionnelle."
                       : lang === "de" ? "Beschreiben Sie das Problem. Screenshot optional."
                       : "Describe the issue. Screenshot optional.";
  const labelText      = lang === "fr" ? "Que s'est-il passé ?"   : lang === "de" ? "Was ist passiert?"    : "What happened?";
  const labelScreen    = lang === "fr" ? "Ajouter une capture"    : lang === "de" ? "Screenshot anhängen"  : "Attach a screenshot";
  const labelSend      = lang === "fr" ? "Envoyer"                : lang === "de" ? "Senden"               : "Send";
  const labelCancel    = lang === "fr" ? "Annuler"                : lang === "de" ? "Abbrechen"            : "Cancel";
  const labelSent      = lang === "fr" ? "Merci ! Votre rapport a été envoyé."
                       : lang === "de" ? "Danke! Ihr Bericht wurde gesendet."
                       : "Thanks! Your report was sent.";
  const labelTooLarge  = lang === "fr" ? "Image trop grande (max ~600 Ko)."
                       : lang === "de" ? "Bild zu groß (max ~600 KB)."
                       : "Image too large (max ~600 KB).";

  async function handlePick(file: File | null) {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError(globalT.bugOnlyImg); return; }
    const data = await compress(file, 1280, 0.78);
    if (data.length > MAX_ATTACH_CHARS) { setError(labelTooLarge); return; }
    setAttach(data);
  }

  async function send() {
    if (sending) return;
    if (!text.trim() && !attach) { setError(globalT.bugDescribe); return; }
    setSending(true); setError("");
    try {
      const res = await fetch("/api/portal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          body: text.trim(),
          attachment: attach,
          kind: "bug",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || globalT.bugSendFail);
      }
      setSent(true);
      closeTimerRef.current = setTimeout(() => {
        setOpen(false); setSent(false); setText(""); setAttach(null);
        if (fileRef.current) fileRef.current.value = "";
      }, 1600);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function close() {
    if (sending) return;
    setOpen(false);
    setText(""); setAttach(null); setError(""); setSent(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <>
      {/* On mobile: icon lives inside the top navbar (always visible, never
          covered by content). On desktop: pill anchored to bottom-right. */}
      <style>{`
        @media (max-width: 639.98px) {
          .bv-bug-btn {
            top: 7px !important;
            bottom: auto !important;
            right: 3.5vw !important;
            width: 44px !important;
            height: 44px !important;
            padding: 0 !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            color: var(--w3) !important;
            gap: 0 !important;
          }
          .bv-bug-btn:hover { color: var(--w) !important; }
        }
      `}</style>
      <button
        onClick={() => setOpen(true)}
        aria-label={labelCTA}
        title={labelCTA}
        className="bv-bug-btn fixed bottom-5 right-5 z-[1201] inline-flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-semibold tracking-tight transition-all hover:scale-105 active:scale-95"
        style={{
          background: "var(--card)",
          color: "var(--w2)",
          border: "1px solid var(--border)",
          borderRadius: "999px",
          boxShadow: "var(--shadow-md)",
        }}>
        <Bug size={18} strokeWidth={1.8} style={{ color: "var(--danger)" }} />
        <span className="hidden sm:inline">{labelCTA}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[2100] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)", animation: "bvFadeRise 0.22s var(--ease-out)" }}
          onClick={close}>
          <div className="w-full max-w-[440px] flex flex-col"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-2xl)",
              boxShadow: "var(--shadow-lg)",
              animation: "bvFadeRise 0.28s var(--ease-out)",
              paddingBottom: "env(safe-area-inset-bottom)",
              maxHeight: "calc(100dvh - 58px - var(--bv-subnav-h, 0px) - 96px)",
            }}
            onClick={e => e.stopPropagation()}>

            <div className="flex items-start justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <span className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
                  style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                  <Bug size={15} strokeWidth={1.8} />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--w)" }}>{labelTitle}</h2>
                  <p className="text-[11.5px]" style={{ color: "var(--w3)" }}>{labelSubtitle}</p>
                </div>
              </div>
              <button onClick={close} aria-label={globalT.miClose}
                className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 hover:scale-110"
                style={{ background: "transparent", color: "var(--w3)", border: "none", transition: "color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--w)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--w3)"; }}>
                <XIcon size={14} strokeWidth={1.8} />
              </button>
            </div>

            {sent ? (
              <div className="px-5 py-8 text-center" role="status" aria-live="polite">
                <p className="text-[13px]" style={{ color: "var(--success)" }}>✓ {labelSent}</p>
              </div>
            ) : (
              <>
                <div className="px-5 py-4 space-y-3 overflow-y-auto" style={{ minHeight: 0 }}>
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder={labelText}
                    aria-label={labelTitle}
                    rows={4}
                    autoFocus
                    className="w-full resize-none outline-none px-3 py-2.5 text-[13px]"
                    style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}
                  />

                  {attach ? (
                    <div className="flex items-start gap-2">
                      { /* eslint-disable-next-line @next/next/no-img-element */ }
                      <img src={attach} alt={globalT.miPreview}
                        className="max-h-[120px] rounded-md"
                        style={{ border: "1px solid var(--border)" }} />
                      <button onClick={() => { setAttach(null); if (fileRef.current) fileRef.current.value = ""; }}
                        aria-label={globalT.bugRemoveScreenshot}
                        className="w-7 h-7 flex items-center justify-center rounded-md flex-shrink-0 hover:scale-110"
                        style={{ background: "transparent", color: "var(--w3)", border: "none", transition: "color var(--dur-1) var(--ease), transform var(--dur-1) var(--ease)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--w)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--w3)"; }}>
                        <XIcon size={12} strokeWidth={2} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input ref={fileRef} type="file" accept="image/*" className="hidden"
                        onChange={e => handlePick(e.target.files?.[0] ?? null)} />
                      <button onClick={() => fileRef.current?.click()}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 transition-colors"
                        style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)" }}>
                        <ImageIcon size={13} strokeWidth={1.8} /> {labelScreen}
                      </button>
                    </>
                  )}

                  <div role="alert" aria-live="assertive">
                  {error && (
                    <p className="text-[11.5px]" style={{ color: "var(--danger)" }}>{error}</p>
                  )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-5 py-3 flex-shrink-0"
                  style={{ borderTop: "1px solid var(--border)" }}>
                  <button onClick={close} disabled={sending}
                    className="text-[12.5px] font-medium px-4 py-2 transition-colors disabled:opacity-50"
                    style={{ background: "transparent", color: "var(--w3)" }}>
                    {labelCancel}
                  </button>
                  <button onClick={send} disabled={sending || (!text.trim() && !attach)}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-2 transition-opacity disabled:opacity-40"
                    style={{ background: "var(--gold)", color: "#131312", borderRadius: "var(--r-sm)" }}>
                    {sending ? <Spinner size="xs" color="#131312" /> : <Send size={13} strokeWidth={2} />}
                    {labelSend}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

async function compress(file: File, maxW: number, quality: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const ratio = img.width > maxW ? maxW / img.width : 1;
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // Fallback: read raw
      return await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
