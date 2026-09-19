"use client";

/**
 * Client helper for the iOS file-download token.
 *
 * iOS navigations/iframes can't carry an Authorization header, so file URLs
 * need a credential in the query. We no longer put the raw Supabase JWT
 * there — instead we exchange it (over a normal header'd fetch) for a
 * short-lived signed token via /api/portal/dl-token, and that goes in `?dlt=`.
 *
 * The token is cached per access-token for ~150s (server TTL is 180s) so
 * rapid actions don't spam the mint endpoint.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE 401 STORM (fixed here) — measured in production, 2026-09-16..19.
 *
 * 944 of the 962 total 401s the Worker served in 72 hours were this one
 * endpoint. That looks like "the mint is special". It is not. In the same
 * window the OTHER 401s were 18 requests spread over 14 different endpoints —
 * one or two each. At 19:04:42 the admin tab's `/api/portal/admin` 401'd too,
 * and one second later, after the tab re-bootstrapped and refreshed, EVERY
 * endpoint including this one answered 200.
 *
 * So the session in that tab was simply dead, and every endpoint was 401ing.
 * The difference is that every other endpoint fires once per click, 401s once,
 * and stops — while this one RETRIED, forever, and nobody was ever told.
 *
 * Worse, it retried faster the longer it ran. The old loop had a 150s
 * `setInterval` calling the same `refresh()` that the failure path re-armed,
 * and both wrote the single `retry` timer slot. Every interval tick during a
 * failure therefore forked a NEW retry chain and orphaned the previous one, so
 * chains only ever accumulated. One admin tab was measured at 149 mint attempts
 * in 267 seconds — one every 1.8s, i.e. ~11 concurrent chains all sitting at
 * the 20s ceiling, matching the ~29 minutes of 150s ticks that the tab had been
 * open on a dead session.
 *
 * Three things are fixed, and each has a test in tests/dlClient.test.ts:
 *   1. A 401 now costs ONE refreshSession attempt. If that doesn't produce a
 *      working session, the loop STOPS for good and the person is told to sign
 *      in again (`useDlSessionExpired` → SessionExpiredNotice) instead of
 *      hammering silently behind a spinner.
 *   2. ONE timer slot plus an in-flight guard, so the heartbeat can never fork
 *      a second chain. The chain count stays 1.
 *   3. The network-retry budget is finite (DL_MAX_TRANSIENT_ATTEMPTS).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import type { Lang } from "@/lib/translations";

export const DL_MINT_PATH = "/api/portal/dl-token";

/**
 * How many times one round may retry a TRANSIENT failure (network / 5xx / 429)
 * before giving up and waiting for the next heartbeat. Backoff is 1,2,4,8,16,20
 * — about 51 seconds of trying, which still covers the flaky-Moroccan-mobile-
 * data case the retry was added for, and then stops. Unbounded retrying is what
 * turned one dead session into 944 log lines.
 */
export const DL_MAX_TRANSIENT_ATTEMPTS = 6;

/** How often a healthy hook re-mints (server TTL is 180s). */
export const DL_HEARTBEAT_MS = 150_000;

// ─── Pure: token subjects ────────────────────────────────────────────────────

function decodeB64UrlJson(seg: string): Record<string, unknown> | null {
  try {
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? b64 : b64 + "=".repeat(4 - (b64.length % 4));
    const json = typeof atob === "function"
      ? decodeURIComponent(
          Array.from(atob(pad), c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
        )
      : Buffer.from(pad, "base64").toString("utf8");
    const obj: unknown = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The `sub` claim (= Supabase user id) of a Supabase access JWT, or null. */
export function jwtSubject(jwt: string | null | undefined): string | null {
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const sub = decodeB64UrlJson(parts[1])?.sub;
  return typeof sub === "string" && sub ? sub : null;
}

/**
 * The user id a minted download token is FOR. `signDlToken` (lib/dlToken.ts)
 * puts `{u,e}` in a plain b64url payload, so the client can read `u` without
 * the signing secret — it cannot forge one, but it can check one.
 */
export function dlTokenSubject(dlToken: string | null | undefined): string | null {
  if (!dlToken) return null;
  const dot = dlToken.indexOf(".");
  if (dot <= 0) return null;
  const u = decodeB64UrlJson(dlToken.slice(0, dot))?.u;
  return typeof u === "string" && u ? u : null;
}

/**
 * Does this download token belong to the session holding `authJwt`?
 *
 * The cache used to be keyed on the JWT string alone. That is a PROXY for the
 * session, not the session itself — and a proxy is not something to hand a
 * download credential on. This binds the two by user id, and fails CLOSED: if
 * either subject can't be read the answer is no, so an unreadable token is
 * simply never cached (we lose an optimisation, never correctness).
 */
export function dlTokenMatchesSession(
  dlToken: string | null | undefined,
  authJwt: string | null | undefined,
): boolean {
  const sub = jwtSubject(authJwt);
  const u = dlTokenSubject(dlToken);
  return !!sub && !!u && sub === u;
}

// ─── Pure: the retry decision core ───────────────────────────────────────────

export type MintOutcome =
  | { kind: "ok"; token: string }
  /** 401/403 — the SESSION is the problem, not the network. */
  | { kind: "auth" }
  | { kind: "ratelimit"; retryAfterSec: number }
  /** Network error, 5xx, malformed body — worth retrying for a while. */
  | { kind: "transient" };

export type DlRetryState = {
  /** How many transient failures this round has already slept on. */
  transientFails: number;
  /** Whether this round has already spent its ONE refreshSession attempt. */
  refreshed: boolean;
};

export type DlRetryPlan =
  | { action: "serve" }
  | { action: "refresh" }
  | { action: "wait"; delayMs: number }
  | { action: "stop"; reason: "session-expired" | "unavailable" };

/**
 * Pure decision core (the `planEarningReconciliation` pattern) — what to do
 * with one mint result. Every branch either serves, or consumes one of two
 * FINITE budgets: one refresh, and DL_MAX_TRANSIENT_ATTEMPTS sleeps. No branch
 * can loop forever, which is the property the storm violated.
 */
export function planDlRetry(outcome: MintOutcome, state: DlRetryState): DlRetryPlan {
  if (outcome.kind === "ok") return { action: "serve" };

  // A 401 is answered ONCE by refreshing the session. If we already did that
  // and it still 401s, the session is genuinely gone: stop and say so. The old
  // code retried this case forever at 20s intervals, per chain.
  if (outcome.kind === "auth") {
    return state.refreshed
      ? { action: "stop", reason: "session-expired" }
      : { action: "refresh" };
  }

  if (state.transientFails >= DL_MAX_TRANSIENT_ATTEMPTS) {
    return { action: "stop", reason: "unavailable" };
  }

  if (outcome.kind === "ratelimit") {
    // Honour Retry-After, clamped so a bad header can't park the page for an
    // hour or spin it at 0ms.
    const sec = Number.isFinite(outcome.retryAfterSec) ? outcome.retryAfterSec : 1;
    return { action: "wait", delayMs: Math.min(Math.max(sec, 1), 60) * 1000 };
  }

  return { action: "wait", delayMs: Math.min(1000 * 2 ** state.transientFails, 20_000) };
}

// ─── Cache (subject-bound) ───────────────────────────────────────────────────

type CacheEntry = { src: string; sub: string; token: string; exp: number };
let cache: CacheEntry | null = null;
let inflight: { src: string; p: Promise<string> } | null = null;

/**
 * Drop everything held for the previous session. Called whenever the auth token
 * changes, so nothing minted under an old session can outlive it — not even for
 * the 180s the download token would otherwise stay valid.
 */
export function resetDlTokenCache(): void {
  cache = null;
  inflight = null;
}

/** What the cache would serve for this JWT right now, or null. */
export function peekDlTokenCache(authToken: string, nowMs: number = Date.now()): string | null {
  if (!cache) return null;
  if (cache.src !== authToken) return null;
  // Re-verify the binding on every READ, not just on write: an entry that does
  // not belong to this session must be unusable no matter how it got there.
  if (cache.sub !== jwtSubject(authToken)) return null;
  if (!dlTokenMatchesSession(cache.token, authToken)) return null;
  if (cache.exp - nowMs / 1000 <= 20) return null;
  return cache.token;
}

function storeDlToken(authToken: string, token: string, expiresInSec: number): void {
  // Fail CLOSED: a token we cannot prove belongs to this session is handed back
  // to the caller that asked for it, but never kept where anyone else can pick
  // it up.
  if (!dlTokenMatchesSession(token, authToken)) return;
  const sub = jwtSubject(authToken);
  if (!sub) return;
  cache = { src: authToken, sub, token, exp: Date.now() / 1000 + expiresInSec };
}

// ─── Minting ─────────────────────────────────────────────────────────────────

/** One mint attempt, classified. Never throws. */
export async function mintDlTokenOutcome(authToken: string): Promise<MintOutcome> {
  let r: Response;
  try {
    r = await fetch(DL_MINT_PATH, {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
    });
  } catch {
    return { kind: "transient" };
  }
  if (r.status === 401 || r.status === 403) return { kind: "auth" };
  if (r.status === 429) {
    const ra = Number(r.headers.get("Retry-After"));
    return { kind: "ratelimit", retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : 5 };
  }
  if (!r.ok) return { kind: "transient" };
  try {
    const j = (await r.json()) as { token?: unknown; expiresInSec?: unknown };
    if (typeof j.token !== "string" || !j.token) return { kind: "transient" };
    const ttl = typeof j.expiresInSec === "number" ? j.expiresInSec : 180;
    storeDlToken(authToken, j.token, ttl);
    return { kind: "ok", token: j.token };
  } catch {
    return { kind: "transient" };
  }
}

/**
 * Mint (or reuse) a download token. THROWS on failure — `iosDownload`'s slow
 * path depends on that to show its error instead of failing quietly.
 */
export async function mintDlToken(authToken: string): Promise<string> {
  const cached = peekDlTokenCache(authToken);
  if (cached) return cached;
  if (inflight && inflight.src === authToken) return inflight.p;

  const p = (async () => {
    const outcome = await mintDlTokenOutcome(authToken);
    if (outcome.kind === "ok") return outcome.token;
    if (outcome.kind === "auth") {
      // A Download tapped on a dead session must say so too, not only the
      // background loop.
      noteSessionExpired();
      throw new Error("dl-token mint failed: session expired");
    }
    throw new Error("dl-token mint failed: " + outcome.kind);
  })();
  inflight = { src: authToken, p };
  try {
    return await p;
  } finally {
    if (inflight && inflight.p === p) inflight = null;
  }
}

// ─── Session refresh (single-flight) ─────────────────────────────────────────

let refreshInflight: Promise<string | null> | null = null;

/**
 * Spend ONE attempt at reviving the session. Single-flight across every hook
 * instance on the page: the admin page, an open preview modal and the passport
 * modal each hold their own loop, and three simultaneous refreshSession calls
 * against one dead refresh-token help nobody.
 */
export function refreshDlSession(): Promise<string | null> {
  if (refreshInflight) return refreshInflight;
  const p = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) return null;
      return data?.session?.access_token ?? null;
    } catch {
      return null;
    }
  })().finally(() => {
    if (refreshInflight === p) refreshInflight = null;
  });
  refreshInflight = p;
  return p;
}

// ─── The loop, as a testable driver ──────────────────────────────────────────

export type DlRoundDeps = {
  mint: (jwt: string) => Promise<MintOutcome>;
  refresh: () => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  /** False once the component unmounted / the auth token changed. */
  isAlive: () => boolean;
};

export type DlRoundResult = {
  token: string | null;
  /** The JWT that actually worked — a refresh may have replaced the input. */
  jwt: string;
  stopped: "session-expired" | "unavailable" | null;
};

/**
 * Run ONE round: mint, and follow `planDlRetry` until it serves or stops.
 *
 * Extracted from the hook so the behaviour that broke in production is testable
 * in a plain Node test (this suite has no jsdom) — the same reason
 * `planEarningReconciliation` exists.
 */
export async function runDlTokenRound(jwt: string, deps: DlRoundDeps): Promise<DlRoundResult> {
  let live = jwt;
  const state: DlRetryState = { transientFails: 0, refreshed: false };

  // A HARD structural bound, on top of planDlRetry's own budgets. A legitimate
  // round needs at most one refresh plus DL_MAX_TRANSIENT_ATTEMPTS waits, so
  // this can never fire in practice — it exists because the bug being fixed
  // here WAS an unbounded retry loop, and the next person to edit planDlRetry
  // should get a round that ends rather than a page that quietly hammers
  // production again.
  const maxSteps = DL_MAX_TRANSIENT_ATTEMPTS * 2 + 4;

  for (let step = 0; step < maxSteps; step++) {
    if (!deps.isAlive()) return { token: null, jwt: live, stopped: null };
    const outcome = await deps.mint(live);
    if (!deps.isAlive()) return { token: null, jwt: live, stopped: null };

    const plan = planDlRetry(outcome, state);
    if (plan.action === "serve") {
      return { token: outcome.kind === "ok" ? outcome.token : null, jwt: live, stopped: null };
    }
    if (plan.action === "stop") {
      return { token: null, jwt: live, stopped: plan.reason };
    }
    if (plan.action === "refresh") {
      state.refreshed = true;
      const fresh = await deps.refresh();
      // A refresh that gives back nothing — or the same dead token — means the
      // refresh token is gone too. There is nothing left to try, and retrying
      // the identical JWT is precisely the loop that produced the storm.
      if (!fresh || fresh === live) return { token: null, jwt: live, stopped: "session-expired" };
      live = fresh;
      state.transientFails = 0; // a working session earns the full network budget
      continue;
    }
    state.transientFails++;
    await deps.sleep(plan.delayMs);
  }
  return { token: null, jwt: live, stopped: "unavailable" };
}

// ─── "Your session expired" — a page-wide fact, not a per-component one ──────

let sessionExpired = false;
const expiryListeners = new Set<() => void>();

function noteSessionExpired(): void {
  if (sessionExpired) return;
  sessionExpired = true;
  for (const l of expiryListeners) l();
}

/** Called when a fresh auth token arrives — the session is alive again. */
export function clearDlSessionExpired(): void {
  if (!sessionExpired) return;
  sessionExpired = false;
  for (const l of expiryListeners) l();
}

/** Test seam. */
export function isDlSessionExpired(): boolean {
  return sessionExpired;
}

function subscribeExpiry(cb: () => void): () => void {
  expiryListeners.add(cb);
  return () => { expiryListeners.delete(cb); };
}

/**
 * True once the download loop has proven the session is dead (401 → refresh →
 * still 401). Lets any page render the notice with no prop drilling.
 */
export function useDlSessionExpired(): boolean {
  return useSyncExternalStore(subscribeExpiry, () => sessionExpired, () => false);
}

/** LAW #19 — every visible string in FR / EN / DE. */
export const DL_SESSION_EXPIRED_TEXT: Record<Lang, { title: string; body: string; cta: string }> = {
  fr: {
    title: "Session expirée",
    body: "Votre session a expiré. Reconnectez-vous pour ouvrir et télécharger les documents.",
    cta: "Se reconnecter",
  },
  en: {
    title: "Session expired",
    body: "Your session has expired. Sign in again to open and download documents.",
    cta: "Sign in again",
  },
  de: {
    title: "Sitzung abgelaufen",
    body: "Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an, um Dokumente zu öffnen und herunterzuladen.",
    cta: "Erneut anmelden",
  },
};

// ─── URL helpers (unchanged) ─────────────────────────────────────────────────

/**
 * Strip any legacy `access_token` param and set `dlt=<token>`.
 * Pure — safe to call in render once a token exists.
 */
export function withDlt(url: string, token: string): string {
  const [path, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.delete("access_token");
  params.set("dlt", token);
  return `${path}?${params.toString()}`;
}

/** Async: mint a fresh token and rewrite `url` to use it. For event handlers. */
export async function appendDlt(url: string, authToken: string): Promise<string> {
  const token = await mintDlToken(authToken);
  return withDlt(url, token);
}

// ─── The hook ────────────────────────────────────────────────────────────────

export type DlTokenState = {
  token: string | null;
  /** The session is gone and the loop has stopped. Show the notice. */
  sessionExpired: boolean;
};

/**
 * React hook: a live download token, refreshed before expiry. For the
 * inline <IosPdfFrame src=…> previews that render synchronously.
 * Returns null until the first mint resolves.
 *
 * On iPhone this token is not a nicety — it IS the download and it IS the
 * preview, because WebKit can carry no Authorization header on a navigation or
 * an iframe. Every caller therefore has some form of "no token yet, do nothing"
 * branch, so a token that never arrives is a dead Download button and a preview
 * frozen on a spinner, with nothing on screen to explain it.
 *
 * It still retries a flaked mint fast (1s, 2s, 4s …) — one dropped request on
 * mobile data must not dead-button the page for a full heartbeat. What it no
 * longer does is retry a DEAD SESSION, or run more than one chain: see the
 * storm note at the top of this file.
 */
export function useDlTokenState(authToken: string | null | undefined): DlTokenState {
  const [token, setToken] = useState<string | null>(() =>
    authToken ? peekDlTokenCache(authToken) : null,
  );
  const expired = useDlSessionExpired();

  useEffect(() => {
    if (!authToken) { setToken(null); return; }

    // A new auth token means a new session. Nothing minted for the previous one
    // may survive into it, and a session that failed before deserves a clean try.
    resetDlTokenCache();
    clearDlSessionExpired();

    let alive = true;
    let busy = false;
    // ONE timer slot. Every schedule goes through `arm`, which clears the
    // previous timer first — this is what makes a second chain impossible.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let live = authToken;

    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void tick(); }, ms);
    };

    const tick = async () => {
      // The heartbeat must never start a round while one is already running —
      // that overlap is exactly how the old loop grew a chain every 150s.
      if (!alive || busy) return;
      busy = true;
      try {
        const res = await runDlTokenRound(live, {
          mint: mintDlTokenOutcome,
          refresh: refreshDlSession,
          sleep: (ms) => new Promise<void>(r => setTimeout(r, ms)),
          isAlive: () => alive,
        });
        if (!alive) return;
        live = res.jwt;
        setToken(res.token);
        if (res.stopped === "session-expired") {
          // Terminal. No heartbeat, no retry: the page says so instead, and the
          // next real token (a sign-in, or the page's own onAuthStateChange)
          // re-runs this effect from scratch.
          noteSessionExpired();
          return;
        }
        // "unavailable" still gets the heartbeat — a network outage heals, and
        // this round's own retry budget is already spent.
        arm(DL_HEARTBEAT_MS);
      } finally {
        busy = false;
      }
    };

    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [authToken]);

  return { token, sessionExpired: expired };
}

/** Back-compat: just the token. Callers that show the notice use the state hook. */
export function useDlToken(authToken: string | null | undefined): string | null {
  return useDlTokenState(authToken).token;
}

/** Sign out and send the person to the login page. */
export function useDlReauth(): () => void {
  return useCallback(() => {
    void supabase.auth
      .signOut()
      .catch(() => {})
      .then(() => { window.location.href = "/portal"; });
  }, []);
}
