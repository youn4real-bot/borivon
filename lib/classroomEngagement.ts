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
export type ClassroomSession = { id: string; ended_at?: string | null };

export type EngagementRow = {
  userId: string;
  name: string;
  sessionsAttended: number;
  presentSeconds: number;
  cameraOnSeconds: number;
  cameraPct: number;        // 0..1, camera-on share of present time
  speakingSeconds: number;
  speakingShare: number;    // 0..1, speaking share of present time
  exerciseActions: number;
  handRaises: number;
  score: number;            // 0..100 composite
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
  for (const s of sessions) sessionEnd.set(s.id, s.ended_at ? ms(s.ended_at) : 0);

  // group events by user
  const byUser = new Map<string, ClassroomEvent[]>();
  for (const e of events) {
    if (!e.user_id) continue;
    const arr = byUser.get(e.user_id) ?? [];
    arr.push(e); byUser.set(e.user_id, arr);
  }

  const rows: EngagementRow[] = [];
  for (const [userId, evs] of byUser) {
    // sub-group by session for interval math
    const bySession = new Map<string, ClassroomEvent[]>();
    for (const e of evs) { const k = e.session_id ?? "_"; const a = bySession.get(k) ?? []; a.push(e); bySession.set(k, a); }

    let present = 0, cameraOn = 0;
    const attended = new Set<string>();
    for (const [sid, sevs] of bySession) {
      if (sevs.some((e) => e.kind === "joined")) attended.add(sid);
      const d = sessionDurations(sevs, sessionEnd.get(sid) ?? 0);
      present += d.present; cameraOn += d.cameraOn;
    }
    const speakingSeconds = evs.filter((e) => e.kind === "spoke").reduce((s, e) => s + (Number((e.value as { seconds?: number })?.seconds) || 0), 0);
    const exerciseActions = evs.filter((e) => e.kind === "exercise_action").length;
    const handRaises = evs.filter((e) => e.kind === "hand_raise").length;

    const cameraPct = present > 0 ? Math.min(1, cameraOn / present) : 0;
    const speakingShare = present > 0 ? Math.min(1, speakingSeconds / present) : 0;
    // Composite (transparent): camera discipline 40 · speaking 30 · participation 20 · attendance 10.
    const speakingNorm = Math.min(1, speakingSeconds / Math.max(1, present * 0.1)); // ~10% talk-time = full
    const partNorm = Math.min(1, (exerciseActions + handRaises) / 10);
    const score = Math.round(40 * cameraPct + 30 * speakingNorm + 20 * partNorm + 10 * (attended.size > 0 ? 1 : 0));

    rows.push({
      userId,
      name: names[userId] || evs.find((e) => e.display_name)?.display_name || "—",
      sessionsAttended: attended.size,
      presentSeconds: Math.round(present),
      cameraOnSeconds: Math.round(cameraOn),
      cameraPct,
      speakingSeconds: Math.round(speakingSeconds),
      speakingShare,
      exerciseActions,
      handRaises,
      score,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows;
}
