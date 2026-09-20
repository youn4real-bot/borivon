import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

/**
 * WHERE THE BILLING OFF-SWITCH IS ALLOWED TO SIT.
 *
 * ASSISTANT_ENABLED stops the AI spend. tests/assistantOffSwitch.test.ts proves it stops
 * every PAID call. This file proves the other half, which is the half that nearly shipped
 * wrong: it must stop ONLY the paid calls.
 *
 * The gate was first written one line after the chat lock in the Telegram webhook, which
 * returned before four paths that cost nothing and involve no model at all. The worst of
 * them was the reply-to-a-reminder-ping branch. There is NO portal UI for
 * assistant_reminders: replying to the ping is the ONLY way to close one, the ping itself
 * is fired by a free per-minute cron, and handleReminderPingReply is pure database work.
 * With the gate up top, a recurring reminder would have pinged the founder forever with no
 * way on earth to answer it. /today, /start, /help and the code-enforced confirm/cancel of
 * an already-staged write were silenced the same way, all of them equally free.
 *
 * So the cases below drive the REAL route handler - real vertexModel, real
 * handleReminderPingReply, real confirm/cancel intent parsing, only the outside world
 * mocked - and assert, with the switch OFF:
 *   - a "done" reply to a ping really writes done:true on that reminder;
 *   - a snooze reply really moves its due date;
 *   - /today answers with the briefing;
 *   - /start and /help answer, and say the AI half is off;
 *   - "yes" applies a staged write and "no" cancels it;
 *   - an ordinary question is refused and generateText is never called;
 *   - a voice note is refused before a single byte is downloaded.
 * And with the switch ON, the same ordinary question DOES reach the model - so the flag is
 * demonstrably the thing doing the work, not a missing key.
 */

const CHAT = 987654;
const ADMIN_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

// -- The outside world ------------------------------------------------------
/** Every Telegram message the handler sent this case, in order. */
let sent: string[] = [];
/** Every write the handler put on the database this case. */
let writes: { table: string; op: string; payload: unknown }[] = [];
/** The single assistant_reminders row a ping reply will find (null = no match). */
let reminderRow: { id: string; text: string } | null = null;
/** Did anything try to download a Telegram file? (A voice note must not, when off.) */
let fileFetches = 0;

const tgSend = vi.fn(async (_chat: string | number, text: string) => { sent.push(text); });
const tgGetFileBytes = vi.fn(async () => { fileFetches++; return { bytes: new Uint8Array([1, 2, 3]), mime: "audio/ogg" }; });

vi.mock("@/lib/telegram", () => ({
  telegramConfigured: () => true,
  tgSend,
  tgSendNatural: tgSend,
  tgSendDocument: vi.fn(async () => true),
  tgGetFileBytes,
  tgSendChatAction: vi.fn(async () => {}),
  tgTypingLoop: () => () => {},
  splitOnDivider: () => null,
  getAdminUserId: vi.fn(async () => ADMIN_ID),
}));

/** Chainable + thenable Supabase stand-in that records every write. */
function qb(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte", "lt", "gt", "or", "range"]) {
    b[m] = () => b;
  }
  const record = (op: string) => (payload: unknown) => { writes.push({ table, op, payload }); return b; };
  b.insert = record("insert");
  b.update = record("update");
  b.upsert = record("upsert");
  b.delete = () => { writes.push({ table, op: "delete", payload: null }); return b; };
  const row = () => (table === "assistant_reminders" ? reminderRow : null);
  b.maybeSingle = async () => ({ data: row(), error: null });
  b.single = async () => ({ data: row(), error: null });
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve({ data: row() ? [row()] : [], error: null }).then(res, rej);
  return b;
}
const fakeDb = { from: (t: string) => qb(t) };
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => fakeDb,
  getAnonVerifyClient: () => fakeDb,
  getAuthSchemaClient: () => fakeDb,
  supabase: {},
}));

// The paid calls. Either one running while the switch is off is the bug this file exists
// to catch, so both are loud rather than silent.
const generateText = vi.fn(async () => { throw new Error("PAID MODEL CALL"); });
vi.mock("ai", () => ({ generateText, stepCountIs: (n: number) => n, tool: (x: unknown) => x }));
const transcribeVoice = vi.fn(async () => { throw new Error("PAID TRANSCRIPTION CALL"); });
vi.mock("@/lib/transcribeVoice", () => ({ transcribeVoice }));

// Free collaborators: stubbed so the case is about the ROUTE, not about them.
const computeBriefing = vi.fn(async () => ({ text: "TODAY: 3 passports expire this month.", count: 3 }));
vi.mock("@/lib/briefing", () => ({ computeBriefing }));

const executeLatestPending = vi.fn(async () => ({ summary: "sent the email to Anna" }));
const cancelLatestPending = vi.fn(async () => ({ summary: "the email to Anna" }));
vi.mock("@/lib/assistantWrites", () => ({
  executeLatestPending,
  cancelLatestPending,
  autoApplyPending: vi.fn(async () => ({ kind: "none" })),
  getPendingDraft: vi.fn(async () => null),
  getPendingSendAttachments: vi.fn(async () => []),
  expireStalePendingConfirms: vi.fn(async () => 0),
}));

vi.mock("@/lib/assistantChatHistory", () => ({
  loadConversationContext: vi.fn(async () => ({ turns: [], summary: "" })),
  saveChatTurns: vi.fn(async () => {}),
  maybeCompact: vi.fn(async () => {}),
  resetConversation: vi.fn(async () => true),
}));
vi.mock("@/lib/assistantMemory", () => ({
  loadMemory: vi.fn(async () => ""),
  saveMemory: vi.fn(async () => "saved"),
}));
vi.mock("@/lib/assistantTools", () => ({ buildAssistantTools: () => ({}) }));
vi.mock("@/lib/reminderFire", () => ({ fireDueReminders: vi.fn(async () => ({ fired: 0 })) }));
vi.mock("@/lib/migrationCheck", () => ({ checkPendingMigrations: vi.fn(async () => []) }));
vi.mock("@/lib/botQuiet", () => ({ isBotQuiet: vi.fn(async () => false), setBotQuiet: vi.fn(async () => {}) }));
vi.mock("@/lib/automationSettings", () => ({ setAutomation: vi.fn(async () => null) }));
vi.mock("@/lib/gmailApi", () => ({ listDraftAttachments: vi.fn(async () => null) }));
vi.mock("@/lib/dlToken", () => ({ signDlToken: () => "tok" }));
vi.mock("@/lib/r2", () => ({ r2Configured: () => true, r2Put: vi.fn(async () => {}) }));
vi.mock("@/lib/usage", () => ({ logUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/keepAlive", () => ({ keepAlive: () => {} }));
vi.mock("@/lib/selfLearn", () => ({
  looksLikeCorrection: () => false,
  reflectAndLearn: vi.fn(async () => null),
}));

// -- Driving the handler ----------------------------------------------------
// The route only ever reads req.headers.get() and req.json(), so the cases hand it a
// two-method stand-in rather than building a real NextRequest.
let POST: (req: never) => Promise<Response>;

const TOUCHED = ["ASSISTANT_ENABLED", "TELEGRAM_CHAT_ID", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
  "GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_CREDENTIALS", "ASSISTANT_BRAIN", "ASSISTANT_PROVIDER", "ADMIN_EMAIL"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of TOUCHED) saved[k] = process.env[k];
  process.env.ADMIN_EMAIL = "founder@borivon.test";
  ({ POST } = await import("@/app/api/telegram/webhook/route"));
});
afterAll(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

beforeEach(() => {
  sent = []; writes = []; reminderRow = null; fileFetches = 0;
  generateText.mockClear(); transcribeVoice.mockClear();
  executeLatestPending.mockClear(); cancelLatestPending.mockClear(); computeBriefing.mockClear();
  process.env.TELEGRAM_CHAT_ID = String(CHAT);
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  // THE SWITCH IS OFF for every case unless the case turns it on. Note the Vertex
  // credentials are left configured throughout: a refusal that only happened because no
  // key was set would prove nothing about the flag.
  delete process.env.ASSISTANT_ENABLED;
  process.env.GOOGLE_VERTEX_PROJECT = "borivon-test";
  process.env.GOOGLE_VERTEX_CREDENTIALS = JSON.stringify({
    client_email: "nobody@example.invalid",
    private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
    private_key_id: "0".repeat(40),
  });
  delete process.env.ASSISTANT_BRAIN;
  delete process.env.ASSISTANT_PROVIDER;
});

/** One inbound Telegram update, with a fresh update_id so the dedupe never swallows it. */
let nextUpdateId = 1000;
function send(message: Record<string, unknown>) {
  const body = { update_id: nextUpdateId++, message: { chat: { id: CHAT }, ...message } };
  const req = { headers: { get: () => null }, json: async () => body };
  return POST(req as never);
}
const reply = () => sent.join("\n---\n");

// -- The free paths: all of these must still work with the switch OFF -------
describe("switched OFF, the free paths still work", () => {
  it("a \"done\" reply to a reminder ping really closes that reminder", async () => {
    // THE blocker. No portal UI exists for these rows, and the per-minute cron keeps
    // firing pings for free - so if this reply is refused, the reminder is unanswerable.
    reminderRow = { id: "rem-1", text: "call the embassy" };
    const res = await send({ text: "done", reply_to_message: { message_id: 4242 } });

    expect(res.status).toBe(200);
    expect(reply()).toContain("call the embassy");
    expect(reply()).not.toMatch(/AI is OFF/);
    const closed = writes.find((w) => w.table === "assistant_reminders" && w.op === "update");
    expect(closed, "the reminder was never written as done").toBeTruthy();
    expect(closed!.payload).toMatchObject({ done: true });
    expect(generateText, "no model may be involved in closing a reminder").not.toHaveBeenCalled();
  });

  it("a snooze reply to a ping really moves the due date", async () => {
    reminderRow = { id: "rem-2", text: "call the embassy" };
    const res = await send({ text: "in 2 hours", reply_to_message: { message_id: 4242 } });

    expect(res.status).toBe(200);
    expect(reply()).toMatch(/Snoozed/);
    const moved = writes.find((w) => w.table === "assistant_reminders" && w.op === "update");
    expect(moved, "the due date was never moved").toBeTruthy();
    const p = moved!.payload as { due_at?: string; notified_at?: unknown };
    expect(typeof p.due_at).toBe("string");
    expect(new Date(p.due_at!).getTime()).toBeGreaterThan(Date.now());
    expect(p.notified_at, "the ping must be re-armed or it never fires again").toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("/today still answers - computeBriefing reads the database, not a model", async () => {
    const res = await send({ text: "/today" });
    expect(res.status).toBe(200);
    expect(computeBriefing).toHaveBeenCalled();
    expect(reply()).toContain("3 passports expire this month");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("/start and /help still answer, and say the AI half is off on purpose", async () => {
    for (const cmd of ["/start", "/help"]) {
      sent = [];
      const res = await send({ text: cmd });
      expect(res.status).toBe(200);
      expect(reply(), `${cmd} went silent`).not.toBe("");
      // /help is the first thing anyone sends a bot that looks broken, so it has to be the
      // place that explains the bot is not broken - and how to undo it.
      expect(reply()).toMatch(/OFF/);
      expect(reply()).toContain("ASSISTANT_ENABLED");
      expect(reply(), "it must name what still runs").toMatch(/\/today/);
    }
    expect(generateText).not.toHaveBeenCalled();
  });

  it("\"yes\" still applies an already-staged write", async () => {
    // He approved it before the switch was flipped. Confirm is code-enforced precisely so
    // it never depends on a model; refusing here would strand the staged action.
    const res = await send({ text: "yes" });
    expect(res.status).toBe(200);
    expect(executeLatestPending).toHaveBeenCalled();
    expect(reply()).toContain("sent the email to Anna");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("\"no\" still cancels an already-staged write", async () => {
    const res = await send({ text: "no" });
    expect(res.status).toBe(200);
    expect(cancelLatestPending).toHaveBeenCalled();
    expect(reply()).toMatch(/cancelled/i);
    expect(generateText).not.toHaveBeenCalled();
  });
});

// -- The paid paths: all of these must be refused ---------------------------
describe("switched OFF, every paid path is refused - and says so", () => {
  it("an ordinary question is refused without calling the model", async () => {
    const res = await send({ text: "who has B2 due in the next 3 months?" });
    expect(res.status).toBe(200);
    expect(generateText, "the gate leaked - this would have been billed").not.toHaveBeenCalled();
    expect(reply()).toMatch(/AI is OFF/);
    expect(reply()).toContain("ASSISTANT_ENABLED");
  });

  it("a voice note is refused BEFORE the audio is even downloaded", async () => {
    const res = await send({ voice: { file_id: "vf-1" } });
    expect(res.status).toBe(200);
    expect(transcribeVoice, "transcription is a paid Gemini call").not.toHaveBeenCalled();
    expect(fileFetches, "no point paying Telegram bandwidth for audio we will not read").toBe(0);
    // And it must not read as "I couldn't catch that" - that reads like a fault and he
    // would resend it. It has to say what happened and what to do instead.
    expect(reply()).toMatch(/AI is OFF/);
    expect(reply()).toMatch(/[Tt]ype it/);
  });

  it("an audio FILE (a forwarded voice memo) is refused the same way", async () => {
    const res = await send({ audio: { file_id: "af-1", mime_type: "audio/mpeg" } });
    expect(res.status).toBe(200);
    expect(transcribeVoice).not.toHaveBeenCalled();
    expect(fileFetches).toBe(0);
    expect(reply()).toMatch(/AI is OFF/);
  });

  it("a document to file is refused before it is staged to storage", async () => {
    // Filing needs the model to work out WHO and WHAT it is for, so an upload here could
    // never be completed - staging the bytes would just leave litter in R2.
    const { r2Put } = await import("@/lib/r2");
    const res = await send({ document: { file_id: "df-1", file_name: "passport.pdf", mime_type: "application/pdf" } });
    expect(res.status).toBe(200);
    expect(r2Put).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
    expect(reply()).toMatch(/AI is OFF/);
  });
});

// -- The control: the flag is what stops it ---------------------------------
describe("switched ON, the same question reaches the model", () => {
  it("proves the refusals above are the flag's doing, not a missing key", async () => {
    process.env.ASSISTANT_ENABLED = "true";
    // generateText throws by design here; all that matters is that we GOT to it.
    await send({ text: "who has B2 due in the next 3 months?" }).catch(() => {});
    expect(generateText, "the gate did not open on the same env with the flag on").toHaveBeenCalled();
  });

  it("and a stranger's chat is still ignored, switch or no switch", async () => {
    process.env.ASSISTANT_ENABLED = "true";
    const body = { update_id: nextUpdateId++, message: { chat: { id: 111 }, text: "who are your candidates?" } };
    const res = await POST({ headers: { get: () => null }, json: async () => body } as never);
    expect(res.status).toBe(200);
    expect(sent, "the chat lock must still come first").toEqual([]);
    expect(generateText).not.toHaveBeenCalled();
  });
});
