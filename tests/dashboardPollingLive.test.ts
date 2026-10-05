import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findRealtimeSubscriptions } from "../d1/cutover.mjs";

/**
 * THE CANDIDATE DASHBOARD MUST NEVER GO BACK ON SUPABASE REALTIME.
 *
 * app/portal/dashboard/page.tsx held the last four `.on("postgres_changes")`
 * subscriptions in the app, and d1/cutover.mjs step 1 refuses to flip the
 * database while any remain. The reason it refuses is that nothing BREAKS:
 * Realtime streams Supabase's write-ahead log, so once the rows live in D1
 * every channel simply goes quiet — the document grid stops reflecting an
 * admin's verdict, the stage unlock never arrives, the passport form stops
 * syncing between her phone and her laptop, and no error is logged anywhere.
 *
 * So this suite fails on two kinds of regression:
 *   1. a Realtime subscription reappearing on this page (or anywhere else);
 *   2. the polling that replaced it losing one of the two guarantees the
 *      subscriptions had and a naive port drops — the echo suppression that
 *      keeps a poll off what she is typing (LAW #38), and the failed-read
 *      distinction that tells "I could not read it" from "she has none".
 *
 * Assertions are made against the SOURCE. The polling lives inside a
 * 6,000-line client component whose behaviour is a React effect, and this
 * suite runs in plain Node with no jsdom, so there is no component to mount.
 * Same approach as tests/cvPollCost.test.ts and tests/pipelineLoad.test.ts.
 */

const DASH_PATH = "app/portal/dashboard/page.tsx";
const RAW = readFileSync(DASH_PATH, "utf8");

/** Read a file with comments blanked, preserving offsets — the polling code is
 *  commented with the Realtime channels it replaced, so scanning raw text would
 *  match the explanation instead of the code. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const DASH = code(RAW);

describe("the dashboard is off Realtime, and the cutover scanner agrees", () => {
  it("THE GATE: the whole app has no postgres_changes subscription left", () => {
    // The scanner the switch-day script actually runs, on this repo. If this
    // fails, `node d1/cutover.mjs .` refuses at step 1 and the founder's
    // database migration is blocked again.
    const hits = findRealtimeSubscriptions(path.resolve("."));
    expect(hits, `Realtime subscriptions found:\n${hits.join("\n")}`).toEqual([]);
  });

  it("no Supabase channel is opened on the dashboard at all", () => {
    // Narrower than the scanner on purpose: a `supabase.channel(...)` with its
    // `.on(...)` built up on a later line would slip past a one-line regex, and
    // a presence/broadcast channel on this page would still be a socket that
    // dies with the Supabase backend.
    expect(DASH).not.toMatch(/supabase\s*\.\s*channel\s*\(/);
    expect(DASH).not.toMatch(/removeChannel/);
  });

  it("the page still has a live mechanism — two polling loops, not zero", () => {
    // Deleting the subscriptions and stopping there would also satisfy the
    // gate, and would leave her screen frozen until she reloads it.
    expect(DASH).toMatch(/import \{ usePolling \} from "@\/lib\/usePolling";/);
    expect([...DASH.matchAll(/usePolling\(/g)]).toHaveLength(2);
  });
});

describe("what the poll costs her", () => {
  /** The options object of each usePolling call, as written. */
  const optionBlocks = [...DASH.matchAll(/\}, \{ intervalMs:([^}]*)\}\);/g)].map(m => m[1]);

  it("both loops are declared with an interval and a reset key", () => {
    expect(optionBlocks).toHaveLength(2);
    for (const o of optionBlocks) expect(o).toMatch(/resetKey: userId/);
  });

  it("documents + pipeline poll every 30 s, and not on mount", () => {
    const docsLoop = optionBlocks.find(o => o.includes("immediate: false") && o.includes("authToken"));
    expect(docsLoop, `options seen: ${optionBlocks.join(" | ")}`).toBeTruthy();
    expect(docsLoop).toMatch(/^ 30_000,/);
    // ~106 nurses on Moroccan mobile data: the bootstrap's Promise.allSettled
    // already loaded both, so a mount run would double every first paint.
    expect(docsLoop).toMatch(/immediate: false/);
  });

  it("the profile row polls fast ONLY while the passport form is open", () => {
    const ppLoop = optionBlocks.find(o => o.includes("passportModal"));
    expect(ppLoop, `options seen: ${optionBlocks.join(" | ")}`).toBeTruthy();
    // 5 s is where someone is watching extracted data land and typing over it.
    // Every other minute of her session is 30 s.
    expect(ppLoop).toMatch(/passportModal \? 5_000 : 30_000/);
    expect(ppLoop).toMatch(/immediate: false/);
  });

  it("a tick that found nothing new re-renders nothing", () => {
    // Without this a new array/object identity every 30 s re-runs every effect
    // keyed on `docs` or `pipeline` — the deep-link resolver, the stage gate,
    // the upgrade-modal auto-dismiss — forever, for no change at all.
    expect(DASH).toMatch(/setDocs\(prev => sameJson\(prev, fetched\) \? prev : fetched\)/);
    expect(DASH).toMatch(/setPipeline\(prev => sameJson\(prev, res\.pipeline\) \? prev : res\.pipeline\)/);
  });

  it("visibility and backoff are not re-implemented here", () => {
    // lib/poller.ts owns "visible tab only", "refetch on tab return", "never
    // overlap" and the error backoff, and tests/poller.test.ts proves them with
    // fake timers. A hand-rolled setInterval on this page would be a second,
    // untested copy of those rules — and the focus/visibility backstop the
    // Realtime channels needed is exactly what it replaced.
    expect(DASH).not.toMatch(/setInterval\([^)]*loadDocs/);
    expect(DASH).not.toMatch(/addEventListener\("visibilitychange"[\s\S]{0,200}?loadDocs/);
  });
});

describe("the echo suppression survived the port (LAW #38)", () => {
  it("the page holds a live-row tracker for the passport row", () => {
    expect(DASH).toMatch(/import \{ createLiveRowTracker, sameJson \} from "@\/lib\/liveRowDiff";/);
    expect(DASH).toMatch(/const \[passportLive\] = useState\(\(\) => createLiveRowTracker\(\)\)/);
  });

  it("EVERY write of the passport row is tracked", () => {
    // The one wrapper every caller goes through. Realtime delivered events in
    // commit order; a poll has to prove its read is newer than her own save, and
    // it can only do that if it SAW the save.
    expect(DASH).toMatch(/const passportFetch = useCallback<typeof fetch>\(\s*\(input, init\) => passportLive\.trackSave\(fetch\(input, init\)\)/);
    // And nothing writes /api/portal/passport around it. A raw fetch here is the
    // regression: the submit used to be one, so a read sent moments earlier could
    // answer afterwards and put the pre-submit draft back in the form.
    const writes = [...DASH.matchAll(/(\w+)\("\/api\/portal\/passport"/g)].map(m => m[1]);
    expect(writes.length).toBeGreaterThan(0);
    for (const fn of writes) expect(fn).toBe("passportFetch");
  });

  it("every keystroke and every tick marks a local edit", () => {
    // Five call sites in the eighteen-field form: the date wheel, the date
    // picker, the selects, the text inputs, and the confirmation box itself.
    expect([...DASH.matchAll(/passportLive\.markLocalEdit\(\)/g)].length).toBeGreaterThanOrEqual(5);
    // The old timestamp ref is gone: two sources of "did she just edit?" would
    // drift, and the ref knew nothing about a save still in flight.
    expect(DASH).not.toMatch(/lastLocalPassportEdit/);
  });

  it("the read's age is taken BEFORE the await, not after it", () => {
    // The first port asked "did she edit in the last 3 s?" when the RESPONSE
    // arrived. On a cold Worker (2-5 s) a read sent while she was typing could
    // land after the guard had expired, put an in-between draft over what she
    // had typed, and let the 800 ms autosave POST that older value back —
    // leaving a confirmation box saved as ticked with no human tick behind it.
    const sends = [...DASH.matchAll(/const readAt = passportLive\.readStart\(\);\s*\n\s*(?:const|let)\s/g)];
    expect(sends.length).toBeGreaterThanOrEqual(3); // the poll, reopen, bootstrap
    expect(DASH).toMatch(/passportLive\.step\(userId, row, readAt, \{ always: LIVE_META_COLS, deferrable: LIVE_PASSPORT_COLS \}\)/);
  });

  it("her editable columns are deferrable and the admin-driven ones are not", () => {
    // The separation is the whole point: the guard protects her input from a
    // stale echo, and it must not also swallow an admin flipping her to
    // verified. Merging the two channels the first time did exactly that and
    // was reverted.
    expect(DASH).toMatch(/const LIVE_META_COLS = \["passport_status", "profile_photo", "manually_verified"\]/);
    expect(DASH).toMatch(/const LIVE_PASSPORT_COLS: string\[\] = \[\.\.\.PP_KEYS, "passport_confirmed_fields"\]/);
  });

  it("a confirmation tick is only ever mirrored from the stored human ticks", () => {
    // LAW #38: a box is set by a human click and by nothing else. The poll may
    // mirror a click she made on another device, never derive one from a field
    // being filled in.
    const block = DASH.match(/if \(changed\.has\("passport_confirmed_fields"\)[\s\S]{0,500}?\n    \}/);
    expect(block, "the confirmed-fields branch of the poll was not found").not.toBeNull();
    expect(block![0]).toMatch(/Array\.isArray\(row\.passport_confirmed_fields\)/);
    expect(block![0]).not.toMatch(/passportModal|filled|\.trim\(\)/);
  });
});

describe("the failed-read distinction survived the port", () => {
  it("a broken documents read is a failure to the loop AND a notice on screen", () => {
    // docsLoadFailed is state (it draws the notice); the poll closes over a
    // value one render old, so it cannot read it. The ref is the same verdict,
    // readable the instant the read settles — that is what backs the loop off
    // instead of hammering a 500 every 30 s.
    expect(DASH).toMatch(/const docsLoadOkRef\s*=\s*useRef\(true\)/);
    expect(DASH).toMatch(/return docsLoadOkRef\.current && pipelineOk;/);
    // EVERY verdict, not just one of them. Asserting that the pair appears
    // somewhere is not enough: loadDocs reports failure from two places (the
    // error branch and the catch), and the one that forgot the ref would leave
    // the poll calling a broken read a healthy tick at full rate.
    const verdicts = [...DASH.matchAll(/(\S[^\n]*)\n\s*setDocsLoadFailed\((true|false)\)/g)];
    expect(verdicts.length).toBeGreaterThanOrEqual(3); // 2 failures + 1 success
    for (const [, before, value] of verdicts) {
      expect(before.trim(), `setDocsLoadFailed(${value}) is not paired with the ref`)
        .toBe(`docsLoadOkRef.current = ${value === "true" ? "false" : "true"};`);
    }
  });

  it("an empty list is still a healthy tick", () => {
    // The distinction only exists because these two look identical in the
    // returned list. Nothing may infer failure from length.
    expect(DASH).not.toMatch(/fetched\.length === 0[^\n]*setDocsLoadFailed\(true\)/);
    expect(DASH).not.toMatch(/docsLoadOkRef\.current = fetched\.length/);
  });

  it("a cancelled read is neither a failure nor an answer", () => {
    // A read the poll gave up on (tab return, deadline, unmount) must not raise
    // the notice, must not back the loop off, and must not write state.
    expect(DASH).toMatch(/if \(signal\?\.aborted\) return docsRef\.current;/);
    expect(DASH).toMatch(/if \(signal\?\.aborted\) return true;/); // loadPipeline
  });

  it("a failed profile read changes nothing and never claims a status", () => {
    // classifyProfileRead, not `data === null`: a 500, an expired JWT and
    // Moroccan mobile data dropping out all answer with a null row, which is
    // indistinguishable from "she has no row yet". Returning false backs the
    // loop off and leaves every passport state exactly as it is — in
    // particular it must NOT set passportStatusKnown(false), or one bad minute
    // of signal would raise the failure banner over data she can already see.
    // Anchored on the poll's own opening line: a looser match would run from
    // reopenPassportData's readStart and sweep in refreshPassportStatus, whose
    // setPassportStatusKnown(false) is correct where it stands (an explicit
    // retry that failed) and wrong only inside the poll.
    const poll = DASH.match(/usePolling\(async \(signal\) => \{\s*\n\s*if \(!userId\) return true;[\s\S]*?const row = \(read\.data \?\? \{\}\)/);
    expect(poll, "the profile poll was not found").not.toBeNull();
    expect(poll![0]).toMatch(/if \(classifyProfileRead\(read\) === "failed"\) return false;/);
    expect(poll![0]).not.toMatch(/setPassportStatusKnown\(false\)/);
  });

  it("a successful poll read heals a bootstrap read that failed", () => {
    // passport_status is admin-driven and read-only here, so a live row IS the
    // answer the failed bootstrap read never gave. Gating it on a diff would
    // leave the "we could not check" banner up forever, because the first poll
    // read only becomes the baseline.
    expect(DASH).toMatch(/setPassportStatusKnown\(true\);\s*\n\s*setPassportLoadFailed\(prev => \(prev === "status" \? null : prev\)\);/);
  });

  it("...but not from a read that could predate her own submit", () => {
    // Submitting sets passportStatus to "pending" locally so the box turns
    // yellow at once. A read sent a second earlier, answering a second later,
    // would put it back to neutral and re-offer the submit form. Realtime
    // delivered in commit order and could not do that; the poll has to ask.
    expect(DASH).toMatch(/if \(!passportLive\.mayMissLocalWrites\(readAt\)\) \{\s*\n\s*setPassportStatus\(/);
    // And the question is asked AFTER step(), which must run either way so the
    // snapshot moves on — skipping it would strand an admin flag forever,
    // which is the bug the first merge of these two channels was reverted for.
    const stepAt = DASH.indexOf("const step = passportLive.step(");
    const askAt = DASH.indexOf("passportLive.mayMissLocalWrites(readAt)");
    expect(stepAt).toBeGreaterThan(-1);
    expect(askAt).toBeGreaterThan(stepAt);
    expect(DASH).toMatch(/const step = passportLive\.step\([^\n]*\n\s*if \(!step\) return true;/);
  });

  it("a dropped pipeline read cannot re-lock a stage the admin opened", () => {
    // LAW #31/#32. The poll now runs this read every 30 s, so the "never blank
    // it on a failure" rule is exercised far more often than it was.
    expect(DASH).toMatch(/if \(signal\?\.aborted\) return true;\s*\n\s*if \(!res\.ok\) \{/);
    expect(DASH).toMatch(/setPipelineLoadFailed\(true\);\s*\n\s*return false;/);
  });
});
