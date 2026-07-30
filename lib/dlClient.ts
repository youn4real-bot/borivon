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
 */

import { useEffect, useState } from "react";

let cache: { src: string; token: string; exp: number } | null = null;
let inflight: { src: string; p: Promise<string> } | null = null;

export async function mintDlToken(authToken: string): Promise<string> {
  const now = Date.now() / 1000;
  if (cache && cache.src === authToken && cache.exp - now > 20) return cache.token;
  if (inflight && inflight.src === authToken) return inflight.p;

  const p = (async () => {
    const r = await fetch("/api/portal/dl-token", {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
    });
    if (!r.ok) throw new Error("dl-token mint failed: " + r.status);
    const j = (await r.json()) as { token: string; expiresInSec?: number };
    cache = { src: authToken, token: j.token, exp: Date.now() / 1000 + (j.expiresInSec ?? 180) };
    return j.token;
  })();
  inflight = { src: authToken, p };
  try {
    return await p;
  } finally {
    if (inflight && inflight.p === p) inflight = null;
  }
}

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

/**
 * React hook: a live download token, refreshed before expiry. For the
 * inline <IosPdfFrame src=…> previews that render synchronously.
 * Returns null until the first mint resolves.
 *
 * RETRIES FAST ON FAILURE, and that is the important part.
 *
 * On iPhone this token is not a nicety — it IS the download and it IS the
 * preview, because WebKit can carry no Authorization header on a navigation or
 * an iframe. Every caller therefore has some form of "no token yet, do nothing"
 * branch. Previously a single flaked mint set the token to null and the ONLY
 * path back was the 150-second refresh interval: on flaky Moroccan mobile data
 * one dropped request dead-buttoned every Download and froze every iOS preview
 * on a spinner for a full two and a half minutes, with no error and nothing the
 * candidate could do. That is the "it spins forever" report.
 *
 * Backing off 1s, 2s, 4s … capped at 20s means the page heals itself long
 * before she gives up, while a genuinely down endpoint is not hammered.
 */
export function useDlToken(authToken: string | null | undefined): string | null {
  const [tok, setTok] = useState<string | null>(
    cache && cache.src === authToken ? cache.token : null,
  );
  useEffect(() => {
    if (!authToken) { setTok(null); return; }
    let alive = true;
    let fails = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const refresh = () =>
      mintDlToken(authToken)
        .then(t => { if (!alive) return; fails = 0; setTok(t); })
        .catch(() => {
          if (!alive) return;
          setTok(null);
          const delay = Math.min(1000 * 2 ** fails++, 20_000);
          retry = setTimeout(refresh, delay);
        });
    refresh();
    const id = setInterval(refresh, 150_000);
    return () => { alive = false; clearInterval(id); if (retry) clearTimeout(retry); };
  }, [authToken]);
  return tok;
}
