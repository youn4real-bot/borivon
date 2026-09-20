import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shareReadIsUnknown } from "../lib/adminPanelRules";

/**
 * THE ADMIN PANEL MUST NOT ANSWER A QUESTION IT DID NOT MANAGE TO ASK.
 *
 * Three reports from the same family, all in app/portal/admin/page.tsx:
 *
 *   1. The "which partner agencies can see this candidate" read failed, and the
 *      panel rendered NOTHING — which is exactly how it renders a candidate no
 *      agency can see. The founder answered "can Calmaroi pull her documents?"
 *      off a blank space that actually meant "I could not check".
 *   2. Renaming a document box closed the editor whether or not the PATCH
 *      landed, so a 403 or a 500 looked like a successful rename until the next
 *      reload put the old name back.
 *   3. Dropping anything that was not exactly a PDF onto a Bearbeitung/Visum
 *      slot row did nothing at all: no spinner, no upload, no refusal.
 *
 * The decisions that can be lifted out of the component live in
 * lib/adminPanelRules.ts and are driven directly below. The rest are React
 * state writes into JSX inside a 9,000-line client component, and this suite
 * runs in plain Node with no jsdom, so for those the shape of the code IS the
 * behaviour under test — the same approach tests/docHasFile.test.ts takes.
 */

/** Read a file with comments blanked, preserving offsets. Every fix here is
 *  commented with the failure it prevents, so scanning raw text would match the
 *  explanation instead of the code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const ADMIN = code("app/portal/admin/page.tsx");

/** The body of `async function <name>(` … up to the first line that is exactly
 *  two spaces and a closing brace. Line-ending agnostic: this repository is
 *  checked out with core.autocrlf=true, so an LF-only pattern silently matches
 *  nothing and the slice runs to the end of the file. */
function fnBody(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} not found — was it renamed?`).toBeGreaterThan(-1);
  const endRel = src.slice(at).search(/\r?\n {2}\}\r?\n/);
  expect(endRel, `the end of ${decl} was not found — was it reindented?`).toBeGreaterThan(0);
  return src.slice(at, at + endRel);
}

// ───────────────────────────────────────────────────────────────────────────
// 1 — "I could not check" is not the same answer as "nobody"
// ───────────────────────────────────────────────────────────────────────────
describe("a failed partner-share read is unknown, not 'no agency can see her'", () => {
  it("a request that never completed leaves the answer unknown", () => {
    expect(shareReadIsUnknown(null)).toBe(true);
  });

  it("a 500 leaves the answer unknown", () => {
    expect(shareReadIsUnknown(500)).toBe(true);
  });

  it("a 401 leaves the answer unknown — the JWT expires while the tab sits open", () => {
    // Supabase refreshes roughly hourly; a dossier left open overnight answers
    // 401 on every read, and that is the case that must not read as "nobody".
    expect(shareReadIsUnknown(401)).toBe(true);
  });

  it("a 400 leaves the answer unknown", () => {
    expect(shareReadIsUnknown(400)).toBe(true);
  });

  it("LAW #25: a 403 is a deliberate refusal, so the missing control IS the answer", () => {
    // The route refuses agency admins outright — letting a partner's own admin
    // press Send-to would let them grant themselves candidates — and refuses
    // candidates outside the caller's scope. Warning them on every dossier they
    // open would be a false alarm, every time.
    expect(shareReadIsUnknown(403)).toBe(false);
  });

  it("a successful read is never an unknown", () => {
    expect(shareReadIsUnknown(200)).toBe(false);
    expect(shareReadIsUnknown(204)).toBe(false);
  });

  it("the loader records the failure instead of only clearing the lists", () => {
    const body = fnBody(ADMIN, "async function loadPartnerShares(");
    expect(body, "the non-OK branch must go through the shared rule")
      .toContain("setShareLoadFailed(shareReadIsUnknown(r.status))");
    expect(body, "a thrown fetch has no status at all, and is just as unknown")
      .toContain("setShareLoadFailed(shareReadIsUnknown(null))");
    expect(body, "a fresh attempt must clear the previous verdict")
      .toContain("setShareLoadFailed(false)");
  });

  it("switching candidate clears the previous dossier's verdict", () => {
    // Carrying it over would accuse a perfectly healthy load of having failed.
    const at = ADMIN.indexOf("if (selectedUser && accessToken) loadPartnerShares(selectedUser);");
    expect(at, "the candidate-switch effect moved — re-point this test").toBeGreaterThan(-1);
    const block = ADMIN.slice(Math.max(0, at - 500), at);
    expect(block, "the reset runs BEFORE the reload, so the stale verdict never survives")
      .toContain("setShareLoadFailed(false)");
  });

  it("the unknown state is rendered, in danger tone, where the buttons would be", () => {
    const at = ADMIN.indexOf("{shareLoadFailed && (");
    expect(at, "nothing renders the unknown state — clearing the list is the bug itself")
      .toBeGreaterThan(-1);
    const block = ADMIN.slice(at, at + 1600);
    expect(block, "grey would read as one more agency that simply says no")
      .toContain('color: "var(--danger)"');
    expect(block, "it must offer the retry, not just complain").toContain("retryPartnerShares()");
    expect(block, "a screen reader must hear it too").toContain('role="alert"');
    // It sits inside the same flex row as the Send-to buttons, so it occupies
    // the space the founder actually looks at for this answer.
    const buttonsAt = ADMIN.indexOf("{partnerOrgs.map((org) => {");
    expect(buttonsAt).toBeGreaterThan(-1);
    expect(at, "the notice must sit with the buttons it stands in for").toBeGreaterThan(buttonsAt);
  });

  it("LAW #19: the unknown state speaks all three languages", () => {
    const at = ADMIN.indexOf("{shareLoadFailed && (");
    const block = ADMIN.slice(at, at + 1600);
    for (const word of ["Freigaben unbekannt", "Partages inconnus", "Sharing unknown"]) {
      expect(block, `the unknown notice is missing its ${word} wording`).toContain(word);
    }
  });

  it("the retry shows that it is running", () => {
    const body = fnBody(ADMIN, "async function retryPartnerShares(");
    expect(body).toContain("setShareLoadRetrying(true)");
    expect(body, "a retry that looks like it did nothing is the same bug one level up")
      .toContain("finally { setShareLoadRetrying(false); }");
    expect(body, "the retry must re-run the real loader, not a copy of it")
      .toContain("loadPartnerShares(selectedUser)");
  });
});
