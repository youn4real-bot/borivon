import { describe, it, expect, afterEach } from "vitest";
import { assistantEnabled, vertexModel, escalationActive } from "../lib/vertexModel";
import { transcribeVoice } from "../lib/transcribeVoice";

/**
 * THE AI BILLING OFF-SWITCH (ASSISTANT_ENABLED).
 *
 * The founder cut the AI spend on 2026-09-20 ("i dont want any billings again its getting
 * too expensive"). Vertex bills PER CALL, so the thing that had to stop is the calls. The
 * bot's code is all still here on purpose — he may want it back — which means the ONLY
 * thing standing between him and another invoice is this flag.
 *
 * That makes it exactly the kind of invariant CLAUDE.md says to pin with a test: a
 * regression here is silent (nothing breaks, nothing logs, the bill just arrives a month
 * later). Every route to a paid call gets its own case below, including the ones that try
 * to go AROUND the default Vertex path — a future edit that adds a provider branch above
 * the gate would be caught here rather than on the card.
 *
 * Note the tests set full, valid-looking credentials. A test that passed merely because
 * no key was configured would prove nothing; each case asserts the SAME env produces a
 * live model once the flag is on, so the flag is demonstrably the thing doing the work.
 */

// Realistic shape (vertexModel JSON.parses this and reads client_email / private_key).
// Not a real key — a syntactically valid stand-in so the creds path is genuinely exercised.
const FAKE_SA = JSON.stringify({
  client_email: "nobody@example.invalid",
  private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n",
  private_key_id: "0000000000000000000000000000000000000000",
});

const TOUCHED = [
  "ASSISTANT_ENABLED", "ASSISTANT_BRAIN", "ASSISTANT_PROVIDER", "ASSISTANT_LLM_API_KEY",
  "ASSISTANT_LLM_MODEL", "ASSISTANT_LLM_BASE_URL", "ANTHROPIC_API_KEY",
  "GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_CREDENTIALS", "GOOGLE_VERTEX_LOCATION",
] as const;

const saved: Record<string, string | undefined> = {};
for (const k of TOUCHED) saved[k] = process.env[k];

/** Put the app in its real production shape: Vertex fully configured, Gemini brain. */
function configureVertex() {
  process.env.GOOGLE_VERTEX_PROJECT = "borivon-test";
  process.env.GOOGLE_VERTEX_CREDENTIALS = FAKE_SA;
  process.env.GOOGLE_VERTEX_LOCATION = "europe-west4";
  delete process.env.ASSISTANT_BRAIN;
  delete process.env.ASSISTANT_PROVIDER;
}

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("assistantEnabled — only the literal string \"true\" spends money", () => {
  it("is OFF when the var is absent (the default, and the safe state)", () => {
    delete process.env.ASSISTANT_ENABLED;
    expect(assistantEnabled()).toBe(false);
  });
  it("is ON for \"true\"", () => {
    process.env.ASSISTANT_ENABLED = "true";
    expect(assistantEnabled()).toBe(true);
  });
  it("tolerates surrounding whitespace (a pasted value)", () => {
    process.env.ASSISTANT_ENABLED = "  true  ";
    expect(assistantEnabled()).toBe(true);
  });
  // Everything below is a near-miss someone could plausibly type. Each must fail CLOSED:
  // a wrongly-OFF bot is noticed the first time he texts it, a wrongly-ON bot is noticed
  // on the invoice. So ambiguity resolves to "free".
  for (const v of ["", "false", "1", "yes", "on", "TRUE", "True", "enabled"]) {
    it(`is OFF for ${JSON.stringify(v)}`, () => {
      process.env.ASSISTANT_ENABLED = v;
      expect(assistantEnabled()).toBe(false);
    });
  }
});

describe("vertexModel — the gate holds with credentials fully configured", () => {
  it("returns null when the switch is off, even though Vertex IS configured", () => {
    configureVertex();
    process.env.ASSISTANT_ENABLED = "false";
    expect(vertexModel("flash")).toBeNull();
    expect(vertexModel("pro")).toBeNull();
  });

  it("returns a real model on the SAME env once the switch is on (proves the flag is what stops it)", () => {
    configureVertex();
    process.env.ASSISTANT_ENABLED = "true";
    expect(vertexModel("flash")).not.toBeNull();
  });

  it("cannot be routed around by ASSISTANT_BRAIN=claude", () => {
    process.env.ASSISTANT_ENABLED = "false";
    process.env.ASSISTANT_BRAIN = "claude";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
    expect(vertexModel("flash")).toBeNull();
  });

  it("cannot be routed around by an alt provider (Groq / OpenRouter)", () => {
    process.env.ASSISTANT_ENABLED = "false";
    process.env.ASSISTANT_PROVIDER = "groq";
    process.env.ASSISTANT_LLM_API_KEY = "gsk-test-not-real";
    process.env.ASSISTANT_LLM_MODEL = "moonshotai/kimi-k2-instruct";
    expect(vertexModel("flash")).toBeNull();
  });
});

describe("escalationActive — the Flash→Pro retry is a second paid call, so it dies too", () => {
  it("is false when the switch is off", () => {
    configureVertex();
    process.env.ASSISTANT_ENABLED = "false";
    expect(escalationActive()).toBe(false);
  });
  it("is true on the same env when the switch is on", () => {
    configureVertex();
    process.env.ASSISTANT_ENABLED = "true";
    expect(escalationActive()).toBe(true);
  });
});

describe("transcribeVoice — the one paid call that does NOT come from vertexModel()", () => {
  it("returns null when the switch is off, without reaching Vertex", async () => {
    configureVertex();
    process.env.ASSISTANT_ENABLED = "false";
    // Real bytes, real mime: if the gate were missing this would attempt a billed call.
    const out = await transcribeVoice(new Uint8Array([1, 2, 3, 4]), "audio/ogg");
    expect(out).toBeNull();
  });
});
