/**
 * Turn the append-only classroom_events ledger into a per-person engagement
 * profile — the sellable artifact. Pure (no DB), computed from the ledger so it
 * never drifts. Camera is forced ON at join (the gate), so each session starts
 * camera-on until a camera_off event flips it.
 */

export type ClassroomEvent = {
  session_id: string | null;
  user_id: string | null;
  display_name?: string | null;
  kind: string;
  value?: { seconds?: number } | Record<string, unknown> | null;
  at: string; // ISO
};
export type ClassroomSession = { id: string; started_at?: string | null; ended_at?: string | null };

export type EngagementRow = {
  userId: string;
  name: string;
  sessionsAttended: number;
  attendanceRate: number;     // 0..1, sessions attended / total sessions
  presentSeconds: number;
  cameraOnSeconds: number;
  cameraPct: number;          // 0..1, camera-on share of present time
  cameraOffCount: number;     // how many times the camera was switched off
  speakingSeconds: number;
  speakingShare: number;      // 0..1, speaking share of present time
  exerciseActions: number;
  handRaises: number;
  avgJoinDelaySec: number | null; // punctuality: avg seconds after session start they joined (null = unknown)
  disengaged: boolean;        // present but camera mostly off + silent + no actions
  lastSeenAt: string | null;  // ISO of their most recent event
  score: number;              // 0..100 composite
};

const ms = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };

/** Per-(user,session) interval math → present + camera-on seconds. */
function sessionDurations(evs: ClassroomEvent[], sessionEndMs: number): { present: number; cameraOn: number } {
  const sorted = evs.slice().sort((a, b) => ms(a.at) - ms(b.at));
  let presentStart: number | null = null, present = 0;
  let camOn = false, camStart: number | null = null, cameraOn = 0;
  let lastTs = 0;
  for (const e of sorted) {
    const t = ms(e.at); lastTs = Math.max(lastTs, t);
    if (e.kind === "joined") { presentStart = t; camOn = true; camStart = t; }
    else if (e.kind === "left") {
      if (presentStart != null) { present += t - presentStart; presentStart = null; }
      if (camOn && camStart != null) { cameraOn += t - camStart; camStart = null; }
      camOn = false;
    } else if (e.kind === "camera_off") {
      if (camOn && camStart != null) { cameraOn += t - camStart; }
      camOn = false; camStart = null;
    } else if (e.kind === "camera_on") { camOn = true; camStart = t; }
  }
  const end = sessionEndMs || lastTs;
  if (presentStart != null && end > presentStart) present += end - presentStart;
  if (camOn && camStart != null && end > camStart) cameraOn += end - camStart;
  return { present: Math.max(0, present) / 1000, cameraOn: Math.max(0, cameraOn) / 1000 };
}

export function computeEngagement(
  events: ClassroomEvent[],
  sessions: ClassroomSession[],
  names: Record<string, string>,
): EngagementRow[] {
  const sessionEnd = new Map<string, number>();
  const sessionStart = new Map<string, number>();
  for (const s of sessions) {
    sessionEnd.set(s.id, s.ended_at ? ms(s.ended_at) : 0);
    sessionStart.set(s.id, s.started_at ? ms(s.started_at) : 0);
  }
  const totalSessions = sessions.length;

  // group events by user
  const byUser = new Map<string, ClassroomEvent[]>();
  for (const e of events) {
    if (!e.user_id) continue;
    const arr = byUser.get(e.user_id) ?? [];
    arr.push(e); byUser.set(e.user_id, arr);
  }

  const rows: EngagementRow[] = [];
  for (const [userId, evs] of byUser) {
    // sub-group by session for interval math + punctuality
    const bySession = new Map<string, ClassroomEvent[]>();
    for (const e of evs) { const k = e.session_id ?? "_"; const a = bySession.get(k) ?? []; a.push(e); bySession.set(k, a); }

    let present = 0, cameraOn = 0;
    const attended = new Set<string>();
    const joinDelays: number[] = [];
    for (const [sid, sevs] of bySession) {
      const joins = sevs.filter((e) => e.kind === "joined").map((e) => ms(e.at)).sort((a, b) => a - b);
      if (joins.length) attended.add(sid);
      const d = sessionDurations(sevs, sessionEnd.get(sid) ?? 0);
      present += d.present; cameraOn += d.cameraOn;
      // punctuality: first join vs session start (only if we know the start)
      const start = sessionStart.get(sid) ?? 0;
      if (start && joins.length) joinDelays.push(Math.max(0, (joins[0] - start) / 1000));
    }
    const speakingSeconds = evs.filter((e) => e.kind === "spoke").reduce((s, e) => s + (Number((e.value as { seconds?: number })?.seconds) || 0), 0);
    const exerciseActions = evs.filter((e) => e.kind === "exercise_action").length;
    const handRaises = evs.filter((e) => e.kind === "hand_raise").length;
    const cameraOffCount = evs.filter((e) => e.kind === "camera_off").length;
    const lastSeenMs = evs.reduce((mx, e) => Math.max(mx, ms(e.at)), 0);

    const cameraPct = present > 0 ? Math.min(1, cameraOn / present) : 0;
    const speakingShare = present > 0 ? Math.min(1, speakingSeconds / present) : 0;
    const avgJoinDelaySec = joinDelays.length ? Math.round(joinDelays.reduce((a, b) => a + b, 0) / joinDelays.length) : null;
    const attendanceRate = totalSessions > 0 ? attended.size / totalSessions : 0;
    // Disengaged: they showed up (>1 min present) but camera mostly off, barely
    // spoke, and took no actions — the candidate to nudge.
    const disengaged = present > 60 && cameraPct < 0.5 && speakingSeconds < 10 && (exerciseActions + handRaises) === 0;

    // Composite (transparent): camera discipline 40 · speaking 30 · participation 20 · attendance 10.
    const speakingNorm = Math.min(1, speakingSeconds / Math.max(1, present * 0.1)); // ~10% talk-time = full
    const partNorm = Math.min(1, (exerciseActions + handRaises) / 10);
    const score = Math.round(40 * cameraPct + 30 * speakingNorm + 20 * partNorm + 10 * (attended.size > 0 ? 1 : 0));

    rows.push({
      userId,
      name: names[userId] || evs.find((e) => e.display_name)?.display_name || "—",
      sessionsAttended: attended.size,
      attendanceRate,
      presentSeconds: Math.round(present),
      cameraOnSeconds: Math.round(cameraOn),
      cameraPct,
      cameraOffCount,
      speakingSeconds: Math.round(speakingSeconds),
      speakingShare,
      exerciseActions,
      handRaises,
      avgJoinDelaySec,
      disengaged,
      lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
      score,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows;
}

export type SessionSummary = {
  id: string;
  participants: number;
  avgScore: number;
  avgCameraPct: number;
  totalSpeakingSeconds: number;
  startedAt: string | null;
  endedAt: string | null;
};

/** One row per session: who showed up + how engaged the room was overall.
 *  Reuses computeEngagement scoped to each session's own events. */
export function computeSessionSummaries(
  events: ClassroomEvent[],
  sessions: ClassroomSession[],
  names: Record<string, string>,
): SessionSummary[] {
  return sessions.map((s) => {
    const evs = events.filter((e) => e.session_id === s.id);
    const rows = computeEngagement(evs, [s], names);
    const n = rows.length;
    return {
      id: s.id,
      participants: n,
      avgScore: n ? Math.round(rows.reduce((a, r) => a + r.score, 0) / n) : 0,
      avgCameraPct: n ? rows.reduce((a, r) => a + r.cameraPct, 0) / n : 0,
      totalSpeakingSeconds: rows.reduce((a, r) => a + r.speakingSeconds, 0),
      startedAt: s.started_at ?? null,
      endedAt: s.ended_at ?? null,
    };
  });
}
