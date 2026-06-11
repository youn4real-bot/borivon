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
import { Sparkles, X, Send, Loader2, Mic } from "lucide-react";
import { useLang } from "@/components/LangContext";

/** Render assistant text safely (no HTML injection). The fragile signed file
 *  URLs are normally rendered as buttons from the tool's STRUCTURED output (see
 *  below) — so when hideFileUrls is true we drop any /api/portal/file URL the
 *  model pasted into its text. The fallback path (structured output missing)
 *  still shows the URL, trimmed of trailing markdown/punctuation so a stray "_"
 *  can't corrupt the ".pdf" extension. */
function Linkified({ text, hideFileUrls, dlLabel }: { text: string; hideFileUrls: boolean; dlLabel: string }) {
  const parts = text.split(/(\/api\/portal\/file\?[^\s)]+|https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\/api\/portal\/file\?/.test(p)) {
          if (hideFileUrls) return null; // shown as a structured download button instead
          const clean = p.replace(/[_*.,;:)\]}>"']+$/, "");
          return (
            <a key={i} href={clean} target="_blank" rel="noopener noreferrer"
               className="font-semibold" style={{ color: "var(--gold)", textDecoration: "underline" }}>⬇ {dlLabel}</a>
          );
        }
        if (/^https?:\/\//.test(p)) {
          const clean = p.replace(/[_*.,;:)\]}>"']+$/, "");
          return <a key={i} href={clean} target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold)", textDecoration: "underline" }}>{clean}</a>;
        }
        return <span key={i}>{p}</span>;
      })}
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

  // Auto-open when launched from the installed phone app (start_url has ?assistant=1).
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("assistant") === "1") setOpen(true);
    } catch { /* no-op */ }
  }, []);

  // ── Voice input — Android Chrome Web Speech API: tap mic, speak, auto-send. ──
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const recogRef = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setVoiceOk(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);
  function toggleMic() {
    if (listening) { recogRef.current?.stop(); return; }
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR() as {
      lang: string; interimResults: boolean; continuous: boolean;
      onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
      onend: (() => void) | null; onerror: (() => void) | null;
      start: () => void; stop: () => void;
    };
    r.lang = lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "en-US";
    r.interimResults = true;
    r.continuous = false;
    let finalText = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += seg; else interim += seg;
      }
      setInput((finalText + interim).trim());
    };
    r.onend = () => {
      setListening(false);
      const text = finalText.trim();
      if (text) { setInput(""); void sendMessage({ text }); } // speak → auto-send
    };
    r.onerror = () => setListening(false);
    recogRef.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }

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
    T("Remind me to chase Youssef's passport next week", "Erinnere mich nächste Woche an Youssefs Reisepass", "Rappelle-moi de relancer le passeport de Youssef la semaine prochaine"),
    T("What are my reminders?", "Was sind meine Erinnerungen?", "Quels sont mes rappels ?"),
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
                      "Ask me to look up candidates, fetch document links, or remember a task for you. I'm read-only on your candidates — but I'll keep your reminders.",
                      "Bitte mich, Kandidaten nachzuschlagen, Dokument-Links zu holen oder eine Aufgabe für dich zu merken. Kandidatendaten ändere ich nicht — aber deine Erinnerungen behalte ich.",
                      "Demandez-moi de chercher des candidats, des liens de documents, ou de retenir une tâche. Je ne modifie pas vos candidats — mais je garde vos rappels.",
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
                // Download links come from the TOOL's structured output (exact url +
                // filename) — NOT the model's retyped text, which is what produced the
                // broken ".pdf_" name. download={fileName} forces the clean save name.
                const downloads = m.parts
                  .map((p) => p as { type?: string; output?: { url?: string; fileName?: string }; result?: { url?: string; fileName?: string } })
                  .filter((p) => p.type === "tool-getDocumentDownloadLink")
                  .map((p) => p.output ?? p.result)
                  .filter((o): o is { url?: string; fileName?: string } => !!o && typeof o.url === "string")
                  .map((o) => ({ url: o.url as string, fileName: o.fileName || "document" }));
                const isUser = m.role === "user";
                if (!text && !isUser && downloads.length === 0) return null;
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
                      {isUser ? text : <Linkified text={text} hideFileUrls={downloads.length > 0} dlLabel={dlLabel} />}
                      {downloads.map((d, i) => (
                        <a
                          key={i}
                          href={d.url}
                          download={d.fileName}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bv-press mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-2 rounded-lg"
                          style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)", textDecoration: "none" }}
                        >
                          ⬇ {d.fileName}
                        </a>
                      ))}
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
                placeholder={listening
                  ? T("Listening… speak now", "Ich höre… sprich jetzt", "J'écoute… parlez")
                  : T("Ask anything about your candidates…", "Frag etwas über deine Kandidaten…", "Posez une question sur vos candidats…")}
                className="flex-1 text-[13px] px-3 py-2.5 rounded-xl outline-none"
                style={{ background: "var(--bg2)", color: "var(--w)", border: "1px solid var(--border)" }}
              />
              {voiceOk && (
                <button
                  onClick={toggleMic}
                  className="bv-press inline-flex items-center justify-center p-2.5 rounded-xl"
                  style={listening
                    ? { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }
                    : { background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}
                  aria-label={T("Speak", "Sprechen", "Parler")}
                >
                  <Mic size={16} className={listening ? "animate-pulse" : ""} />
                </button>
              )}
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
