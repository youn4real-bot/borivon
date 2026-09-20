import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A SLOT WRITE THAT FAILED IS NEVER REPORTED AS A SAVE.
 *
 * Bug 5 of the q3 admin audit, and a clean example of the shape the audit
 * named: a write whose failure nobody checks, on EITHER side of the wire.
 *
 * The admin opens a Bearbeitung / Visum slot's settings, chooses who signs,
 * presses save. Every signal agrees it worked -- the popup closes, the tiles
 * redraw. Nothing was saved. /api/portal/phase-slots answered HTTP 200
 * { ok: true } over an UPDATE that had returned an error, because the only
 * branch that looked at that error was the pre-migration one; and the client
 * checked `r.ok`, which was true, because the server was the thing lying.
 *
 * These are React state writes into JSX inside a 9,500-line client component
 * and a Next route handler, and this suite runs in plain Node with no jsdom, so
 * the shape of the code IS the behaviour under test -- the approach
 * tests/adminSilentAnswers.test.ts and tests/adminPanelHonesty.test.ts take.
 * Every assertion below was mutation-checked: reverting the fix fails it.
 */

/** Read a file with comments blanked, preserving offsets. Every fix here is
 *  commented with the failure it prevents, so scanning raw text would match the
 *  explanation instead of the code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

// ───────────────────────────────────────────────────────────────────────────
describe("the slot settings save tells the truth on both sides", () => {
  const ROUTE = code("app/api/portal/phase-slots/route.ts");
  const ADMIN = code("app/portal/admin/page.tsx");

  it("SERVER: a failed UPDATE returns an error, not ok:true", () => {
    const at = ROUTE.indexOf("const { error: updErr } = await db.from(\"phase_slots\").update(updates)");
    expect(at, "the settings UPDATE was not found").toBeGreaterThan(-1);
    const block = ROUTE.slice(at, at + 1400);
    // Before: the ONLY branch reading updErr was the pre-migration regex, so
    // every other error fell through to the ok:true at the end of the handler.
    expect(block).toMatch(/if\s*\(\s*updErr\s*\)/);
    expect(block, "a real write failure must answer WRITE_FAILED").toContain('code: "WRITE_FAILED"');
    expect(block).toContain("status: 500");
  });

  it("SERVER: the pre-migration RETRY's own error is checked too", () => {
    // `await db...update(rest)` with no destructured error — the same lie one
    // level down, which the first fix would otherwise have walked straight past.
    const at = ROUTE.indexOf("const { category_id: _o1, is_required: _o2, ...rest } = updates;");
    expect(at, "the pre-migration fallback was not found").toBeGreaterThan(-1);
    const block = ROUTE.slice(at, at + 700);
    expect(block).toMatch(/const \{ error: retryErr \} = await db/);
    expect(block).toMatch(/if\s*\(\s*retryErr\s*\)/);
  });

  it("SERVER: a missing migration still degrades gracefully, never 500s", () => {
    // The founder runs migrations by hand. A not-yet-created column must cost a
    // nicety (is_required / category_id), not the whole save — so the
    // pre-migration branch must still exist and must NOT return an error.
    expect(ROUTE).toMatch(/const preMigration\s*=/);
    expect(ROUTE).toMatch(/if\s*\(\s*!preMigration\s*\)/);
  });

  it("SERVER: a reorder in which rows failed to move does not answer ok", () => {
    const at = ROUTE.indexOf("if (body.positions) {");
    expect(at, "the reorder branch was not found").toBeGreaterThan(-1);
    const block = ROUTE.slice(at, ROUTE.indexOf("if (!body.id", at));
    expect(block).toContain("writeFailures");
    expect(block).toContain('code: "WRITE_FAILED"');
  });

  it("CLIENT: 'saved' requires the status AND the body to agree", () => {
    const at = ADMIN.indexOf("async function slotWriteSucceeded");
    expect(at, "slotWriteSucceeded not found").toBeGreaterThan(-1);
    const body = ADMIN.slice(at, ADMIN.indexOf("\n  }", at));
    expect(body).toContain("if (!r.ok) return false");
    expect(body, "the body's ok flag must be checked, not just the status")
      .toContain("body?.ok === true");
    // A body that will not parse is NOT a save.
    expect(body).toContain("catch(() => null)");
  });

  it("CLIENT: every phase-slots write goes through that check", () => {
    // Four call sites used to disagree: two checked only r.ok (which the server
    // made meaningless), and two — the auto-fill config and the wizard's
    // signature zone — checked nothing at all and then rewrote local state.
    const hits = ADMIN.match(/slotWriteSucceeded/g) ?? [];
    expect(hits.length, "expected the helper plus its four call sites").toBeGreaterThanOrEqual(5);
  });

  it("CLIENT: the auto-fill config write is no longer fire-and-forget", () => {
    // Was `.catch(err => console.warn(...))` — an HTTP refusal was never even
    // looked at, and the panel then drew the new config over the old row.
    expect(ADMIN, "a console.warn is not a failure path")
      .not.toContain('console.warn("[autoFill] phase-slots PATCH failed:"');
    expect(ADMIN).toContain("const cfgSaved = await fetch");
  });

  it("CLIENT: a refused signature-zone write does not notify the candidate", () => {
    // Otherwise she is told to sign and handed a PDF with nowhere to sign.
    const at = ADMIN.indexOf("const zoneSaved = await fetch");
    expect(at, "the signature-zone write was not found").toBeGreaterThan(-1);
    const notifyAt = ADMIN.indexOf("phase-slots/notify", at);
    const guardAt = ADMIN.indexOf("if (!zoneSaved)", at);
    expect(guardAt, "the zone write must be guarded").toBeGreaterThan(-1);
    expect(guardAt, "the guard must come BEFORE the notification").toBeLessThan(notifyAt);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// BUG 9 — the manage page describes what it actually does
