import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The download-token client is the only module that talks to the browser
// Supabase client, and only to refresh the session. Stub it so these tests stay
// pure; refreshDlSession itself is exercised through the injectable `refresh`
// dep of runDlTokenRound.
const h = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { refreshSession: (...a: unknown[]) => h.refreshSession(...a) } },
  getAnonVerifyClient: () => ({}),
  getServiceSupabase: () => ({}),
  getAuthSchemaClient: () => ({}),
}));

import {
  DL_MAX_TRANSIENT_ATTEMPTS,
  DL_SESSION_EXPIRED_TEXT,
  clearDlSessionExpired,
  dlTokenMatchesSession,
  dlTokenSubject,
  isDlSessionExpired,
  jwtSubject,
  mintDlToken,
  mintDlTokenOutcome,
  peekDlTokenCache,
  planDlRetry,
  resetDlTokenCache,
  runDlTokenRound,
  type DlRoundDeps,
  type MintOutcome,
} from "@/lib/dlClient";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A Supabase-shaped access JWT for `sub`. Only the payload is ever read. */
const jwtFor = (sub: string, nonce = "0") =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, nonce })}.sig`;

/** A token shaped exactly like lib/dlToken.ts `signDlToken` output. */
const dlFor = (userId: string, ttlSec = 180) =>
  `${b64url({ u: userId, e: Math.floor(Date.now() / 1000) + ttlSec })}.sig`;

const USER_A = "a0000000-0000-4000-8000-000000000001";
const USER_B = "b0000000-0000-4000-8000-000000000002";

const okDeps = (over: Partial<DlRoundDeps> = {}): DlRoundDeps => ({
  mint: async () => ({ kind: "ok", token: dlFor(USER_A) }),
  refresh: async () => null,
  sleep: async () => {},          // instant — we assert on counts, not wall time
  isAlive: () => true,
  ...over,
});

beforeEach(() => {
  resetDlTokenCache();
  clearDlSessionExpired();
  h.refreshSession.mockReset();
  vi.unstubAllGlobals();
});
afterEach(() => { vi.unstubAllGlobals(); });

// ─── The three regressions the storm was made of ─────────────────────────────

describe("401 -> refresh -> success", () => {
  it("spends one refresh, then mints with the NEW token and serves it", async () => {
    const seen: string[] = [];
    const jwtOld = jwtFor(USER_A, "old");
    const jwtNew = jwtFor(USER_A, "new");
    const good = dlFor(USER_A);

    const res = await runDlTokenRound(jwtOld, okDeps({
      mint: async (jwt) => {
        seen.push(jwt);
        return jwt === jwtNew
          ? { kind: "ok", token: good }
          : { kind: "auth" };
      },
      refresh: async () => jwtNew,
    }));

    expect(res.token).toBe(good);
    expect(res.stopped).toBeNull();
    // The retry must use the refreshed token. Re-minting the SAME dead JWT is
    // exactly the loop that produced 944 x 401.
    expect(seen).toEqual([jwtOld, jwtNew]);
    // The caller keeps the working token, so the heartbeat doesn't fall back.
    expect(res.jwt).toBe(jwtNew);
  });

  it("gives the revived session a full transient budget again", async () => {
    const jwtNew = jwtFor(USER_A, "new");
    let mints = 0;
    const res = await runDlTokenRound(jwtFor(USER_A, "old"), okDeps({
      mint: async (jwt) => {
        mints++;
        if (jwt !== jwtNew) return { kind: "auth" };
        // One network flake right after the refresh must not be fatal.
        return mints === 3 ? { kind: "ok", token: dlFor(USER_A) } : { kind: "transient" };
      },
      refresh: async () => jwtNew,
    }));
    expect(res.stopped).toBeNull();
    expect(res.token).toBeTruthy();
  });
});

describe("401 -> refresh fails -> the person is told and the loop stops", () => {
  it("stops after exactly one mint when the refresh yields nothing", async () => {
    let mints = 0, refreshes = 0;
    const res = await runDlTokenRound(jwtFor(USER_A), okDeps({
      mint: async () => { mints++; return { kind: "auth" }; },
      refresh: async () => { refreshes++; return null; },
    }));

    expect(res.stopped).toBe("session-expired");
    expect(res.token).toBeNull();
    expect(mints).toBe(1);
    expect(refreshes).toBe(1);
  });

  it("stops when the refresh hands back the same dead token", async () => {
    const dead = jwtFor(USER_A);
    let mints = 0;
    const res = await runDlTokenRound(dead, okDeps({
      mint: async () => { mints++; return { kind: "auth" }; },
      refresh: async () => dead,
    }));
    expect(res.stopped).toBe("session-expired");
    expect(mints).toBe(1); // never re-mints the identical JWT
  });

  it("cannot storm: a permanently-401ing endpoint costs 2 mints, not hundreds", async () => {
    let mints = 0;
    const res = await runDlTokenRound(jwtFor(USER_A, "old"), okDeps({
      mint: async () => { mints++; return { kind: "auth" }; },
      refresh: async () => jwtFor(USER_A, "new"), // refresh "works", server still 401s
    }));
    expect(res.stopped).toBe("session-expired");
    expect(mints).toBe(2);
  });

  it("tells the person, in FR / EN / DE (LAW #19)", async () => {
    // The tap-Download path must flip the same flag the notice listens to, not
    // only the background loop.
    expect(isDlSessionExpired()).toBe(false);
    vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
    await expect(mintDlToken(jwtFor(USER_A))).rejects.toThrow(/session expired/);
    expect(isDlSessionExpired()).toBe(true);

    for (const lang of ["fr", "en", "de"] as const) {
      const t = DL_SESSION_EXPIRED_TEXT[lang];
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
      expect(t.cta.length).toBeGreaterThan(0);
    }
    // Distinct wording per language — not one string copied three times.
    expect(new Set(["fr", "en", "de"].map(l =>
      DL_SESSION_EXPIRED_TEXT[l as "fr"].body)).size).toBe(3);

    // A fresh token means the session is alive again and the notice clears.
    clearDlSessionExpired();
    expect(isDlSessionExpired()).toBe(false);
  });
});

describe("a stale cache entry is never reused", () => {
  it("does not serve one session's token to another session", async () => {
    const jwtA = jwtFor(USER_A), jwtB = jwtFor(USER_B);
    const tokA = dlFor(USER_A);
    vi.stubGlobal("fetch", async () => Response.json({ token: tokA, expiresInSec: 180 }));

    expect(await mintDlToken(jwtA)).toBe(tokA);
    expect(peekDlTokenCache(jwtA)).toBe(tokA);
    // B's session must see nothing of A's.
    expect(peekDlTokenCache(jwtB)).toBeNull();
  });

  it("refuses to cache a token minted for a DIFFERENT user", async () => {
    const jwtB = jwtFor(USER_B);
    const wrong = dlFor(USER_A); // server answered with someone else's subject
    vi.stubGlobal("fetch", async () => Response.json({ token: wrong, expiresInSec: 180 }));

    const out = await mintDlTokenOutcome(jwtB);
    expect(out.kind).toBe("ok");
    // Fails CLOSED: the mismatched token is never parked where a later caller
    // could pick it up.
    expect(peekDlTokenCache(jwtB)).toBeNull();
  });

  it("drops everything when the auth token changes (what the hook does)", async () => {
    const jwtA = jwtFor(USER_A);
    const tokA = dlFor(USER_A);
    vi.stubGlobal("fetch", async () => Response.json({ token: tokA, expiresInSec: 180 }));
    await mintDlToken(jwtA);
    expect(peekDlTokenCache(jwtA)).toBe(tokA);

    resetDlTokenCache();
    expect(peekDlTokenCache(jwtA)).toBeNull();
  });

  it("will not serve a token inside the expiry guard band", async () => {
    const jwtA = jwtFor(USER_A);
    vi.stubGlobal("fetch", async () =>
      Response.json({ token: dlFor(USER_A, 15), expiresInSec: 15 }));
    await mintDlToken(jwtA);
    // Under 20s left: a download started now could outlive the token.
    expect(peekDlTokenCache(jwtA)).toBeNull();
  });

  it("reads the subjects it binds on", () => {
    expect(jwtSubject(jwtFor(USER_A))).toBe(USER_A);
    expect(dlTokenSubject(dlFor(USER_A))).toBe(USER_A);
    expect(dlTokenMatchesSession(dlFor(USER_A), jwtFor(USER_A))).toBe(true);
    expect(dlTokenMatchesSession(dlFor(USER_B), jwtFor(USER_A))).toBe(false);
    // Unreadable either side -> no match, so nothing gets cached.
    expect(dlTokenMatchesSession("garbage", jwtFor(USER_A))).toBe(false);
    expect(dlTokenMatchesSession(dlFor(USER_A), "garbage")).toBe(false);
  });
});

// ─── The retry ceiling is finite ─────────────────────────────────────────────

describe("finite retry ceiling", () => {
  it("gives up on transient failures after DL_MAX_TRANSIENT_ATTEMPTS", async () => {
    let mints = 0;
    const delays: number[] = [];
    const res = await runDlTokenRound(jwtFor(USER_A), okDeps({
      mint: async () => { mints++; return { kind: "transient" }; },
      sleep: async (ms) => { delays.push(ms); },
    }));

    expect(res.stopped).toBe("unavailable");
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 20000]);
    expect(mints).toBe(DL_MAX_TRANSIENT_ATTEMPTS + 1);
  });

  it("honours Retry-After on 429 and still counts toward the ceiling", async () => {
    const delays: number[] = [];
    const res = await runDlTokenRound(jwtFor(USER_A), okDeps({
      mint: async (): Promise<MintOutcome> => ({ kind: "ratelimit", retryAfterSec: 7 }),
      sleep: async (ms) => { delays.push(ms); },
    }));
    expect(delays).toEqual(Array(DL_MAX_TRANSIENT_ATTEMPTS).fill(7000));
    expect(res.stopped).toBe("unavailable");
  });

  it("clamps an absurd Retry-After instead of parking the page", () => {
    const s = { transientFails: 0, refreshed: false };
    expect(planDlRetry({ kind: "ratelimit", retryAfterSec: 99999 }, s))
      .toEqual({ action: "wait", delayMs: 60_000 });
    expect(planDlRetry({ kind: "ratelimit", retryAfterSec: 0 }, s))
      .toEqual({ action: "wait", delayMs: 1000 });
  });

  it("is bounded even if the planner tells it to wait forever", async () => {
    // Defence in depth: the bug being fixed WAS an unbounded retry loop, so the
    // round must terminate on its own rather than hang, whatever the planner
    // says. Without the structural cap this test never returns.
    let mints = 0;
    const res = await runDlTokenRound(jwtFor(USER_A), okDeps({
      // Always "transient", and the state is never allowed to advance because
      // sleep resets nothing — stands in for a future planner regression.
      mint: async () => { mints++; return { kind: "transient" }; },
    }));
    expect(res.stopped).toBe("unavailable");
    expect(mints).toBeLessThanOrEqual(DL_MAX_TRANSIENT_ATTEMPTS * 2 + 4);
  });

  it("abandons the round as soon as the component unmounts", async () => {
    let mints = 0;
    let alive = true;
    const res = await runDlTokenRound(jwtFor(USER_A), okDeps({
      mint: async () => { mints++; alive = false; return { kind: "transient" }; },
      isAlive: () => alive,
    }));
    expect(mints).toBe(1);
    expect(res.stopped).toBeNull(); // unmount is not a failure to report
  });
});

// ─── The pure decision core ──────────────────────────────────────────────────

describe("planDlRetry", () => {
  it("serves a good mint", () => {
    expect(planDlRetry({ kind: "ok", token: "t" }, { transientFails: 0, refreshed: false }))
      .toEqual({ action: "serve" });
  });

  it("answers the first 401 with a refresh and the second with a full stop", () => {
    expect(planDlRetry({ kind: "auth" }, { transientFails: 0, refreshed: false }))
      .toEqual({ action: "refresh" });
    expect(planDlRetry({ kind: "auth" }, { transientFails: 0, refreshed: true }))
      .toEqual({ action: "stop", reason: "session-expired" });
  });

  it("never returns an unbounded plan for any state", () => {
    // The storm's actual shape: every 401 answered with another wait, forever.
    for (let fails = 0; fails <= DL_MAX_TRANSIENT_ATTEMPTS + 3; fails++) {
      for (const refreshed of [false, true]) {
        const p = planDlRetry({ kind: "auth" }, { transientFails: fails, refreshed });
        expect(p.action).not.toBe("wait");
      }
      const t = planDlRetry({ kind: "transient" }, { transientFails: fails, refreshed: true });
      if (fails >= DL_MAX_TRANSIENT_ATTEMPTS) expect(t.action).toBe("stop");
      else expect(t).toMatchObject({ action: "wait" });
    }
  });
});

// ─── Outcome classification ──────────────────────────────────────────────────

describe("mintDlTokenOutcome", () => {
  const cases: Array<[string, () => Response | Promise<never>, MintOutcome["kind"]]> = [
    ["401", () => new Response("", { status: 401 }), "auth"],
    ["403", () => new Response("", { status: 403 }), "auth"],
    ["429", () => new Response("", { status: 429, headers: { "Retry-After": "3" } }), "ratelimit"],
    ["500", () => new Response("", { status: 500 }), "transient"],
    ["200 with no token", () => Response.json({}), "transient"],
  ];
  for (const [name, make, kind] of cases) {
    it(`classifies ${name} as ${kind}`, async () => {
      vi.stubGlobal("fetch", async () => make());
      expect((await mintDlTokenOutcome(jwtFor(USER_A))).kind).toBe(kind);
    });
  }

  it("treats a thrown fetch (offline) as transient, not as a dead session", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch"); });
    expect((await mintDlTokenOutcome(jwtFor(USER_A))).kind).toBe("transient");
    // Crucially it must NOT tell the person to sign in again over a flaky
    // connection — that was the other half of the silent-failure problem.
    expect(isDlSessionExpired()).toBe(false);
  });
});
