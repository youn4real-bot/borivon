"use client";

import { useEffect, useRef } from "react";
import {
  LiveKitRoom, VideoConference, RoomAudioRenderer,
  useLocalParticipant, useIsSpeaking, useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Hand, BookOpen, Video } from "lucide-react";

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
export default function ClassroomRoom({
  authToken, connToken, url, roomName, sessionId, displayName, lang, onLeave,
}: {
  authToken: string; connToken: string; url: string; roomName: string;
  sessionId: string | null; displayName: string; lang: Lang; onLeave: () => void;
}) {
  const T = (en: string, de: string, fr: string) => (lang === "de" ? de : lang === "fr" ? fr : en);
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b0b0d", display: "flex", flexDirection: "column", zIndex: 1000 }}>
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
          <Telemetry token={authToken} sessionId={sessionId} roomName={roomName} displayName={displayName} />
        </LiveKitRoom>
      </div>
    </div>
  );
}
