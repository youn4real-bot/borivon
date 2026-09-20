import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * BUG 14 — A REJECTION THAT NEVER SAVED LOOKED EXACTLY LIKE ONE THAT DID.
 *
 * The admin opens a candidate's passport data, hits Reject, types the reason
 * LAW #20 makes mandatory, and submits. The PATCH fails. The reject window
 * kept the text and stayed open — that part was already right — but the only
 * word about the failure was written into the footer of the card BEHIND it,
 * under a full-screen backdrop at z-9999. Nothing was visible. The Reject
 * button stopped spinning and that was the whole answer, so the admin walked
 * away believing a rejection had been recorded that the database never saw.
 *
 * Worse, that hidden footer only renders while the passport is neither
 * approved nor just-saved, so on an approved passport the message had nowhere
 * to render at all.
 *
 * The fix has three parts and all three are pinned here: the sentence is shown
 * INSIDE the reject window, it is ours in FR/EN/DE rather than the server's
 * English (LAW #19), and the window still keeps the typed reason.
 *
 * These are source assertions. Both files are React client components with no
 * exported logic, and this suite runs in plain Node with no jsdom — the shape
 * of the code IS the behaviour, exactly as tests/adminPanelHonesty.test.ts and
 * tests/silentFailures.test.ts already do it.
 */

/** Source with comments blanked, offsets preserved: every fix here is
 *  commented with the broken line it replaces, so scanning raw text would
 *  match the explanation instead of the code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const REJECT = code("components/AdminRejectModal.tsx");
const REVIEW = code("components/PassportReviewModal.tsx");

describe("the reject window can say why it did not save", () => {
  it("AdminRejectModal accepts and renders an error line", () => {
    expect(REJECT).toMatch(/error\?:\s*string\s*\|\s*null;/);
    // Rendered inside the popup's own footer, not somewhere a backdrop covers.
    expect(REJECT).toMatch(/\{error\s*&&\s*\(/);
    expect(REJECT).toContain('role="alert"');
  });

  it("the error sits in the same portal as the buttons", () => {
    const err = REJECT.indexOf("{error && (");
    const submitBtn = REJECT.indexOf("onClick={handleSubmit}");
    const portal = REJECT.indexOf("createPortal(");
    expect(portal).toBeGreaterThan(0);
    expect(err).toBeGreaterThan(portal);
    expect(err).toBeLessThan(submitBtn);
  });

  it("the typed reason is still the modal's own state — nothing resets it", () => {
    // `text` is seeded once from the prop and only a keystroke changes it, so
    // a failed submit cannot wipe it.
    expect(REJECT).toMatch(/const\s*\[text,\s*setText\]\s*=\s*useState\(target\.initialFeedback\s*\?\?\s*""\)/);
    const setters = REJECT.match(/setText\(/g) ?? [];
    expect(setters.length).toBe(1);
  });
});

describe("PassportReviewModal: a failed reject is reported where it happened", () => {
  it("the failure message is handed to the reject window", () => {
    expect(REVIEW).toMatch(/error=\{err\}/);
  });

  it("the window is only closed once the save succeeded", () => {
    const fail = REVIEW.indexOf("if (!res.ok) {");
    const close = REVIEW.indexOf("setRejectOpen(false);\n      setSavedAs(status);");
    expect(fail).toBeGreaterThan(0);
    // The early return on failure comes before the close, so a refused PATCH
    // never reaches it.
    expect(REVIEW.slice(fail, close)).toMatch(/return;/);
  });

  it("the sentence is ours in three languages, not the server's status line", () => {
    // What used to be shown verbatim.
    expect(REVIEW).not.toMatch(/setErr\(msg\)/);
    expect(REVIEW).toContain("the rejection was not recorded");
    expect(REVIEW).toContain("die Ablehnung wurde nicht übernommen");
    expect(REVIEW).toContain("le refus n'a pas été pris en compte");
    // The server's own words go to the console, not to the admin.
    expect(REVIEW).toMatch(/console\.error\("\[passport review\]"/);
  });

  it("a refused field edit says so instead of reading 'Saves automatically'", () => {
    // LAW #37: an admin override persists. When the PATCH is refused it has
    // not persisted, and the edit footer's only two states were "Saves
    // automatically" and "Auto-saved" — neither of which was true.
    expect(REVIEW).toContain("Not saved yet — retrying");
    expect(REVIEW).toContain("Noch nicht gespeichert");
    expect(REVIEW).toContain("Pas encore enregistré");
    expect(REVIEW).toMatch(/console\.error\("\[passport edit\]"/);
    // And the message renders in the EDIT footer, not only in the review one.
    const editFooter = REVIEW.indexOf("editMode ? (");
    const reviewFooter = REVIEW.indexOf("!isApproved && !savedAs");
    const firstErr = REVIEW.indexOf("{err && (");
    expect(editFooter).toBeGreaterThan(0);
    expect(firstErr).toBeGreaterThan(editFooter);
    expect(firstErr).toBeLessThan(reviewFooter);
  });

  it("a save that lands clears the warning it left behind", () => {
    expect(REVIEW).toMatch(/setErr\(null\);/);
    const ok = REVIEW.indexOf("if (res.ok) {");
    const clear = REVIEW.indexOf("setErr(null);", ok);
    const autoSaved = REVIEW.indexOf("setAutoSaved(true);", ok);
    expect(clear).toBeGreaterThan(ok);
    expect(clear).toBeLessThan(autoSaved);
  });

  it("a stale message never greets the next reject", () => {
    expect(REVIEW).toMatch(/setErr\(null\);\s*setRejectOpen\(true\)/);
    expect(REVIEW).toMatch(/setErr\(null\);\s*setRejectOpen\(false\)/);
  });
});
