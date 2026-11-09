"use client";

/**
 * The analytics beacon for the React pages (the seat-check calendar, the Fahrplan viewer). Same rules
 * as public/pflege/assets/t.js: NOTHING is measured before the visitor said "Akzeptieren" on the
 * consent banner (stored as bv_consent, same origin, so the /workshop frame sees the parent's choice).
 * Without consent a booking still carries the link's own src/utm/lid (no device data). Never a form value.
 */

type Ctx = { path: string; src: string; utm: string; ref: string; lid: string; lang: string; screen: string; sid: string; vid: string };

let ctx: Ctx | null = null;
let queue: { type: string; name: string; value: string; t: number }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function consented(): boolean {
  try {
    if (localStorage.getItem("bv_no_track") === "1") return false;
    const c = JSON.parse(localStorage.getItem("bv_consent") || "null") as { v?: number; s?: number; t?: number } | null;
    return !!c && c.v === 1 && c.s === 1 && Date.now() - (c.t ?? 0) < 395 * 86_400_000;
  } catch { return false; }
}

export function trackContext(): Ctx | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const q = new URLSearchParams(location.search);
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  const ok = consented();
  let vid = "";
  try { vid = ok ? localStorage.getItem("bv_vid") ?? "" : ""; } catch { /* blocked */ }
  ctx = {
    path: location.pathname,
    src: q.get("src") || q.get("utm_source") || q.get("via") || "",
    utm: ["utm_medium", "utm_campaign", "utm_content", "utm_term"].map((k) => q.get(k) || "").join("|").replace(/^\|+$/, ""),
    // device data only with consent; inside the frame the parent's referrer arrives as ?ref=
    ref: ok ? q.get("ref") || document.referrer || "" : "",
    lid: q.get("lid") || "",
    lang: ok ? (navigator.language || "").slice(0, 16) : "",
    screen: ok ? `${screen.width || 0}x${screen.height || 0}` : "",
    sid: q.get("sid") || [...a].map((b) => b.toString(16).padStart(2, "0")).join(""),
    vid: /^[0-9a-f]{32}$/.test(vid) ? vid : "",
  };
  addEventListener("pagehide", () => flush(true));
  return ctx;
}

function flush(beacon = false) {
  const c = trackContext();
  if (!c || !queue.length || !consented()) { queue = []; return; }
  const now = Date.now();
  const events = queue.splice(0, 60).map((e) => ({ type: e.type, name: e.name, value: e.value, ago: now - e.t }));
  const body = JSON.stringify({ c: 1, ...c, events });
  try {
    if (beacon && navigator.sendBeacon?.("/api/t", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/t", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* never break the page */ }
}

/** Queue one event (only with consent); sent within a second, or right away when the page is left. */
export function track(type: string, name?: string | number, value?: string | number): void {
  if (typeof window === "undefined" || !consented()) return;
  trackContext();
  queue.push({ type, name: name == null ? "" : String(name).slice(0, 80), value: value == null ? "" : String(value).slice(0, 200), t: Date.now() });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(false), 800);
}

/** A page that knows its lead (the Fahrplan viewer) ties its events to it. */
export function setTrackLead(leadId: string): void {
  const c = trackContext();
  if (c && /^[0-9a-f-]{36}$/i.test(leadId)) c.lid = leadId;
}

/** What a booking carries so the server can credit it: the link's params always, device data only with consent. */
export function trackPayload(): Partial<Ctx> {
  const c = trackContext();
  if (!c) return {};
  return consented()
    ? { src: c.src, utm: c.utm, ref: c.ref, lid: c.lid, sid: c.sid, path: c.path, vid: c.vid }
    : { src: c.src, utm: c.utm, lid: c.lid, sid: c.sid, path: c.path };
}
