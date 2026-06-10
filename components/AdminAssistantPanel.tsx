"use client";
/**
 * Admin AI assistant — floating launcher + chat popup, supreme-admin-only (mounted
 * behind isSuperAdmin in app/portal/admin/page.tsx). Talks ONLY to the same-origin
 * /api/portal/admin/assistant route (which calls Gemini on Vertex server-side).
 * Read-only: it looks up candidates + hands back 3-minute download links.
 *
 * i18n: inline 3-language ternary (LAW #19) — these strings appear only here.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { useLang } from "@/components/LangContext";

/** Turn the assistant's inline file URLs into real download links; everything
 *  else renders as plain text (no HTML injection). */
function Linkified({ text, dlLabel }: { text: string; dlLabel: string }) {
  const parts = text.split(/(\/api\/portal\/file\?[^\s)]+|https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^(\/api\/portal\/file\?|https?:\/\/)/.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold"
            style={{ color: "var(--gold)", textDecoration: "underline" }}
          >
            ⬇ {dlLabel}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function AdminAssistantPanel({ accessToken }: { accessToken: string }) {
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Recreate the transport only when the token actually refreshes (~55 min);
  // a stable id keeps the conversation across that swap.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/portal/admin/assistant",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    [accessToken],
  );

  const { messages, sendMessage, status, error } = useChat({ id: "admin-assistant", transport });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, busy]);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  const dlLabel = T("Download", "Herunterladen", "Télécharger");
  const examples = [
    T("8 candidates with B2 due in the next 3 months", "8 Kandidaten mit B2 in den nächsten 3 Monaten", "8 candidats avec B2 dans les 3 prochains mois"),
    T("Find Fatima and give me her CV link", "Finde Fatima und gib mir ihren Lebenslauf-Link", "Trouve Fatima et donne-moi le lien de son CV"),
  ];

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen(true)}
        className="bv-press fixed inline-flex items-center gap-2 text-[13px] font-bold px-4 py-3 rounded-full"
        style={{
          right: 20,
          bottom: 88,
          zIndex: 1000,
          background: "var(--gold-gradient, var(--gold))",
          color: "#1a1206",
          boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
        }}
        aria-label={T("Open AI assistant", "KI-Assistent öffnen", "Ouvrir l'assistant IA")}
      >
        <Sparkles size={16} /> {T("Assistant", "Assistent", "Assistant")}
      </button>

      {open && (
        <div
          className="fixed inset-0 flex items-end justify-end sm:items-center sm:justify-center p-0 sm:p-6"
          style={{ zIndex: 1100, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col w-full sm:w-[460px] h-[80vh] sm:h-[620px] overflow-hidden"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="inline-flex items-center gap-2 text-[14px] font-bold" style={{ color: "var(--w)" }}>
                <Sparkles size={15} style={{ color: "var(--gold)" }} /> {T("AI Assistant", "KI-Assistent", "Assistant IA")}
              </span>
              <button onClick={() => setOpen(false)} className="bv-press p-1.5 rounded-lg" style={{ color: "var(--w2)" }} aria-label={T("Close", "Schließen", "Fermer")}>
                <X size={18} />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-[13px]" style={{ color: "var(--w2)" }}>
                    {T(
                      "Ask me to look up candidates or fetch document links. I'm read-only — I can't change anything.",
                      "Bitte mich, Kandidaten nachzuschlagen oder Dokument-Links zu holen. Nur Lesezugriff — ich ändere nichts.",
                      "Demandez-moi de chercher des candidats ou des liens de documents. Lecture seule — je ne modifie rien.",
                    )}
                  </p>
                  {examples.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => { setInput(ex); }}
                      className="bv-press block w-full text-left text-[12.5px] px-3 py-2 rounded-xl"
                      style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}
                    >
                      “{ex}”
                    </button>
                  ))}
                </div>
              )}

              {messages.map((m) => {
                const text = m.parts
                  .filter((p): p is { type: "text"; text: string } => p.type === "text")
                  .map((p) => p.text)
                  .join("");
                const isUser = m.role === "user";
                if (!text && !isUser) return null;
                return (
                  <div key={m.id} className={isUser ? "flex justify-end" : "flex justify-start"}>
                    <div
                      className="max-w-[85%] text-[13px] leading-relaxed px-3 py-2 rounded-2xl whitespace-pre-wrap break-words"
                      style={
                        isUser
                          ? { background: "var(--gdim)", color: "var(--w)", border: "1px solid var(--border-gold)" }
                          : { background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }
                      }
                    >
                      {isUser ? text : <Linkified text={text} dlLabel={dlLabel} />}
                    </div>
                  </div>
                );
              })}

              {busy && (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 text-[12.5px] px-3 py-2 rounded-2xl" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
                    <Loader2 size={13} className="animate-spin" /> {T("Looking it up…", "Suche…", "Recherche…")}
                  </div>
                </div>
              )}

              {error && (
                <div className="text-[12px] px-3 py-2 rounded-xl" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
                  {T(
                    "Something went wrong — if the assistant isn't connected yet, add the Google key.",
                    "Etwas ist schiefgelaufen — falls der Assistent noch nicht verbunden ist, füge den Google-Schlüssel hinzu.",
                    "Une erreur — si l'assistant n'est pas encore connecté, ajoutez la clé Google.",
                  )}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="flex items-center gap-2 px-3 py-3" style={{ borderTop: "1px solid var(--border)" }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                placeholder={T("Ask anything about your candidates…", "Frag etwas über deine Kandidaten…", "Posez une question sur vos candidats…")}
                className="flex-1 text-[13px] px-3 py-2.5 rounded-xl outline-none"
                style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}
              />
              <button
                onClick={submit}
                disabled={busy || !input.trim()}
                className="bv-press inline-flex items-center justify-center p-2.5 rounded-xl disabled:opacity-50"
                style={{ background: "var(--gold)", color: "#1a1206" }}
                aria-label={T("Send", "Senden", "Envoyer")}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
