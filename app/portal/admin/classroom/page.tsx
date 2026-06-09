"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PageLoader } from "@/components/ui/states";
import {
  LiveKitRoom, VideoConference, RoomAudioRenderer,
  useLocalParticipant, useIsSpeaking, useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { ArrowLeft, Hand, BookOpen, Video, BarChart3, RefreshCw, Camera, Mic, Clock, Users } from "lucide-react";

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

/* ───────────────────────── Engagement scorecard ───────────────────────── */
type EngRow = {
  userId: string; name: string; sessionsAttended: number;
  presentSeconds: number; cameraOnSeconds: number; cameraPct: number;
  speakingSeconds: number; speakingShare: number;
  exerciseActions: number; handRaises: number; score: number;
};
type EngSession = { id: string; title: string; room: string; status: string | null; startedAt: string | null; endedAt: string | null };

const fmtDur = (s: number) => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
function scoreColor(score: number): { fg: string; bg: string; bd: string } {
  if (score >= 70) return { fg: "var(--success)", bg: "var(--success-bg)", bd: "var(--success-border)" };
  if (score >= 45) return { fg: "var(--gold)", bg: "var(--gdim)", bd: "var(--border-gold)" };
  return { fg: "var(--danger)", bg: "var(--danger-bg)", bd: "var(--danger-border)" };
}

function EngagementPanel({ authToken, lang }: { authToken: string; lang: "fr" | "en" | "de" }) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [rows, setRows] = useState<EngRow[]>([]);
  const [sessions, setSessions] = useState<EngSession[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [busy, setBusy] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  async function load() {
    setBusy(true); setLoadErr("");
    try {
      const res = await fetch("/api/portal/admin/classroom/engagement", { headers: { Authorization: `Bearer ${authToken}` } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadErr(j.error || "load_failed"); setBusy(false); return; }
      setRows(j.rows ?? []); setSessions(j.sessions ?? []); setTotalEvents(j.totalEvents ?? 0);
    } catch { setLoadErr("network"); }
    setBusy(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const Th = ({ children, center }: { children: ReactNode; center?: boolean }) => (
    <th className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-2 whitespace-nowrap" style={{ color: "var(--w3)", textAlign: center ? "center" : "left" }}>{children}</th>
  );

  return (
    <div className="rounded-2xl p-4 mt-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} style={{ color: "var(--gold)" }} />
          <span className="text-[13.5px] font-bold" style={{ color: "var(--w)" }}>{T("Engagement profiles", "Engagement-Profile", "Profils d'engagement")}</span>
        </div>
        <button onClick={() => void load()} disabled={busy} className="bv-press inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-60" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> {T("Refresh", "Aktualisieren", "Actualiser")}
        </button>
      </div>

      {/* summary strip */}
      <div className="flex flex-wrap gap-2 mb-3">
        {[
          { icon: <Users size={12} />, label: T("People", "Personen", "Personnes"), val: String(rows.length) },
          { icon: <Video size={12} />, label: T("Sessions", "Sitzungen", "Sessions"), val: String(sessions.length) },
          { icon: <Clock size={12} />, label: T("Events", "Ereignisse", "Événements"), val: String(totalEvents) },
        ].map((s, i) => (
          <div key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
            <span style={{ color: "var(--w3)" }}>{s.icon}</span>
            <span className="text-[12px] font-bold" style={{ color: "var(--w)" }}>{s.val}</span>
            <span className="text-[10.5px]" style={{ color: "var(--w3)" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {loadErr ? (
        <p className="text-[12px] py-3" style={{ color: "var(--danger)" }}>{T("Could not load engagement data.", "Engagement-Daten konnten nicht geladen werden.", "Impossible de charger les données.")}</p>
      ) : busy && rows.length === 0 ? (
        <p className="text-[12px] py-3" style={{ color: "var(--w3)" }}>{T("Loading…", "Wird geladen…", "Chargement…")}</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] py-3" style={{ color: "var(--w3)" }}>
          {T("No engagement data yet — run a class and the ledger fills up here.", "Noch keine Engagement-Daten — halte einen Kurs ab, dann füllt sich das Ledger hier.", "Pas encore de données — animez un cours et le registre se remplira ici.")}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="w-full border-collapse" style={{ minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <Th>{T("Person", "Person", "Personne")}</Th>
                <Th center>{T("Score", "Score", "Score")}</Th>
                <Th center>{T("Sessions", "Sitzungen", "Sessions")}</Th>
                <Th center><Clock size={11} className="inline" /> {T("Present", "Anwesend", "Présent")}</Th>
                <Th center><Camera size={11} className="inline" /> {T("Camera", "Kamera", "Caméra")}</Th>
                <Th center><Mic size={11} className="inline" /> {T("Spoke", "Gesprochen", "Parlé")}</Th>
                <Th center><BookOpen size={11} className="inline" /> {T("Actions", "Aktionen", "Actions")}</Th>
                <Th center><Hand size={11} className="inline" /> {T("Hands", "Melden", "Mains")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = scoreColor(r.score);
                return (
                  <tr key={r.userId} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-2.5 py-2.5 text-[12.5px] font-semibold whitespace-nowrap" style={{ color: "var(--w)" }}>{r.name}</td>
                    <td className="px-2.5 py-2.5 text-center">
                      <span className="inline-block text-[12.5px] font-extrabold px-2 py-0.5 rounded-lg tabular-nums" style={{ color: c.fg, background: c.bg, border: `1px solid ${c.bd}` }}>{r.score}</span>
                    </td>
                    <td className="px-2.5 py-2.5 text-center text-[12px] tabular-nums" style={{ color: "var(--w2)" }}>{r.sessionsAttended}</td>
                    <td className="px-2.5 py-2.5 text-center text-[12px] tabular-nums" style={{ color: "var(--w2)" }}>{fmtDur(r.presentSeconds)}</td>
                    <td className="px-2.5 py-2.5 text-center text-[12px] tabular-nums" style={{ color: r.cameraPct >= 0.9 ? "var(--success)" : r.cameraPct >= 0.5 ? "var(--gold)" : "var(--danger)" }}>{pct(r.cameraPct)}</td>
                    <td className="px-2.5 py-2.5 text-center text-[12px] tabular-nums" style={{ color: "var(--w2)" }}>{fmtDur(r.speakingSeconds)}</td>
                    <td className="px-2.5 py-2.5 text-center text-[12px] tabular-nums" style={{ color: "var(--w2)" }}>{r.exerciseActions}</td>
                    <td className="px-2.5 py-2.5 text-center text-[12px] tabular-nums" style={{ color: "var(--w2)" }}>{r.handRaises}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10.5px] mt-2.5 leading-relaxed" style={{ color: "var(--w3)" }}>
            {T("Score blends camera discipline (40), speaking (30), participation (20) and attendance (10). Computed live from the ledger.",
               "Der Score kombiniert Kamera-Disziplin (40), Sprechen (30), Beteiligung (20) und Anwesenheit (10). Live aus dem Ledger berechnet.",
               "Le score combine discipline caméra (40), parole (30), participation (20) et présence (10). Calculé en direct depuis le registre.")}
          </p>
        </div>
      )}
    </div>
  );
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
  const [showStats, setShowStats] = useState(false);

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

      {/* Engagement scorecard — the data factory's output, live from the ledger */}
      <button onClick={() => setShowStats((s) => !s)} className="bv-row-hover inline-flex items-center gap-2 text-[12.5px] font-semibold px-3 py-2.5 mt-3 rounded-xl w-full justify-center" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}>
        <BarChart3 size={15} style={{ color: "var(--gold)" }} />
        {showStats ? T("Hide engagement profiles", "Engagement-Profile ausblenden", "Masquer les profils") : T("View engagement profiles", "Engagement-Profile ansehen", "Voir les profils d'engagement")}
      </button>
      {showStats && <EngagementPanel authToken={authToken} lang={lang} />}
    </div>
  );
}
