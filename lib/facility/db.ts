/**
 * The facility platform (borivon.com/einrichtung, founder 2026-11-10): a free workspace for a
 * Gesundheitseinrichtung, unlocked by the personal link on the last page of its Fahrplan.
 *
 * Deliberately its OWN accounts, not Supabase logins: every non-staff Supabase user is treated as a
 * candidate (admin lists, document reminders, chase lists). A facility must never land there.
 * Raw D1 (like lib/track/server.ts): small tables, created on first use.
 *
 * Free scope (Nutzungsbedingungen § 3): FREE_NURSES nurses + FREE_USERS users per facility, for good.
 * The website never names the numbers; the terms do, and the app says it when the limit is reached.
 */
import { getD1, type D1Runner, type D1Row } from "@/lib/d1/client";

export const FREE_NURSES = 5;
export const FREE_USERS = 2;
/** Bump when the Nutzungsbedingungen / AVV text changes; stored with each acceptance. */
export const TERMS_VERSION = "2026-11-10";

const DDL = [
  `CREATE TABLE IF NOT EXISTS fx_facilities (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    street TEXT NOT NULL DEFAULT '',
    plz TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    terms_version TEXT NOT NULL DEFAULT '',
    terms_at TEXT NOT NULL DEFAULT '',
    terms_ip TEXT NOT NULL DEFAULT '',
    avv_at TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS fx_facilities_lead ON fx_facilities(lead_id)`,
  `CREATE TABLE IF NOT EXISTS fx_users (
    id TEXT PRIMARY KEY,
    facility_id TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    salutation TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT '',
    last_login_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS fx_users_facility ON fx_users(facility_id)`,
  `CREATE TABLE IF NOT EXISTS fx_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS fx_sessions_user ON fx_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS fx_links (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    email TEXT NOT NULL,
    facility_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS fx_nurses (
    id TEXT PRIMARY KEY,
    facility_id TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    arrival TEXT NOT NULL DEFAULT '',
    start TEXT NOT NULL DEFAULT '',
    plz TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    steps TEXT NOT NULL DEFAULT '{}',
    share_token TEXT NOT NULL DEFAULT '',
    sample INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS fx_nurses_facility ON fx_nurses(facility_id)`,
  `CREATE INDEX IF NOT EXISTS fx_nurses_share ON fx_nurses(share_token)`,
  `CREATE TABLE IF NOT EXISTS fx_geo (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
  // OpenStreetMap places for the arrival plan (scripts/fx-places-pack.mjs fills it)
  `CREATE TABLE IF NOT EXISTS fx_places (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    hours TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    w REAL NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS fx_places_kind_lat ON fx_places(kind, lat)`,
];

let ready: Promise<void> | null = null;
let readyFor: D1Runner | null = null;

/** The D1 runner with the tables in place (idempotent, once per isolate), or null without D1. */
export async function fxDb(): Promise<D1Runner | null> {
  const db = await getD1();
  if (!db) return null;
  if (readyFor !== db) { ready = null; readyFor = db; }
  ready ??= (async () => { for (const sql of DDL) await db.run(sql); })().catch((e) => { ready = null; throw e; });
  await ready;
  return db;
}

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** 32 random bytes, base64url: unguessable tokens for sessions, links and the nurse's share link. */
export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Only the hash of a token is stored: a leaked table never opens a session. */
export async function hashToken(token: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export type Facility = { id: string; lead_id: string; name: string; kind: string; street: string; plz: string; city: string; status: string; created_at: string };
export type FxUser = { id: string; facility_id: string; email: string; salutation: string; last_name: string; role: "owner" | "member"; created_at: string; last_login_at: string };
export type Nurse = {
  id: string; facility_id: string; first_name: string; last_name: string; country: string;
  arrival: string; start: string; plz: string; city: string; steps: Record<string, string>;
  share_token: string; sample: boolean; created_at: string; updated_at: string;
};

const str = (r: D1Row, k: string) => (r[k] == null ? "" : String(r[k]));

export function rowFacility(r: D1Row): Facility {
  return { id: str(r, "id"), lead_id: str(r, "lead_id"), name: str(r, "name"), kind: str(r, "kind"), street: str(r, "street"), plz: str(r, "plz"), city: str(r, "city"), status: str(r, "status"), created_at: str(r, "created_at") };
}
export function rowUser(r: D1Row): FxUser {
  return { id: str(r, "id"), facility_id: str(r, "facility_id"), email: str(r, "email"), salutation: str(r, "salutation"), last_name: str(r, "last_name"), role: str(r, "role") === "owner" ? "owner" : "member", created_at: str(r, "created_at"), last_login_at: str(r, "last_login_at") };
}
export function rowNurse(r: D1Row): Nurse {
  let steps: Record<string, string> = {};
  try {
    const p = JSON.parse(str(r, "steps") || "{}");
    if (p && typeof p === "object" && !Array.isArray(p)) for (const [k, v] of Object.entries(p)) if (typeof v === "string") steps[k] = v;
  } catch { steps = {}; }
  return {
    id: str(r, "id"), facility_id: str(r, "facility_id"), first_name: str(r, "first_name"), last_name: str(r, "last_name"),
    country: str(r, "country"), arrival: str(r, "arrival"), start: str(r, "start"), plz: str(r, "plz"), city: str(r, "city"),
    steps, share_token: str(r, "share_token"), sample: Number(r.sample) === 1, created_at: str(r, "created_at"), updated_at: str(r, "updated_at"),
  };
}

/* ── input cleaning: short plain strings only ─────────────────────────────────────────────────── */
export const clean = (v: unknown, max = 80) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
export const cleanPlz = (v: unknown) => (typeof v === "string" && /^\d{5}$/.test(v.trim()) ? v.trim() : "");
/** YYYY-MM-DD within a sane window, else "". */
export function cleanDate(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "";
  const t = Date.parse(v + "T00:00:00Z");
  if (!Number.isFinite(t)) return "";
  const y = Number(v.slice(0, 4));
  return y >= 2020 && y <= 2040 ? v : "";
}
export const cleanEmail = (v: unknown) => {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};
