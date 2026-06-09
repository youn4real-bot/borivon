"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import {
  LiveKitRoom, VideoConference, RoomAudioRenderer,
  useLocalParticipant, useIsSpeaking, useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ArrowLeft, Hand, BookOpen, Video } from "lucide-react";

/* Fire-and-forget telemetry into the classroom ledger. */
function logEvent(token: string, payload: { sessionId: string | null; roomName: string; kind: string; value?: Record<string, unknown>; displayName?: string }) {
  fetch("/api/portal/admin/classroom/event", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

/* Camera-on gate — blocks participation when the camera is off. */
function CameraGate({ lang }: { lang: "fr" | "en" | "de" }) {
  const { isCameraEnabled, localParticipant } = useLocalParticipant();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  if (isCameraEnabled) return null;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(10,10,12,0.92)", backdropFilter: "blur(6px)", textAlign: "center", padding: 24 }}>
      <Video size={36} style={{ color: "var(--gold)" }} />
      <div style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>{T("Turn your camera on to participate", "Kamera einschalten, um teilzunehmen", "Activez votre caméra pour participer")}</div>
      <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, maxWidth: 340 }}>{T("Camera is required in this class. Everything resumes once it's on.", "Die Kamera ist in diesem Kurs erforderlich. Es geht weiter, sobald sie an ist.", "La caméra est requise dans ce cours. Tout reprend dès qu'elle est activée.")}</div>
      <button onClick={() => void localParticipant.setCameraEnabled(true)} className="bv-press" style={{ background: "var(--gold)", color: "#131312", fontWeight: 700, fontSize: 14, padding: "10px 20px", borderRadius: 12, border: "none" }}>
        {T("Enable camera", "Kamera aktivieren", "Activer la caméra")}
      </button>
    </div>
  );
}

/* The data factory: captures join/leave, camera on/off, mic on/off, and real
   speaking seconds — per person, into the ledger. Renders nothing. */
function Telemetry({ token, sessionId, roomName, displayName }: { token: string; sessionId: string | null; roomName: string; displayName: string }) {
  const room = useRoomContext();
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
  const speaking = useIsSpeaking(localParticipant);
  const speakStart = useRef<number | null>(null);
  const base = { sessionId, roomName, displayName };

  // Join on mount, leave (+ flush any open speaking span) on unmount.
  useEffect(() => {
    logEvent(token, { ...base, kind: "joined" });
    return () => {
      if (speakStart.current) {
        const secs = Math.round((performance.now() - speakStart.current) / 1000);
        if (secs >= 1) logEvent(token, { ...base, kind: "spoke", value: { seconds: secs } });
      }
      logEvent(token, { ...base, kind: "left" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Camera on/off.
  const camFirst = useRef(true);
  useEffect(() => {
    if (camFirst.current) { camFirst.current = false; return; }
    logEvent(token, { ...base, kind: isCameraEnabled ? "camera_on" : "camera_off" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraEnabled]);

  // Mic on/off.
  const micFirst = useRef(true);
  useEffect(() => {
    if (micFirst.current) { micFirst.current = false; return; }
    logEvent(token, { ...base, kind: isMicrophoneEnabled ? "mic_on" : "mic_off" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMicrophoneEnabled]);

  // Real speaking time — accumulate a span each time they start→stop speaking.
  useEffect(() => {
    if (speaking) {
      if (!speakStart.current) speakStart.current = performance.now();
    } else if (speakStart.current) {
      const secs = Math.round((performance.now() - speakStart.current) / 1000);
      speakStart.current = null;
      if (secs >= 1) logEvent(token, { ...base, kind: "spoke", value: { seconds: secs } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking]);

  // Mark the room ended best-effort when the host closes the tab.
  useEffect(() => {
    const onBeforeUnload = () => { if (room.state === "connected") logEvent(token, { ...base, kind: "left" }); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function ClassroomPage() {
  const router = useRouter();
  const { lang } = useLang();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);

  const [loading, setLoading] = useState(true);
  const [authToken, setAuthToken] = useState("");
  const [displayName, setDisplayName] = useState("Admin");
  const [roomName, setRoomName] = useState("borivon-class");
  const [conn, setConn] = useState<{ token: string; url: string; sessionId: string | null } | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } });
      const { role } = await roleRes.json().catch(() => ({ role: null }));
      if (role !== "admin") { router.replace("/portal"); return; }   // supreme-admin only (testing)
      setAuthToken(tk);
      const meta = session.user.user_metadata as { full_name?: string; first_name?: string } | undefined;
      setDisplayName(meta?.full_name || meta?.first_name || "Admin");
      setLoading(false);
    });
  }, [router]);

  async function start() {
    setErr(""); setStarting(true);
    try {
      const res = await fetch("/api/portal/admin/classroom/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ room: roomName, name: displayName }),
      });
      if (res.status === 503) { setNeedsSetup(true); setStarting(false); return; }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || T("Could not start", "Start fehlgeschlagen", "Échec")); setStarting(false); return; }
      setConn({ token: j.token, url: j.url, sessionId: j.sessionId ?? null });
    } catch { setErr(T("Could not start", "Start fehlgeschlagen", "Échec")); }
    setStarting(false);
  }

  function leave() { setConn(null); }

  if (loading) return <PageLoader />;

  // ── In the room ──
  if (conn) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#0b0b0d", display: "flex", flexDirection: "column" }}>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
          <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>🎓 {roomName}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => logEvent(authToken, { sessionId: conn.sessionId, roomName, displayName, kind: "hand_raise" })} className="bv-press inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-lg" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}><Hand size={13} /> {T("Raise hand", "Melden", "Lever la main")}</button>
            <button onClick={() => logEvent(authToken, { sessionId: conn.sessionId, roomName, displayName, kind: "exercise_action", value: { test: true } })} className="bv-press inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-lg" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}><BookOpen size={13} /> {T("Log exercise action", "Übungsaktion loggen", "Logger une action")}</button>
            <button onClick={leave} className="bv-press text-[12px] font-bold px-3 py-2 rounded-lg" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>{T("Leave", "Verlassen", "Quitter")}</button>
          </div>
        </div>
        <div style={{ flex: 1, position: "relative", minHeight: 0 }} data-lk-theme="default">
          <LiveKitRoom token={conn.token} serverUrl={conn.url} connect video audio style={{ height: "100%" }} onDisconnected={leave}>
            <VideoConference />
            <RoomAudioRenderer />
            <CameraGate lang={lang} />
            <Telemetry token={authToken} sessionId={conn.sessionId} roomName={roomName} displayName={displayName} />
          </LiveKitRoom>
        </div>
      </div>
    );
  }

  // ── Pre-join / setup ──
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <button onClick={() => router.back()} className="bv-row-hover flex items-center gap-2 text-xs px-2 py-1 mb-4" style={{ color: "var(--w3)" }}>
        <ArrowLeft size={14} /> {T("Back", "Zurück", "Retour")}
      </button>
      <div className="flex items-center gap-2.5 mb-1.5">
        <Video size={20} style={{ color: "var(--gold)" }} />
        <h1 className="text-[19px] font-bold" style={{ color: "var(--w)" }}>{T("Live classroom (test)", "Live-Klassenzimmer (Test)", "Classe en direct (test)")}</h1>
      </div>
      <p className="text-[12.5px] mb-5" style={{ color: "var(--w3)" }}>
        {T("Supreme-admin only for now. Camera is required; we capture attendance, camera on/off, speaking time, and exercise actions into the engagement ledger — nothing is recorded.",
           "Vorerst nur für Supreme-Admin. Kamera erforderlich; wir erfassen Anwesenheit, Kamera an/aus, Sprechzeit und Übungsaktionen im Engagement-Ledger — nichts wird aufgezeichnet.",
           "Réservé au supreme-admin pour l'instant. Caméra requise ; on enregistre présence, caméra on/off, temps de parole et actions d'exercice dans le registre d'engagement — rien n'est enregistré.")}
      </p>

      {needsSetup ? (
        <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border-gold)" }}>
          <p className="text-[13.5px] font-bold mb-2" style={{ color: "var(--gold)" }}>{T("Connect LiveKit first", "Zuerst LiveKit verbinden", "Connectez d'abord LiveKit")}</p>
          <p className="text-[12.5px] mb-2" style={{ color: "var(--w2)" }}>{T("The classroom needs a LiveKit server. Fastest: a free LiveKit Cloud project.", "Das Klassenzimmer braucht einen LiveKit-Server. Am schnellsten: ein kostenloses LiveKit-Cloud-Projekt.", "La classe a besoin d'un serveur LiveKit. Le plus rapide : un projet LiveKit Cloud gratuit.")}</p>
          <ol className="text-[12px] list-decimal pl-5 space-y-1" style={{ color: "var(--w3)" }}>
            <li>{T("Create a free project at cloud.livekit.io", "Kostenloses Projekt auf cloud.livekit.io erstellen", "Créez un projet gratuit sur cloud.livekit.io")}</li>
            <li>{T("Copy its URL + API key + API secret", "URL + API-Key + API-Secret kopieren", "Copiez l'URL + clé API + secret API")}</li>
            <li>{T("Add them to Vercel as LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET", "In Vercel als LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET hinzufügen", "Ajoutez-les sur Vercel : LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET")}</li>
            <li>{T("Point the LiveKit webhook to /api/portal/admin/classroom/webhook", "LiveKit-Webhook auf /api/portal/admin/classroom/webhook setzen", "Pointez le webhook LiveKit vers /api/portal/admin/classroom/webhook")}</li>
          </ol>
        </div>
      ) : (
        <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div>
            <label className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: "var(--w3)" }}>{T("Class room name", "Kursraum-Name", "Nom de la salle")}</label>
            <input className="bv-input" value={roomName} onChange={e => setRoomName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60))} style={{ width: "100%", fontSize: 14, marginTop: 4 }} />
          </div>
          {err && <p className="text-[12px]" style={{ color: "var(--danger)" }}>{err}</p>}
          <button onClick={start} disabled={starting || !roomName} className="bv-press inline-flex items-center justify-center gap-2 text-[14px] font-bold px-5 py-3 rounded-xl disabled:opacity-60" style={{ background: "var(--gold)", color: "#131312" }}>
            <Video size={16} /> {starting ? T("Starting…", "Wird gestartet…", "Démarrage…") : T("Start / join class", "Kurs starten / beitreten", "Démarrer / rejoindre")}
          </button>
        </div>
      )}
    </div>
  );
}
