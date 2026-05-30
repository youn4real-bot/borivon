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
 */
export function useDlToken(authToken: string | null | undefined): string | null {
  const [tok, setTok] = useState<string | null>(
    cache && cache.src === authToken ? cache.token : null,
  );
  useEffect(() => {
    if (!authToken) { setTok(null); return; }
    let alive = true;
    const refresh = () =>
      mintDlToken(authToken)
        .then(t => { if (alive) setTok(t); })
        .catch(() => { if (alive) setTok(null); });
    refresh();
    const id = setInterval(refresh, 150_000);
    return () => { alive = false; clearInterval(id); };
  }, [authToken]);
  return tok;
}
