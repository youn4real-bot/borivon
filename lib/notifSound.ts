/**
 * Premium notification chime — synthesized with the Web Audio API.
 *
 * No asset, no network: a soft two-tone bell (A5 → E6, sine, gentle decay)
 * that reads as "premium", not a system beep.
 *
 * Autoplay correctness: browsers create an AudioContext SUSPENDED and only
 * truly unlock it when `resume()` runs *inside a user gesture*. A lazy
 * resume() at chime time is ignored by Chrome/Safari → "I don't hear it".
 * So we unlock on the very FIRST interaction anywhere (pointer/key/touch)
 * with a silent blip; every chime after that is audible. Throttled; never
 * throws; silent until that first interaction (unavoidable per policy).
 */

let ctx: AudioContext | null = null;
let unlocked = false;
let last = 0;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  return ctx;
}

function unlock(): void {
  const c = getCtx();
  if (!c) return;
  c.resume().then(() => { unlocked = true; }).catch(() => {});
  // A 1-sample silent tick fully flips iOS/Safari into the running state.
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.02);
  } catch { /* ignore */ }
  unlocked = true;
}

if (typeof window !== "undefined") {
  const onFirst = () => {
    unlock();
    window.removeEventListener("pointerdown", onFirst);
    window.removeEventListener("keydown", onFirst);
    window.removeEventListener("touchstart", onFirst);
    window.removeEventListener("click", onFirst);
  };
  window.addEventListener("pointerdown", onFirst, { passive: true });
  window.addEventListener("keydown", onFirst);
  window.addEventListener("touchstart", onFirst, { passive: true });
  window.addEventListener("click", onFirst, { passive: true });
}

export function playNotifChime(): void {
  const now = Date.now();
  if (now - last < 1200) return; // throttle bursts
  last = now;
  const c = getCtx();
  if (!c) return;
  // Re-resume defensively (tab was backgrounded, context auto-suspended).
  if (c.state === "suspended") c.resume().catch(() => {});
  if (!unlocked && c.state !== "running") return; // pre-gesture: stay silent
  try {
    const t0 = c.currentTime + 0.01;
    const note = (freq: number, start: number, dur: number, peak: number) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(c.destination);
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.03);
    };
    // Clearly audible on a laptop at normal volume, still refined.
    note(880.0, 0.0, 0.30, 0.32);   // A5
    note(1318.5, 0.10, 0.38, 0.26); // E6
  } catch {
    /* never throw for a chime */
  }
}
