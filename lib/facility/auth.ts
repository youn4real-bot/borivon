/**
 * Facility logins: no passwords. A session cookie (HttpOnly, 30 days) after the signup or after a
 * one-time email link (15 minutes for a login, 7 days for a team invite). Only token HASHES are stored.
 */
import type { NextRequest } from "next/server";
import { fxDb, hashToken, randomToken, nowIso, rowFacility, rowUser, type Facility, type FxUser } from "./db";

export const COOKIE = "bv_fx";
const SESSION_DAYS = 30;
const LOGIN_MIN = 15;
const INVITE_DAYS = 7;

export type FxAuth = { user: FxUser; facility: Facility };

/** Mutating requests must come from our own pages (cookies are SameSite=Lax too). */
export function sameOrigin(req: NextRequest): boolean {
  const o = req.headers.get("origin");
  if (!o) return true; // same-origin fetches from older browsers omit it; SameSite=Lax still applies
  try { return new URL(o).host === req.nextUrl.host || new URL(o).host === "borivon.com" || new URL(o).host === "www.borivon.com"; }
  catch { return false; }
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** Start a session for a user; returns the raw token for the cookie. */
export async function createSession(userId: string): Promise<string> {
  const db = await fxDb();
  if (!db) throw new Error("no_db");
  const token = randomToken();
  const now = new Date();
  await db.run(`INSERT INTO fx_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    [await hashToken(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400e3).toISOString()]);
  await db.run(`UPDATE fx_users SET last_login_at = ? WHERE id = ?`, [now.toISOString(), userId]);
  return token;
}

/** The signed-in facility user, or null. */
export async function requireFacility(req: NextRequest): Promise<FxAuth | null> {
  const token = req.cookies.get(COOKIE)?.value ?? "";
  if (token.length < 30 || token.length > 60) return null;
  const db = await fxDb();
  if (!db) return null;
  const { results } = await db.run(
    `SELECT u.*, s.expires_at AS s_exp FROM fx_sessions s JOIN fx_users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    [await hashToken(token)],
  );
  const r = results[0];
  if (!r || String(r.s_exp) < nowIso()) return null;
  const user = rowUser(r);
  const f = await db.run(`SELECT * FROM fx_facilities WHERE id = ?`, [user.facility_id]);
  if (!f.results[0]) return null;
  const facility = rowFacility(f.results[0]);
  if (facility.status !== "active") return null;
  return { user, facility };
}

export async function endSession(req: NextRequest): Promise<void> {
  const token = req.cookies.get(COOKIE)?.value ?? "";
  const db = await fxDb();
  if (db && token) await db.run(`DELETE FROM fx_sessions WHERE token_hash = ?`, [await hashToken(token)]);
}

/** A one-time email link token (login or team invite). */
export async function createLink(kind: "login" | "invite", email: string, facilityId = ""): Promise<string> {
  const db = await fxDb();
  if (!db) throw new Error("no_db");
  const token = randomToken();
  const now = new Date();
  const ttl = kind === "login" ? LOGIN_MIN * 60e3 : INVITE_DAYS * 86400e3;
  await db.run(`INSERT INTO fx_links (token_hash, kind, email, facility_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [await hashToken(token), kind, email, facilityId, now.toISOString(), new Date(now.getTime() + ttl).toISOString()]);
  return token;
}

/** Use a link once. Returns what it was for, or null when unknown / used / expired. */
export async function useLink(token: string): Promise<{ kind: "login" | "invite"; email: string; facilityId: string } | null> {
  if (token.length < 30 || token.length > 60) return null;
  const db = await fxDb();
  if (!db) return null;
  const h = await hashToken(token);
  const { results } = await db.run(`SELECT * FROM fx_links WHERE token_hash = ?`, [h]);
  const r = results[0];
  if (!r || String(r.used_at) || String(r.expires_at) < nowIso()) return null;
  // mark used first; a second click of the same mail finds it used
  const upd = await db.run(`UPDATE fx_links SET used_at = ? WHERE token_hash = ? AND used_at = ''`, [nowIso(), h]);
  if ((upd.meta.changes ?? 1) === 0) return null;
  const kind = String(r.kind) === "invite" ? "invite" : "login";
  return { kind, email: String(r.email), facilityId: String(r.facility_id) };
}

/** Housekeeping (called now and then): expired sessions and links go. */
export async function pruneAuth(): Promise<void> {
  const db = await fxDb();
  if (!db) return;
  const now = nowIso();
  await db.run(`DELETE FROM fx_sessions WHERE expires_at < ?`, [now]);
  await db.run(`DELETE FROM fx_links WHERE expires_at < ?`, [new Date(Date.now() - 7 * 86400e3).toISOString()]);
}
