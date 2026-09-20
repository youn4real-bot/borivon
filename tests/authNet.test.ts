import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  withTimeout, fetchWithTimeout, authErrorMessage, errText,
  TIMEOUT_MARK, AUTH_NET_TIMEOUT_MS,
} from "../lib/authNet";

/**
 * THE FIRST SCREEN EVERY CANDIDATE TOUCHES MUST NOT BE ABLE TO HANG.
 *
 * A nurse fills in the registration form on Moroccan mobile data, taps "Sign
 * up", and the button becomes a grey "…" that never changes back. The handler
 * ran `setLoading(true)` and then `await fetch("/api/portal/invite/…")` with
 * no deadline and no try/catch, so it could not learn that its own request had
 * died: a reject escaped the handler (nothing cleared `loading`), and a stall —
 * a radio that simply stops answering, raising nothing — left it awaiting a
 * promise that never settled. She has no error, nothing to tap, and no idea
 * whether she now has an account.
 *
 * Two halves are tested here: the deadline that turns "never settles" into a
 * throw, and the message that throw becomes in her own language.
 */

/** A promise that never settles — a stalled connection, not a failed one. */
function stalled<T>(): Promise<T> {
  return new Promise<T>(() => { /* deliberately never resolves */ });
}

describe("withTimeout — a stalled call becomes a failure the handler can see", () => {
  it("THE BUG: a call that never answers rejects instead of hanging forever", async () => {
    await expect(withTimeout(stalled<string>(), 10)).rejects.toThrow(TIMEOUT_MARK);
  });

  it("passes a successful result straight through", async () => {
    await expect(withTimeout(Promise.resolve({ ok: true }), 50)).resolves.toEqual({ ok: true });
  });

  it("passes the work's own rejection through unchanged (not masked as a timeout)", async () => {
    await expect(withTimeout(Promise.reject(new Error("Invalid login credentials")), 50))
      .rejects.toThrow("Invalid login credentials");
  });

  it("clears its timer once the work settles — a pending 20s alarm would keep the radio awake", async () => {
    const pending = new Set<unknown>();
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      const id = realSet(fn, ms); pending.add(id); return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: unknown) => {
      pending.delete(id); return realClear(id as ReturnType<typeof setTimeout>);
    }) as unknown as typeof clearTimeout;
    try {
      await withTimeout(Promise.resolve(1), 10_000);
      expect(pending.size).toBe(0);
    } finally {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    }
  });

  it("the default deadline is long enough for slow 3G but short enough to be seen", () => {
    expect(AUTH_NET_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(AUTH_NET_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("fetchWithTimeout — the dead request is actually aborted", () => {
  it("THE BUG: an unanswered fetch aborts instead of parking the submit handler", async () => {
    let aborted = false;
    const impl = ((_url: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; rej(new Error("The operation was aborted")); });
    })) as unknown as typeof fetch;

    await expect(fetchWithTimeout(impl, "/api/portal/invite/ABC", undefined, 10)).rejects.toThrow(/abort/i);
    // Not merely "the UI moved on": the socket the phone gave up on is closed,
    // so the retry she taps does not queue behind a corpse.
    expect(aborted).toBe(true);
  });

  it("returns the response untouched when the server answers in time", async () => {
    const impl = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const r = await fetchWithTimeout(impl, "/api/portal/invite/ABC", undefined, 500);
    expect(r.status).toBe(200);
  });

  it("respects a caller's own signal rather than overriding it", async () => {
    let sawSignal: AbortSignal | null | undefined;
    const impl = (async (_u: string, init?: RequestInit) => { sawSignal = init?.signal; return { ok: true, status: 200 } as Response; }) as unknown as typeof fetch;
    const mine = new AbortController();
    await fetchWithTimeout(impl, "/x", { signal: mine.signal }, 10);
    expect(sawSignal).toBe(mine.signal);
  });
});

describe("authErrorMessage — LAW #19, and a timeout that says something", () => {
  const LANGS = ["fr", "en", "de"] as const;

  it("THE BUG: a timed-out call gets its own message, not the generic fallback", () => {
    for (const lang of LANGS) {
      const timeoutMsg = authErrorMessage(TIMEOUT_MARK, lang);
      const generic = authErrorMessage("some unmapped internal string", lang);
      expect(timeoutMsg).not.toBe(generic);
      expect(timeoutMsg.length).toBeGreaterThan(10);
    }
  });

  it("an AbortError from fetchWithTimeout reads as 'too slow', not 'something went wrong'", () => {
    const generic = authErrorMessage("some unmapped internal string", "fr");
    expect(authErrorMessage("The operation was aborted", "fr")).not.toBe(generic);
    expect(authErrorMessage("signal is aborted without reason", "en"))
      .toBe(authErrorMessage(TIMEOUT_MARK, "en"));
  });

  it("a timeout is NOT collapsed into the plain network message — different advice", () => {
    for (const lang of LANGS) {
      expect(authErrorMessage(TIMEOUT_MARK, lang)).not.toBe(authErrorMessage("Failed to fetch", lang));
    }
  });

  it("every branch answers in all three languages, all distinct (LAW #19)", () => {
    const samples = [
      TIMEOUT_MARK,
      "Failed to fetch",
      "User already registered",
      "Invalid login credentials",
      "For security purposes, you can only request this after 47 seconds",
      "Password should be at least 6 characters",
      "Token has expired or is invalid",
      "Email not confirmed",
      "Unable to validate email address: invalid format",
      "a string nothing matches",
    ];
    for (const raw of samples) {
      const [fr, en, de] = LANGS.map(l => authErrorMessage(raw, l));
      expect(new Set([fr, en, de]).size).toBe(3);
      // Never hand her raw server English.
      for (const out of [fr, en, de]) expect(out).not.toContain(raw);
    }
  });

  it("errText reads the message off a thrown Error, and survives a thrown non-Error", () => {
    expect(errText(new Error(TIMEOUT_MARK))).toBe(TIMEOUT_MARK);
    expect(errText("boom")).toBe("boom");
    expect(errText(undefined)).toBe("");
  });
});

/**
 * The stuck button itself lives inside a React client component whose failure
 * paths are state writes into JSX, and this suite runs in plain Node with no
 * jsdom — so the shape of the handler IS the behaviour under test, the same
 * approach tests/adminPanelHonesty.test.ts takes. Delete the `finally` that
 * releases the button, or put a bare `fetch` back in the submit flow, and
 * these fail.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const PORTAL = code("app/portal/page.tsx");

describe("app/portal/page.tsx — no network call on this page can hang a button", () => {
  it("THE BUG: the submit handler releases the button in a finally", () => {
    const start = PORTAL.indexOf("async function handleSubmit");
    const end = PORTAL.indexOf("async function submitFlow");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = PORTAL.slice(start, end);
    expect(body).toMatch(/finally\s*\{[^}]*setLoading\(false\)/);
    // And the failure is SAID, not swallowed into an unhandled rejection.
    expect(body).toMatch(/catch\s*\([\w]+\)\s*\{[\s\S]*?setError\(authErrorMessage/);
  });

  it("no bare `await fetch(` survives — every request carries a deadline", () => {
    expect(PORTAL).not.toMatch(/await\s+fetch\(/);
    expect(PORTAL).toMatch(/fetchWithTimeout\(fetch,\s*`\/api\/portal\/invite\//);
  });

  it("no bare `await supabase.auth.` survives — supabase-js takes no AbortSignal", () => {
    expect(PORTAL).not.toMatch(/await\s+supabase\.auth\./);
  });

  it("the OTP screen's Verify button is released in a finally too", () => {
    const start = PORTAL.indexOf("async function verifyCode");
    const end = PORTAL.indexOf("async function runVerify");
    expect(end).toBeGreaterThan(start);
    expect(PORTAL.slice(start, end)).toMatch(/finally\s*\{[^}]*setOtpBusy\(false\)/);
  });

  it("the mount session check always reveals the form rather than spinning forever", () => {
    // `checkingSession` renders a full-screen spinner and nothing else; a
    // getSession() that never settles used to leave the portal on it.
    expect(PORTAL).toMatch(/\}\)\(\)\.catch\(\(\) => \{[\s\S]{0,300}?setCheckingSession\(false\)/);
  });
});
