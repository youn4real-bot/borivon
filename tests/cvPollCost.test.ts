import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * THE CV BUILDER MUST NOT BILL A NURSE FOR AN EMPTY ROOM.
 *
 * The live-collab poll backstop ran every 5 s for as long as the page was in
 * front, whether or not a second editor was in the document. A nurse who left
 * her CV open alone paid 12 requests a minute, indefinitely, out of Moroccan
 * mobile data and phone battery, to re-read a draft nobody but her was
 * touching. The page already knew who else was present.
 *
 * The poll still has a job: it is the backstop for a peer edit that realtime
 * broadcast dropped (CHANNEL_ERROR, paused tab, network blip). So it must keep
 * running when a peer IS present, and it must keep running when the presence
 * socket is down — because then an empty peer list is silence, not an answer.
 *
 * These assertions are made against the SOURCE. The poll lives inside a
 * 5,800-line client component whose behaviour is a React effect; this suite
 * runs in plain Node with no jsdom, so there is no component to mount. Same
 * approach as tests/adminPanelHonesty.test.ts and tests/silentFailures.test.ts.
 */

/** Read a file with comments blanked, preserving offsets — the change here is
 *  commented with the cost it removes, so scanning raw text would match the
 *  explanation instead of the code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const CV = code("app/portal/cv-builder/page.tsx");

/** The `const everyMs = ...;` expression, lifted out of the page and made
 *  runnable, so this tests the policy that actually ships rather than a copy
 *  of it kept in step by hand. */
function pollIntervalMs(hasRemotePeer: boolean, collabLive: boolean): number {
  const m = CV.match(/const everyMs = ([^;]+);/);
  if (!m) throw new Error("`const everyMs = ...` not found — was the poll rewritten?");
  const decide = new Function("hasRemotePeer", "collabLive", `return (${m[1]});`) as
    (a: boolean, b: boolean) => number;
  return decide(hasRemotePeer, collabLive);
}

describe("the poll only runs when it can catch something", () => {
  it("polls every 5 s while a second editor is in the document", () => {
    expect(pollIntervalMs(true, true)).toBe(5000);
    expect(pollIntervalMs(true, false)).toBe(5000);
  });

  it("does not poll at all when she is alone and presence is healthy", () => {
    // THE FIX. 0 means no standing timer — not a fast one, not a slow one.
    expect(pollIntervalMs(false, true)).toBe(0);
  });

  it("keeps a slow backstop when the presence socket is down", () => {
    // An empty peer list is then silence, not an answer, and a dropped socket
    // is the exact case the backstop was written for. A sixth of the cost.
    expect(pollIntervalMs(false, false)).toBe(30000);
  });

  it("the timer is actually skipped when the interval is 0", () => {
    // setInterval(tick, 0) would be the WORST outcome of this change — a tick
    // every frame instead of none at all.
    expect(/const t = everyMs > 0 \? setInterval\(tick, everyMs\) : null;/.test(CV)).toBe(true);
    expect(/if \(t\) clearInterval\(t\);/.test(CV)).toBe(true);
  });
});

describe("the poll notices when the room fills or empties", () => {
  it("presence is reduced to a boolean before it reaches the effect", () => {
    expect(/const hasRemotePeer = collabPeers\.some\(p => !p\.isSelf\);/.test(CV)).toBe(true);
  });

  it("the effect re-decides when who-is-here or socket health changes", () => {
    const deps = CV.match(/}, \[authToken, adminCandidateId, loading[^\]]*\]\);/);
    expect(deps, "poll effect dependency array not found").not.toBeNull();
    expect(deps![0]).toContain("hasRemotePeer");
    expect(deps![0]).toContain("collabLive");
    // NOT the array itself. collabPeers takes a new identity on every presence
    // sync — the gold typing pulse fires those constantly — so depending on it
    // would rebuild the timer on every keystroke a peer makes, firing an
    // immediate fetch each time: more requests than the poll it rations.
    expect(deps![0]).not.toContain("collabPeers");
  });

  it("socket health is read from the subscribe status, not assumed", () => {
    expect(/setCollabLive\(status === "SUBSCRIBED"\);/.test(CV)).toBe(true);
    // And cleared when the channel goes away, so a torn-down socket cannot
    // leave the poll believing presence is still trustworthy.
    expect(/setCollabLive\(false\);/.test(CV)).toBe(true);
  });

  it("a hidden tab still costs nothing, and a returning one reconciles at once", () => {
    expect(/if \(document\.hidden\) return;/.test(CV)).toBe(true);
    expect(/const onVis = \(\) => \{ if \(!document\.hidden\) void tick\(\); };/.test(CV)).toBe(true);
  });
});
