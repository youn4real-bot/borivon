/**
 * First-party analytics (founder 2026-11-09): where visitors come from (tracked links, UTM,
 * referrer), how far they get (Fahrplan quiz → submit → confirm → PDF → workshop → booking),
 * and where they drop off.
 *
 * Built to be legal in Germany WITHOUT a cookie banner:
 *   • nothing is stored on the visitor's device (no cookie, no localStorage ID); a visit is one
 *     page load (in-memory id) and a visitor is a hash of IP + browser that changes every day,
 *     so nobody can be followed across days (the Plausible / Fathom model);
 *   • IPs are stored shortened (IPv4 /24, IPv6 /48); the full IP is never written;
 *   • form fields are tracked by NAME only (focused / filled), never what was typed;
 *   • the visitor's company network (ASN organisation, e.g. a hospital group) and the city come
 *     from Cloudflare's own lookup of the connecting IP.
 * Raw D1 (lib/d1/client) on purpose: a high-volume append-only table has no business in the
 * Supabase-shaped adapter, its write journal or d1/types.json.
 */
import { getD1, type D1Runner } from "@/lib/d1/client";

export const EVENT_TYPES = [
  "click",        // a tracked link /l/<code> was opened (server)
  "view",         // a page was shown
  "scroll",       // 25 / 50 / 75 / 100 % of the page seen
  "cta",          // a link or button was clicked (label in name, target in value)
  "field_focus",  // a form field was entered (field name only)
  "field_done",   // a form field was left: value "1" filled, "0" empty — never its content
  "q_view",       // Fahrplan quiz: a question was shown (name = question id)
  "q_answer",     // Fahrplan quiz: a choice was picked (name = question id, value = choice id)
  "form_submit",  // Fahrplan request saved (server)
  "confirm",      // double opt-in clicked (server)
  "pdf_open",     // the Fahrplan opened on the website (server)
  "pdf_download", // the Fahrplan downloaded (server)
  "pdf_cta",      // a link inside the Fahrplan was clicked
  "book_view",    // the seat-check calendar was shown
  "book_day",     // a day was picked
  "book_time",    // a time was picked
  "book_details", // the details step was reached
  "book_done",    // a call was booked (server)
  "leave",        // the page was left (value = ms on page)
  "consent",      // "Akzeptieren" on the banner: proof of consent (value = consent id), Art. 7(1) DSGVO
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
const TYPE_SET = new Set<string>(EVENT_TYPES);

/** One row as written. Every field is a string so the JSON insert never meets a NULL. */
type Row = {
  at: string; type: string; path: string; src: string; utm: string; ref: string;
  visitor: string; sid: string; country: string; region: string; city: string; org: string;
  ip: string; device: string; os: string; browser: string; lang: string; screen: string;
  name: string; value: string; lead_id: string;
};
const COLS: (keyof Row)[] = [
  "at", "type", "path", "src", "utm", "ref", "visitor", "sid", "country", "region", "city", "org",
  "ip", "device", "os", "browser", "lang", "screen", "name", "value", "lead_id",
];

const DDL = [
  `CREATE TABLE IF NOT EXISTS track_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ${COLS.map((c) => `${c} TEXT NOT NULL DEFAULT ''`).join(",\n    ")}
  )`,
  `CREATE INDEX IF NOT EXISTS track_events_at ON track_events(at)`,
  `CREATE INDEX IF NOT EXISTS track_events_type_at ON track_events(type, at)`,
  `CREATE INDEX IF NOT EXISTS track_events_src_at ON track_events(src, at)`,
  `CREATE INDEX IF NOT EXISTS track_events_lead ON track_events(lead_id)`,
  `CREATE TABLE IF NOT EXISTS track_links (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '/fahrplan',
    created_at TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0
  )`,
];

let ready: Promise<void> | null = null;
/** Create the two tables on first use (idempotent, once per isolate). */
export async function trackDb(): Promise<D1Runner | null> {
  const db = await getD1();
  if (!db) return null;
  ready ??= (async () => { for (const sql of DDL) await db.run(sql); })().catch((e) => { ready = null; throw e; });
  await ready;
  return db;
}

/* ───────────────────────────── enrichment ───────────────────────────── */

/** IPv4 → a.b.c.0, IPv6 → first 3 groups. The full address is never stored. */
export function anonymizeIp(ip: string): string {
  const v = (ip || "").trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v.replace(/\.\d{1,3}$/, ".0");
  if (v.includes(":")) return v.split(":").slice(0, 3).join(":") + "::";
  return "";
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|slack|curl|wget|python|httpclient|okhttp|axios|node-fetch|headless|lighthouse|pingdom|uptime|monitor|scanner|semrush|ahrefs|bingpreview|google-inspectiontool|chrome-lighthouse/i;
export function isBot(ua: string): boolean {
  return !ua || BOT.test(ua);
}

export function parseUa(ua: string): { device: string; os: string; browser: string } {
  const u = ua || "";
  const device = /iPad|Tablet|Android(?!.*Mobile)/i.test(u) ? "tablet" : /Mobi|iPhone|Android/i.test(u) ? "mobile" : "desktop";
  const os =
    /iPhone|iPad|iPod/i.test(u) ? "iOS" :
    /Android/i.test(u) ? "Android" :
    /Windows/i.test(u) ? "Windows" :
    /CrOS/i.test(u) ? "ChromeOS" :
    /Mac OS X|Macintosh/i.test(u) ? "macOS" :
    /Linux/i.test(u) ? "Linux" : "";
  const browser =
    /LinkedInApp/i.test(u) ? "LinkedIn app" :
    /Instagram/i.test(u) ? "Instagram app" :
    /FBAN|FBAV/i.test(u) ? "Facebook app" :
    /Edg\//i.test(u) ? "Edge" :
    /OPR\/|Opera/i.test(u) ? "Opera" :
    /SamsungBrowser/i.test(u) ? "Samsung" :
    /Firefox\/|FxiOS/i.test(u) ? "Firefox" :
    /CriOS|Chrome\//i.test(u) ? "Chrome" :
    /Safari\//i.test(u) ? "Safari" : "";
  return { device, os, browser };
}

/** Host of an outside referrer ("" for our own pages). */
export function refHost(ref: string): string {
  const v = (ref || "").trim();
  if (!v) return "";
  try {
    const h = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, "");
    return /(^|\.)borivon\.com$/.test(h) || h === "localhost" ? "" : h.slice(0, 80);
  } catch { return ""; }
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function berlinDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Same person + browser + day → same id; tomorrow a new one. No storage on the device. */
export async function visitorId(ip: string, ua: string, now: number = Date.now()): Promise<string> {
  const salt = process.env.TRACK_SALT || process.env.DL_TOKEN_SECRET || "borivon";
  return (await sha256hex(`${salt}|${berlinDay(now)}|${ip}|${ua}`)).slice(0, 16);
}

type Geo = { country: string; region: string; city: string; org: string };
async function geoOf(h: Headers): Promise<Geo> {
  let cf: Record<string, unknown> | undefined;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    cf = getCloudflareContext().cf as Record<string, unknown> | undefined;
  } catch { /* not on Workers */ }
  const s = (v: unknown, n = 80) => (typeof v === "string" ? v.slice(0, n) : "");
  return {
    country: s(cf?.country, 2) || s(h.get("cf-ipcountry"), 2),
    region: s(cf?.region),
    city: s(cf?.city),
    org: s(cf?.asOrganization),
  };
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, n);

/** What a page (or the server) knows about the visit the events belong to. */
export type VisitContext = {
  path?: string; src?: string; utm?: string; ref?: string; sid?: string;
  lid?: string; lang?: string; screen?: string;
  /** Only with consent: the random browser id (bv_vid) that recognises a returning visitor. */
  vid?: string;
};
export type InEvent = { type: string; name?: unknown; value?: unknown; ago?: unknown; lead_id?: unknown };

/** Turn a request + events into rows (pure apart from the hash/geo lookups; exported for tests). */
export async function buildRows(h: Headers, ctx: VisitContext, events: InEvent[], now: number = Date.now()): Promise<Row[]> {
  const ua = h.get("user-agent") ?? "";
  if (isBot(ua)) return [];
  const ip = h.get("cf-connecting-ip") ?? (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
  // with consent the browser's own random id (returning visitors); otherwise the daily-changing hash
  const consentVid = /^[0-9a-f]{32}$/.test(ctx.vid ?? "") ? (ctx.vid as string).slice(0, 16) : "";
  const [daily, geo] = await Promise.all([consentVid ? Promise.resolve("") : visitorId(ip, ua, now), geoOf(h)]);
  const visitor = consentVid ? `v${consentVid}` : daily;
  const { device, os, browser } = parseUa(ua);
  const lead = /^[0-9a-f-]{36}$/i.test(ctx.lid ?? "") ? (ctx.lid as string) : "";
  return events
    .filter((e) => e && TYPE_SET.has(e.type))
    .slice(0, 60)
    .map((e) => {
      const ago = Math.min(3_600_000, Math.max(0, Number(e.ago) || 0));
      const lid = typeof e.lead_id === "string" && /^[0-9a-f-]{36}$/i.test(e.lead_id) ? e.lead_id : lead;
      return {
        at: new Date(now - ago).toISOString(),
        type: e.type,
        path: clip(ctx.path, 120),
        src: clip(ctx.src, 60).toLowerCase(),
        utm: clip(ctx.utm, 200),
        ref: refHost(clip(ctx.ref, 300)),
        visitor,
        sid: clip(ctx.sid, 40),
        ...geo,
        ip: anonymizeIp(ip),
        device, os, browser,
        lang: clip(ctx.lang, 16),
        screen: clip(ctx.screen, 16),
        name: clip(e.name, 80),
        value: clip(e.value, 200),
        lead_id: lid,
      };
    });
}

/** Write rows in ONE statement (json_each), so D1's 100-parameter limit never bites. */
export async function insertRows(rows: Row[]): Promise<void> {
  if (!rows.length) return;
  const db = await trackDb();
  if (!db) return;
  const sel = COLS.map((c) => `json_extract(value, '$.${c}')`).join(", ");
  await db.run(`INSERT INTO track_events (${COLS.join(", ")}) SELECT ${sel} FROM json_each(?)`, [JSON.stringify(rows)]);
}

/**
 * Record events from server code (submit, confirm, PDF, booking). Never throws: analytics must
 * never break the request it watches.
 */
export async function trackServer(req: { headers: Headers }, ctx: VisitContext, events: InEvent[]): Promise<void> {
  try {
    await insertRows(await buildRows(req.headers, ctx, events));
  } catch (e) {
    console.error("[track] server event failed:", e instanceof Error ? e.message : e);
  }
}

/** Retention (privacy policy section 12): events older than 14 months go. Returns rows deleted, -1 on trouble. */
export async function pruneTrackEvents(now: number = Date.now()): Promise<number> {
  try {
    const db = await trackDb();
    if (!db) return -1;
    const cutoff = new Date(now - 426 * 86_400_000).toISOString();
    const out = await db.run(`DELETE FROM track_events WHERE at < ?`, [cutoff]);
    return Number((out as { meta?: { changes?: number } }).meta?.changes ?? 0);
  } catch (e) {
    console.error("[track] prune failed:", e instanceof Error ? e.message : e);
    return -1;
  }
}

/** The tracking context a page sends along with a form/booking (shape-checked, never trusted). */
export function readTrack(v: unknown): VisitContext {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    src: clip(o.src, 60), utm: clip(o.utm, 200), ref: clip(o.ref, 300), sid: clip(o.sid, 40),
    lid: clip(o.lid, 40), path: clip(o.path, 120), lang: clip(o.lang, 16), screen: clip(o.screen, 16),
    vid: clip(o.vid, 32),
  };
}
