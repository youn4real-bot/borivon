import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * reportError is the app's whole server-error alarm, and it just lost two
 * things: the Sentry sink (deleted — 2,065,127 bytes of @sentry/node +
 * OpenTelemetry parsed on every cold isolate with no DSN configured anywhere),
 * and its STATIC import of lib/telegram (now loaded lazily, and only off the
 * edge runtime).
 *
 * The second change is the one that needs holding down. lib/telegram reads the
 * silence flag through @supabase/supabase-js, so importing it at module scope
 * put GoTrueClient + RealtimeClient into the EDGE compilation — which is
 * .open-next/middleware/handler.mjs, the 1,048,540-byte module that
 * .open-next/worker.js imports STATICALLY, i.e. parsed on every cold start
 * before a single request is routed.
 *
 * What this file can and cannot prove: it cannot prove webpack folds
 * process.env.NEXT_RUNTIME (only a build shows that). It proves the RUNTIME
 * contract the fold depends on — that the edge path never touches lib/telegram,
 * that the other two sinks still fire there, and that off the edge the silence
 * switch and the throttle behave exactly as they did before.
 */

const telegram = { telegramSilenced: vi.fn(async () => false) };
vi.mock("@/lib/telegram", () => telegram);

type Reporter = (err: unknown, ctx?: Record<string, unknown>) => Promise<void>;

let fetchSpy: ReturnType<typeof vi.fn>;

/** Fresh module instance per test: the throttle state lives in module scope. */
async function loadReportError(): Promise<Reporter> {
  vi.resetModules();
  const mod = await import("@/lib/reportError");
  return mod.reportError as Reporter;
}

/** keepAlive falls back to a bare `void work()` outside a request scope, so the
 *  fetch is queued as a microtask — let it run before asserting. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const telegramCalls = () =>
  fetchSpy.mock.calls.filter((c) => String(c[0]).includes("api.telegram.org"));
const webhookCalls = () =>
  fetchSpy.mock.calls.filter((c) => String(c[0]).includes("hooks.example"));

beforeEach(() => {
  telegram.telegramSilenced.mockReset();
  telegram.telegramSilenced.mockResolvedValue(false);
  fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "4242");
  vi.stubEnv("ERROR_WEBHOOK_URL", "https://hooks.example/alert");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reportError sinks", () => {
  it("pings Telegram off the edge runtime", async () => {
    const reportError = await loadReportError();
    await reportError(new Error("node boom"), { route: "/api/thing", method: "GET" });
    await settle();

    expect(telegramCalls()).toHaveLength(1);
    const body = JSON.parse(String(telegramCalls()[0][1]?.body));
    expect(body.chat_id).toBe("4242");
    expect(body.text).toContain("node boom");
    expect(body.text).toContain("GET /api/thing");
  });

  it("stays silent when the global Telegram switch is off", async () => {
    telegram.telegramSilenced.mockResolvedValue(true);
    const reportError = await loadReportError();
    await reportError(new Error("silenced boom"));
    await settle();

    expect(telegram.telegramSilenced).toHaveBeenCalled();
    expect(telegramCalls()).toHaveLength(0);
    // The founder asked for silence, not for blindness: the webhook still fires.
    expect(webhookCalls()).toHaveLength(1);
  });

  it("never reaches lib/telegram on the edge runtime", async () => {
    // The whole point of the guard: on the edge, @supabase/supabase-js must not
    // be reachable from this module at all.
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const reportError = await loadReportError();
    await reportError(new Error("edge boom"), { route: "/affiliate/abc" });
    await settle();

    expect(telegram.telegramSilenced).not.toHaveBeenCalled();
    expect(telegramCalls()).toHaveLength(0);
  });

  it("still logs and webhooks an edge error", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const reportError = await loadReportError();
    await reportError(new Error("edge boom"), { route: "/affiliate/abc" });
    await settle();

    expect(webhookCalls()).toHaveLength(1);
    const body = JSON.parse(String(webhookCalls()[0][1]?.body));
    // Slack reads {text}, Discord reads {content} — one URL works for either.
    expect(body.text).toContain("edge boom");
    expect(body.content).toContain("edge boom");
    expect(console.error).toHaveBeenCalled();
  });

  it("throttles a repeated error to one Telegram message", async () => {
    const reportError = await loadReportError();
    for (let i = 0; i < 5; i++) await reportError(new Error("same hot error"));
    await settle();

    expect(telegramCalls()).toHaveLength(1);
    // The webhook is deliberately NOT throttled — it is a machine sink.
    expect(webhookCalls()).toHaveLength(5);
  });

  it("reports even when every optional sink is unconfigured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    vi.stubEnv("ERROR_WEBHOOK_URL", "");
    const reportError = await loadReportError();
    await expect(reportError(new Error("bare boom"))).resolves.toBeUndefined();
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws, even when the sinks do", async () => {
    fetchSpy.mockImplementation(() => { throw new Error("network down"); });
    telegram.telegramSilenced.mockRejectedValue(new Error("db down"));
    const reportError = await loadReportError();
    // Reporting must not be able to break the request it is reporting on.
    await expect(reportError(new Error("boom in a storm"))).resolves.toBeUndefined();
    await settle();
  });
});
