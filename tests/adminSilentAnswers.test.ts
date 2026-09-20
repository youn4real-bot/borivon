import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shareReadIsUnknown, slotDropVerdict, slotDropRefusalMessage } from "../lib/adminPanelRules";

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

// ───────────────────────────────────────────────────────────────────────────
// 2 — the editor closes because the save landed, not because it returned
// ───────────────────────────────────────────────────────────────────────────
describe("a structure edit is only 'done' once the server says so", () => {
  it("the rename closes its editor inside the success branch", () => {
    const body = fnBody(ADMIN, "async function saveSlotLabel(");
    const okAt = body.indexOf("if (res.ok) {");
    const closeAt = body.indexOf("setEditingSlotId(null)");
    const catchAt = body.indexOf("} catch {");
    expect(okAt, "the success branch moved — re-point this test").toBeGreaterThan(-1);
    expect(closeAt, "the editor is never closed at all now?").toBeGreaterThan(-1);
    expect(catchAt, "the catch moved — re-point this test").toBeGreaterThan(-1);
    // The whole bug in one assertion: the close used to sit AFTER the catch, so
    // it ran on 403, on 500 and on a dead socket exactly as it ran on success.
    expect(closeAt, "closing the editor after the catch is the bug itself").toBeLessThan(catchAt);
    expect(closeAt, "and it must be inside the ok branch, not before it").toBeGreaterThan(okAt);
  });

  it("the rename says so when it fails, on a refusal and on a throw", () => {
    const body = fnBody(ADMIN, "async function saveSlotLabel(");
    const reports = body.match(/reportStructureSaveFailed\(\)/g) ?? [];
    expect(reports.length, "both the non-OK response and the thrown fetch must report")
      .toBeGreaterThanOrEqual(2);
    expect(body, "an empty catch is how this failed silently for months")
      .not.toMatch(/catch\s*\{\s*\}/);
  });

  it("the rename leaves the typed name in the editor to retry with", () => {
    const body = fnBody(ADMIN, "async function saveSlotLabel(");
    const tail = body.slice(body.indexOf("} catch {"));
    expect(tail, "closing after the catch would discard what the admin typed")
      .not.toContain("setEditingSlotId(null)");
  });

  it("the drag order checks its response — both halves of the same drag", () => {
    for (const decl of ["async function saveSlotOrder(", "async function saveCategoryOrder("]) {
      const body = fnBody(ADMIN, decl);
      expect(body, `${decl} must read the response`).toMatch(/const r = await fetch\(/);
      expect(body, `${decl} must report a refusal`).toContain("if (!r.ok) reportStructureSaveFailed();");
      expect(body, `${decl} must report a thrown fetch too`)
        .toContain("catch { reportStructureSaveFailed(); }");
    }
  });

  it("renaming and deleting a category report their failures too", () => {
    for (const decl of ["async function renameCategory(", "async function deleteSlotCategory("]) {
      const body = fnBody(ADMIN, decl);
      expect(body, `${decl} still swallows its failure`).toContain("reportStructureSaveFailed()");
      expect(body, `${decl} still has an empty catch`).not.toMatch(/catch\s*\{\s*\}/);
    }
  });

  it("LAW #19: the one wording for a lost structure edit exists in all three languages", () => {
    const body = ADMIN.slice(ADMIN.indexOf("function reportStructureSaveFailed()"));
    const block = body.slice(0, body.indexOf("\n  }"));
    expect(block, "German wording missing").toContain("nicht gespeichert");
    expect(block, "French wording missing").toContain("n'a pas été enregistrée");
    expect(block, "English wording missing").toContain("was not saved");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3 — a drop either uploads or says why it cannot; never nothing
// ───────────────────────────────────────────────────────────────────────────
describe("a file dropped on a slot row never disappears in silence", () => {
  const pdf = { type: "application/pdf", name: "ezb.pdf" };
  const jpeg = { type: "image/jpeg", name: "passport.jpg" };
  const docx = { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "cv.docx" };

  it("a PDF uploads", () => {
    expect(slotDropVerdict(pdf)).toEqual({ ok: true });
  });

  it("a PDF whose MIME the browser did not supply still uploads", () => {
    // Dragged out of a mail client or a file manager, a real PDF routinely
    // arrives as "" or application/octet-stream. Refusing it on an absent MIME
    // would refuse exactly the file the row wants; the upload route sniffs the
    // first bytes and answers for itself if it turns out not to be one.
    expect(slotDropVerdict({ type: "", name: "Zusatzblatt A.PDF" })).toEqual({ ok: true });
    expect(slotDropVerdict({ type: "application/octet-stream", name: "form.pdf" })).toEqual({ ok: true });
  });

  it("a JPEG on a slot row is REFUSED, not ignored", () => {
    // The refusal is the whole fix: the old handler had no else, so the row lit
    // up on drag-over, went dark on drop, and nothing else ever happened.
    expect(slotDropVerdict(jpeg)).toEqual({ ok: false, reason: "not-pdf" });
  });

  it("a nothing-at-all drop is refused too", () => {
    expect(slotDropVerdict(undefined)).toEqual({ ok: false, reason: "no-file" });
    expect(slotDropVerdict(null)).toEqual({ ok: false, reason: "no-file" });
  });

  it("an octet-stream that is NOT named .pdf is refused on a PDF-only row", () => {
    expect(slotDropVerdict({ type: "application/octet-stream", name: "scan.tiff" }))
      .toEqual({ ok: false, reason: "not-pdf" });
  });

  it("the permanent document boxes take a photo as well as a PDF", () => {
    // adminDocUpload posts to /api/portal/upload, whose ALLOWED_TYPES has
    // carried image/jpeg, image/png and image/webp all along.
    for (const t of ["image/jpeg", "image/png", "image/webp"]) {
      expect(slotDropVerdict({ type: t, name: `x.${t.slice(6)}` }, "pdf-or-photo")).toEqual({ ok: true });
    }
    expect(slotDropVerdict(pdf, "pdf-or-photo")).toEqual({ ok: true });
  });

  it("and still refuse — out loud — what the server would not store", () => {
    expect(slotDropVerdict(docx, "pdf-or-photo")).toEqual({ ok: false, reason: "not-a-document" });
    expect(slotDropVerdict({ type: "image/heic", name: "IMG_0421.HEIC" }, "pdf-or-photo"))
      .toEqual({ ok: false, reason: "not-a-document" });
  });

  it("LAW #19: every refusal has its own wording in all three languages", () => {
    for (const reason of ["no-file", "not-pdf", "not-a-document"] as const) {
      const said = (["fr", "en", "de"] as const).map(l => slotDropRefusalMessage(reason, l));
      for (const msg of said) expect(msg.trim().length, `${reason} is blank`).toBeGreaterThan(0);
      expect(new Set(said).size, `${reason} is not actually translated`).toBe(3);
    }
  });

  it("the PDF-only refusal points at the box that DOES take a photo", () => {
    // Saying "no" without saying where it goes sends the founder round the
    // dossier looking for a box that will take it.
    for (const lang of ["fr", "en", "de"] as const) {
      expect(slotDropRefusalMessage("not-pdf", lang)).toContain("Sonstiges");
    }
  });

  it("both slot-row drop handlers go through the shared helper", () => {
    const drops = [...ADMIN.matchAll(/handleSlotDrop\(e\.dataTransfer\.files\?\.\[0\], slot\.id\)/g)];
    expect(drops.length, "both the single row and the dual header must route through it").toBe(2);
    // The dead-zone shape must be gone from every drop handler in the file.
    expect(ADMIN, "an inline type check with no else is the bug itself")
      .not.toMatch(/if \(file && file\.type === "application\/pdf"\) adminUploadFile\(/);
  });

  it("the helpers refuse out loud rather than returning", () => {
    for (const decl of ["function handleSlotDrop(", "function handleDocBoxDrop("]) {
      const body = fnBody(ADMIN, decl);
      expect(body, `${decl} must consult the shared rule`).toContain("slotDropVerdict(");
      expect(body, `${decl} must say why it refused`)
        .toContain("showError(slotDropRefusalMessage(verdict.reason, lang))");
    }
  });

  it("the permanent box drop no longer ends in a bare condition", () => {
    expect(ADMIN, "the old inline handler dropped a .docx without a word")
      .not.toMatch(/f\.type\.startsWith\("image\/"\)\)\) adminDocUpload\(/);
    expect(ADMIN).toContain("handleDocBoxDrop(e.dataTransfer.files?.[0], vb.key, vb.label)");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The sweep — the same three shapes everywhere else in the file
// ───────────────────────────────────────────────────────────────────────────
describe("the same three shapes are gone from the rest of the panel", () => {
  it("adding a document box reports a refused create", () => {
    // The spinner stopped, the naming popup stayed open with the typed label in
    // it, and no box appeared — which reads as "Save did not register", so it
    // gets pressed again.
    const body = fnBody(ADMIN, "async function addPhaseSlot(");
    expect(body, "the non-OK path must say something").toContain("reportStructureSaveFailed()");
    expect(body, "a thrown fetch must too").toMatch(/catch\s*\{\s*\r?\n\s*reportStructureSaveFailed\(\);/);
    expect(body, "an empty catch is the shape being removed").not.toMatch(/catch\s*\{\s*\}/);
  });

  it("adding a document box only clears the popup on success", () => {
    const body = fnBody(ADMIN, "async function addPhaseSlot(");
    const okAt = body.indexOf("if (res.ok) {");
    const clearAt = body.indexOf("setAddSlotPhase(null)");
    const catchAt = body.indexOf("} catch {");
    expect(clearAt, "the popup is never cleared at all now?").toBeGreaterThan(okAt);
    expect(clearAt, "clearing it outside the ok branch would discard the typed label")
      .toBeLessThan(catchAt);
  });

  it("the slot config save reads its response before closing its popup", () => {
    const body = fnBody(ADMIN, "async function saveSlotConfig(");
    const fetchAt = body.indexOf("const r = await fetch(");
    const guardAt = body.indexOf("if (!r.ok) {");
    const closeAt = body.indexOf("setSlotConfigPopup(null)");
    expect(fetchAt, "the response is not even captured").toBeGreaterThan(-1);
    expect(guardAt, "the response is captured but never checked").toBeGreaterThan(fetchAt);
    expect(closeAt, "the popup must not close ahead of the check").toBeGreaterThan(guardAt);
    expect(body, "callers use `void`, so a throw needs a catch or it is unhandled")
      .toContain("catch {");
  });

  it("a failed slot-category read says so instead of drawing every box loose", () => {
    const body = fnBody(ADMIN, "async function loadSlotCategories(");
    expect(body, "the non-OK path must report").toContain("reportCategoriesUnknown(phase)");
    expect(body, "and the thrown one").toMatch(/catch\s*\{\s*reportCategoriesUnknown\(phase\);\s*\}/);
    expect(body, "a recovered phase must be able to warn again later")
      .toContain("catLoadWarnedRef.current.delete(phase)");
  });

  it("the category warning fires once per phase, not once per scope switch", () => {
    const body = fnBody(ADMIN, "function reportCategoriesUnknown(");
    expect(body, "without the guard one outage becomes a wall of identical toasts")
      .toContain("if (catLoadWarnedRef.current.has(phase)) return;");
    expect(body).toContain("catLoadWarnedRef.current.add(phase)");
  });

  it("LAW #19: the category warning exists in all three languages", () => {
    const body = fnBody(ADMIN, "function reportCategoriesUnknown(");
    expect(body).toContain("Die Gruppen dieser Dokumente");
    expect(body).toContain("Les groupes de ces documents");
    expect(body).toContain("Couldn't load the groups");
  });

  it("no slot-structure write is left with an empty catch", () => {
    for (const decl of [
      "async function addPhaseSlot(",
      "async function saveSlotLabel(",
      "async function saveSlotOrder(",
      "async function saveCategoryOrder(",
      "async function renameCategory(",
      "async function deleteSlotCategory(",
      "async function deletePhaseSlot(",
    ]) {
      const body = fnBody(ADMIN, decl);
      expect(body, `${decl} still swallows a failure`).not.toMatch(/catch\s*\{\s*\}/);
    }
  });
});
