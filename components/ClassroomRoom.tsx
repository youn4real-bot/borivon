"use client";

import { useEffect, useRef, useState } from "react";
import {
  LiveKitRoom, VideoConference, RoomAudioRenderer,
  useLocalParticipant, useIsSpeaking, useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import type { LocalVideoTrack } from "livekit-client";
import { Hand, BookOpen, Video, Sparkles } from "lucide-react";

export type Lang = "fr" | "en" | "de";

/** Fire-and-forget telemetry into the classroom ledger. Shared by admin + candidate. */
export function logClassroomEvent(
  token: string,
  payload: { sessionId: string | null; roomName: string; kind: string; value?: Record<string, unknown>; displayName?: string },
) {
  fetch("/api/portal/admin/classroom/event", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

/** Camera-on gate — blocks participation when the camera is off (no auto-kick). */
function CameraGate({ lang }: { lang: Lang }) {
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

/** The data factory: join/leave, camera on/off, mic on/off, real speaking seconds → ledger. */
function Telemetry({ token, sessionId, roomName, displayName }: { token: string; sessionId: string | null; roomName: string; displayName: string }) {
  const room = useRoomContext();
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
  const speaking = useIsSpeaking(localParticipant);
  const speakStart = useRef<number | null>(null);
  const base = { sessionId, roomName, displayName };

  useEffect(() => {
    logClassroomEvent(token, { ...base, kind: "joined" });
    return () => {
      if (speakStart.current) {
        const secs = Math.round((performance.now() - speakStart.current) / 1000);
        if (secs >= 1) logClassroomEvent(token, { ...base, kind: "spoke", value: { seconds: secs } });
      }
      logClassroomEvent(token, { ...base, kind: "left" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const camFirst = useRef(true);
  useEffect(() => {
    if (camFirst.current) { camFirst.current = false; return; }
    logClassroomEvent(token, { ...base, kind: isCameraEnabled ? "camera_on" : "camera_off" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraEnabled]);

  const micFirst = useRef(true);
  useEffect(() => {
    if (micFirst.current) { micFirst.current = false; return; }
    logClassroomEvent(token, { ...base, kind: isMicrophoneEnabled ? "mic_on" : "mic_off" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMicrophoneEnabled]);

  useEffect(() => {
    if (speaking) {
      if (!speakStart.current) speakStart.current = performance.now();
    } else if (speakStart.current) {
      const secs = Math.round((performance.now() - speakStart.current) / 1000);
      speakStart.current = null;
      if (secs >= 1) logClassroomEvent(token, { ...base, kind: "spoke", value: { seconds: secs } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speaking]);

  useEffect(() => {
    const onBeforeUnload = () => { if (room.state === "connected") logClassroomEvent(token, { ...base, kind: "left" }); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/**
 * The full in-room experience — identical for admin and candidate. Camera-on
 * gate, telemetry ledger, plus the hand-raise + log-exercise-action controls.
 */
/** Virtual backgrounds — blur (light/strong) + a few clean studio gradients.
 *  Lazy-loads the segmentation processor (browser-only) on first use, so it
 *  never touches SSR/the build. */
function BackgroundControl({ lang }: { lang: Lang }) {
  const { cameraTrack } = useLocalParticipant();
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("none");
  const [busy, setBusy] = useState(false);

  const grad = (a: string, b: string) =>
    "data:image/svg+xml;utf8," + encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='1280' height='720' fill='url(#g)'/></svg>`);
  const IMAGES: Record<string, string> = {
    studio:  grad("#374151", "#0b1220"),
    ocean:   grad("#0ea5e9", "#1e3a8a"),
    borivon: grad("#f59e0b", "#7c2d12"),
  };

  async function apply(id: string) {
    const track = cameraTrack?.track as LocalVideoTrack | undefined;
    if (!track || busy) return;
    setBusy(true);
    try {
      if (id === "none") { await track.stopProcessor(); }
      else {
        const tp = await import("@livekit/track-processors");
        const proc = id === "blur1" ? tp.BackgroundBlur(8)
          : id === "blur2" ? tp.BackgroundBlur(20)
          : tp.VirtualBackground(IMAGES[id]);
        await track.setProcessor(proc);
      }
      setActive(id);
    } catch (e) { console.error("[classroom bg]", e instanceof Error ? e.message : e); }
    setBusy(false); setOpen(false);
  }

  const opts: { id: string; label: string }[] = [
    { id: "none",    label: T("No background", "Kein Hintergrund", "Aucun fond") },
    { id: "blur1",   label: T("Blur", "Unschärfe", "Flou") },
    { id: "blur2",   label: T("Strong blur", "Starke Unschärfe", "Flou fort") },
    { id: "studio",  label: T("Studio (dark)", "Studio (dunkel)", "Studio (sombre)") },
    { id: "ocean",   label: T("Ocean", "Ozean", "Océan") },
    { id: "borivon", label: T("Borivon gold", "Borivon-Gold", "Borivon or") },
  ];

  return (
    <div style={{ position: "absolute", top: 12, right: 12, zIndex: 26 }}>
      <button onClick={() => setOpen((o) => !o)} disabled={busy}
        className="bv-press inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-lg disabled:opacity-60"
        style={{ background: "rgba(18,18,22,0.82)", color: "#fff", border: "1px solid var(--border)", backdropFilter: "blur(6px)" }}>
        <Sparkles size={13} /> {T("Background", "Hintergrund", "Arrière-plan")}
      </button>
      {open && (
        <div className="mt-1 rounded-xl overflow-hidden" style={{ position: "absolute", right: 0, minWidth: 190, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-md)" }}>
          {opts.map((o) => (
            <button key={o.id} onClick={() => apply(o.id)} disabled={busy}
              className="bv-row-hover w-full text-left px-3 py-2 text-[12.5px] flex items-center justify-between disabled:opacity-60"
              style={{ color: active === o.id ? "var(--gold)" : "var(--w)" }}>
              {o.label}{active === o.id ? <span>✓</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClassroomRoom({
  authToken, connToken, url, roomName, sessionId, displayName, lang, onLeave,
}: {
  authToken: string; connToken: string; url: string; roomName: string;
  sessionId: string | null; displayName: string; lang: Lang; onLeave: () => void;
}) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b0b0d", display: "flex", flexDirection: "column", zIndex: 1400 }}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5" style={{ background: "var(--card)", borderBottom: "1px solid var(--border)" }}>
        <span className="text-[13px] font-semibold" style={{ color: "var(--w)" }}>🎓 {roomName}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => logClassroomEvent(authToken, { sessionId, roomName, displayName, kind: "hand_raise" })} className="bv-press inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-lg" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px solid var(--border)" }}><Hand size={13} /> {T("Raise hand", "Melden", "Lever la main")}</button>
          <button onClick={() => logClassroomEvent(authToken, { sessionId, roomName, displayName, kind: "exercise_action", value: { test: true } })} className="bv-press inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-lg" style={{ background: "var(--gdim)", color: "var(--gold)", border: "1px solid var(--border-gold)" }}><BookOpen size={13} /> {T("Log exercise action", "Übungsaktion loggen", "Logger une action")}</button>
          <button onClick={onLeave} className="bv-press text-[12px] font-bold px-3 py-2 rounded-lg" style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>{T("Leave", "Verlassen", "Quitter")}</button>
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", minHeight: 0 }} data-lk-theme="default">
        <LiveKitRoom token={connToken} serverUrl={url} connect video audio style={{ height: "100%" }} onDisconnected={onLeave}>
          <VideoConference />
          <RoomAudioRenderer />
          <CameraGate lang={lang} />
          <BackgroundControl lang={lang} />
          <Telemetry token={authToken} sessionId={sessionId} roomName={roomName} displayName={displayName} />
        </LiveKitRoom>
      </div>
    </div>
  );
}
