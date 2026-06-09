import { describe, it, expect } from "vitest";
import { computeEngagement, type ClassroomEvent } from "@/lib/classroomEngagement";

const iso = (base: number, addSec: number) => new Date(base + addSec * 1000).toISOString();
const T0 = Date.parse("2026-06-09T10:00:00.000Z");

function ev(p: Partial<ClassroomEvent> & { kind: string; at: string; user_id?: string }): ClassroomEvent {
  return { session_id: "s1", user_id: p.user_id ?? "u1", display_name: null, kind: p.kind, value: p.value ?? {}, at: p.at };
}

describe("computeEngagement", () => {
  it("counts a full-camera 10-minute session as 100% camera", () => {
    const events: ClassroomEvent[] = [
      ev({ kind: "joined", at: iso(T0, 0) }),
      ev({ kind: "left", at: iso(T0, 600) }),
    ];
    const [row] = computeEngagement(events, [{ id: "s1" }], {});
    expect(row.presentSeconds).toBe(600);
    expect(row.cameraOnSeconds).toBe(600); // camera forced on at join
    expect(row.cameraPct).toBe(1);
    expect(row.sessionsAttended).toBe(1);
  });

  it("halves camera-on when the camera is off for half the session", () => {
    const events: ClassroomEvent[] = [
      ev({ kind: "joined", at: iso(T0, 0) }),
      ev({ kind: "camera_off", at: iso(T0, 300) }),
      ev({ kind: "left", at: iso(T0, 600) }),
    ];
    const [row] = computeEngagement(events, [{ id: "s1" }], {});
    expect(row.presentSeconds).toBe(600);
    expect(row.cameraOnSeconds).toBe(300);
    expect(row.cameraPct).toBe(0.5);
  });

  it("re-enabling the camera resumes counting", () => {
    const events: ClassroomEvent[] = [
      ev({ kind: "joined", at: iso(T0, 0) }),
      ev({ kind: "camera_off", at: iso(T0, 200) }),
      ev({ kind: "camera_on", at: iso(T0, 400) }),
      ev({ kind: "left", at: iso(T0, 600) }),
    ];
    const [row] = computeEngagement(events, [{ id: "s1" }], {});
    expect(row.cameraOnSeconds).toBe(400); // 0-200 + 400-600
    expect(row.cameraPct).toBeCloseTo(0.6667, 3);
  });

  it("sums speaking spans and counts participation actions", () => {
    const events: ClassroomEvent[] = [
      ev({ kind: "joined", at: iso(T0, 0) }),
      ev({ kind: "spoke", at: iso(T0, 60), value: { seconds: 30 } }),
      ev({ kind: "spoke", at: iso(T0, 120), value: { seconds: 30 } }),
      ev({ kind: "exercise_action", at: iso(T0, 130) }),
      ev({ kind: "hand_raise", at: iso(T0, 140) }),
      ev({ kind: "left", at: iso(T0, 600) }),
    ];
    const [row] = computeEngagement(events, [{ id: "s1" }], {});
    expect(row.speakingSeconds).toBe(60);
    expect(row.exerciseActions).toBe(1);
    expect(row.handRaises).toBe(1);
  });

  it("a perfect session scores high, a camera-off no-participation session scores low", () => {
    const good = computeEngagement([
      ev({ kind: "joined", at: iso(T0, 0) }),
      ev({ kind: "spoke", at: iso(T0, 100), value: { seconds: 120 } }),
      ev({ kind: "exercise_action", at: iso(T0, 200) }),
      ev({ kind: "exercise_action", at: iso(T0, 250) }),
      ev({ kind: "left", at: iso(T0, 600) }),
    ], [{ id: "s1" }], {})[0];

    const bad = computeEngagement([
      ev({ kind: "joined", at: iso(T0, 0) }),
      ev({ kind: "camera_off", at: iso(T0, 1) }),
      ev({ kind: "left", at: iso(T0, 600) }),
    ], [{ id: "s1" }], {})[0];

    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.score).toBeGreaterThanOrEqual(70);
    expect(bad.cameraPct).toBeLessThan(0.05);
  });

  it("prefers the canonical name over the ledger display_name", () => {
    const events: ClassroomEvent[] = [
      { session_id: "s1", user_id: "u1", display_name: "typed nickname", kind: "joined", value: {}, at: iso(T0, 0) },
      ev({ kind: "left", at: iso(T0, 60) }),
    ];
    const [row] = computeEngagement(events, [{ id: "s1" }], { u1: "Doha Zini" });
    expect(row.name).toBe("Doha Zini");
  });

  it("falls back to a still-open session using the session ended_at", () => {
    // joined but never 'left' (tab closed); session has an ended_at → present capped there
    const events: ClassroomEvent[] = [ev({ kind: "joined", at: iso(T0, 0) })];
    const [row] = computeEngagement(events, [{ id: "s1", ended_at: iso(T0, 300) }], {});
    expect(row.presentSeconds).toBe(300);
  });
});
