import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { translations } from "../lib/translations";

/**
 * THE ADMIN PANEL MUST NOT REPORT A FAILURE AS GOOD NEWS.
 *
 * Three reports, one family:
 *   C. /api/portal/admin failed, every derived list stayed empty, and the
 *      panel rendered a GREEN TICK reading "Nothing to review — all documents
 *      have been processed". The founder was told his review queue was CLEAR
 *      when it was UNKNOWN. The only trace was a console.error, which nobody
 *      sees on a phone.
 *   D. On an iPhone the upload picker offered no camera and no photo library,
 *      because every box asked for `.pdf,application/pdf` — while the server
 *      had accepted JPEG/PNG/WebP all along.
 *   E. Tapping an upload notification selected the candidate and opened
 *      nothing, for two separate reasons (stale client-side doc list, and a
 *      supreme-admin-only 403 on the lookup route).
 *
 * These assertions are made against the SOURCE of the admin page and the bell.
 * Those handlers live inside a 9,500-line client component whose failure paths
 * are React state writes into JSX; this suite runs in plain Node with no jsdom,
 * so there is no component to mount. The shape of the code IS the behaviour
 * under test — the same approach tests/silentFailures.test.ts and
 * tests/passportPhoto.test.ts already take, and the only thing that actually
 * stops the pattern coming back.
 */

/** Read a file with comments blanked, preserving offsets. Every fix here is
 *  commented with the broken line it replaces ("was res.json() on an error
 *  page"), so scanning raw text would match the explanation, not the code. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const ADMIN        = code("app/portal/admin/page.tsx");
const BELL         = code("components/NotificationBell.tsx");
const NOTIF_DOC    = code("app/api/portal/admin/notifications/[id]/doc/route.ts");
const UPLOAD_ROUTE = code("app/api/portal/upload/route.ts");
const PASSPORT_PDF = code("app/api/portal/admin/replace-passport-pdf/route.ts");

/** The array literal assigned to `name`, e.g. `const NAME = [ … ];`. */
function list(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = [`);
  if (at < 0) throw new Error(`${name} not found — was it renamed?`);
  const open = src.indexOf("[", at);
  const close = src.indexOf("]", open);
  return src.slice(open + 1, close);
}

// ───────────────────────────────────────────────────────────────────────────
// C — an empty list after a failed load is UNKNOWN, not CLEAR
// ───────────────────────────────────────────────────────────────────────────
describe("a failed data load is never rendered as an empty queue", () => {
  it("a non-OK response is caught before the body is parsed as the payload", () => {
    // res.json() on an error page threw into the same catch as a dead socket,
    // so a 500 and a lost signal were reported identically: not at all.
    expect(ADMIN).toMatch(/if\s*\(!res\.ok\)\s*\{/);
    expect(ADMIN, "the status is what tells a 500 from a 404").toMatch(/setAdminLoadError\(`HTTP \$\{res\.status\}`\)/);
  });

  it("a thrown fetch is reported too, not just logged", () => {
    const at = ADMIN.indexOf("async function loadAdminCore");
    expect(at, "loadAdminCore not found — was it renamed?").toBeGreaterThan(-1);
    const body = ADMIN.slice(at, ADMIN.indexOf("\n  }\n", at));
    expect(body).toContain("catch");
    const afterCatch = body.slice(body.lastIndexOf("catch"));
    expect(afterCatch, "the catch must set the error state, not only console.error")
      .toContain("setAdminLoadError(");
  });

  it("a successful load clears the error so a retry can succeed", () => {
    expect(ADMIN).toContain("setAdminLoadError(null)");
  });

  it("the failure state is checked BEFORE every 'nothing here' wording", () => {
    const at = ADMIN.indexOf("if (visibleIds.length === 0) {");
    expect(at, "the empty-state block moved — re-point this test").toBeGreaterThan(-1);
    const block = ADMIN.slice(at, at + 4000);
    const errAt = block.indexOf("adminLoadError");
    const nothingAt = block.indexOf("t.aNothingTitle");
    const notFoundAt = block.indexOf("t.adNoCandFound");
    expect(errAt, "no failure branch in the empty-state block").toBeGreaterThan(-1);
    expect(nothingAt, "the green tick moved — re-point this test").toBeGreaterThan(-1);
    // Each of the other branches lies in its own way over an empty payload:
    // "no candidate found" with a search typed, the green tick otherwise.
    expect(errAt, "the failure branch must come first").toBeLessThan(nothingAt);
    expect(errAt, "the failure branch must come first").toBeLessThan(notFoundAt);
  });

  it("the failure state is a danger tone, not a success tick", () => {
    const at = ADMIN.indexOf("adminLoadError");
    const branch = ADMIN.slice(ADMIN.indexOf("if (adminLoadError)", at), ADMIN.indexOf("if (adminLoadError)", at) + 900);
    expect(branch).toContain('tone="danger"');
    expect(branch, "a green CheckCircle2 here is the bug itself").not.toContain("CheckCircle2");
  });

  it("it offers a retry, and the retry re-runs the same loader", () => {
    expect(ADMIN).toContain("onClick={retryAdminLoad}");
    const at = ADMIN.indexOf("async function retryAdminLoad");
    expect(at, "retryAdminLoad not found").toBeGreaterThan(-1);
    const body = ADMIN.slice(at, at + 700);
    expect(body, "a retry that re-implements the fetch is a retry that drifts")
      .toContain("loadAdminCore(");
    expect(body, "a retry must not replay a notification jump the admin already dealt with")
      .toContain("consumeDeepLink: false");
  });

  it("LAW #19: the failure wording exists in all three languages", () => {
    for (const key of ["aLoadFailedTitle", "aLoadFailedSub", "aLoadRetry", "aLoadRetrying", "aDocOpenFailed"] as const) {
      const seen = new Set<string>();
      for (const lang of ["fr", "en", "de"] as const) {
        const msg = translations[lang][key];
        expect(msg, `${key} missing for ${lang}`).toBeTruthy();
        seen.add(msg);
      }
      expect(seen.size, `${key} needs its own wording per language, not one copied string`).toBe(3);
    }
    expect(translations.en.aLoadFailedSub, "{reason} carries the status").toContain("{reason}");
    expect(translations.de.aLoadFailedSub).toContain("{reason}");
    expect(translations.fr.aLoadFailedSub).toContain("{reason}");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D — the picker offers a camera exactly where the server accepts one
// ───────────────────────────────────────────────────────────────────────────
describe("the admin picker offers a photo where a photo is safe", () => {
  it("the server has always accepted photographs", () => {
    const allowed = list(UPLOAD_ROUTE, "ALLOWED_TYPES");
    for (const mime of ['"image/jpeg"', '"image/png"', '"image/webp"']) {
      expect(allowed, `server ALLOWED_TYPES must carry ${mime}`).toContain(mime);
    }
  });

  it("the passport and Sonstiges boxes offer a photo", () => {
    expect(ADMIN).toMatch(/ADMIN_PHOTO_KEYS\s*=\s*\["id"\]/);
    expect(list(ADMIN, "ADMIN_MULTI_KEYS")).toContain('"other"');
    expect(ADMIN).toMatch(/ACCEPT_PDF_OR_PHOTO\s*=\s*"\.pdf,\.jpg,\.jpeg,\.png,\.webp"/);
    // Sonstiges is the catch-all; the server allows Word documents there too.
    expect(ADMIN).toMatch(/ACCEPT_ANY_DOC\s*=\s*"\.pdf,\.jpg,\.jpeg,\.png,\.webp,\.doc,\.docx"/);
  });

  it("every other box still asks for a PDF", () => {
    const at = ADMIN.indexOf("function acceptForAdminDocKey");
    expect(at, "acceptForAdminDocKey not found").toBeGreaterThan(-1);
    const body = ADMIN.slice(at, ADMIN.indexOf("\n  }", at));
    expect(body).toContain("ADMIN_MULTI_KEYS.includes(key)");
    expect(body).toContain("ADMIN_PHOTO_KEYS.includes(key)");
    expect(body.trimEnd().endsWith("return ACCEPT_PDF_ONLY;"),
      "the default must be PDF — a qualification doc is merged through pdf-lib, which cannot read a JPEG").toBe(true);
  });

  it("the upload trigger routes the key through that decision", () => {
    expect(ADMIN).toMatch(/openAdminDocPicker\(acceptForAdminDocKey\(key\)\)/);
  });

  it("accept is written to the DOM node, not to state, before the click", () => {
    // The click happens in the SAME tick as the decision; a state change would
    // not have reached the attribute yet and the picker would open with the
    // PREVIOUS box's filter.
    const at = ADMIN.indexOf("function openAdminDocPicker");
    const body = ADMIN.slice(at, ADMIN.indexOf("\n  }", at));
    expect(body).toContain("input.accept = accept");
    expect(body.indexOf("input.accept"), "set accept BEFORE opening the picker")
      .toBeLessThan(body.indexOf("input.click()"));
  });

  it("the passport REPLACE picker stays PDF-only, because its route refuses anything else", () => {
    const at = ADMIN.indexOf("function triggerPassportPdfReplace");
    const body = ADMIN.slice(at, ADMIN.indexOf("\n  }", at));
    expect(body).toContain("openAdminDocPicker(ACCEPT_PDF_ONLY)");
    // A picker that opens the camera and a server that then rejects the photo
    // is a new silent failure, not a fix.
    expect(PASSPORT_PDF, "replace-passport-pdf must still be the PDF-only route this assumes")
      .toMatch(/if \(!isPdf\) return/);
  });

  it("the pdf-lib pickers stay PDF-only", () => {
    // The slot template is parsed by detectAcroFormFields and stamped by
    // pdf-lib; the sign modal reads its PDF into pdf-lib as well.
    for (const ref of ["adminFileInputRef", "sigManualFileRef"]) {
      const at = ADMIN.indexOf(`ref={${ref}}`);
      expect(at, `${ref} input not found`).toBeGreaterThan(-1);
      const el = ADMIN.slice(at, at + 200);
      expect(el, `${ref} must not offer an image`).toContain('accept=".pdf,application/pdf"');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// E — the bell lands on the document
// ───────────────────────────────────────────────────────────────────────────
describe("an upload notification opens the document", () => {
  it("the bell carries the resolved row in the event, not just its id", () => {
    // The panel's own `docs` cannot contain an upload that happened AFTER the
    // page loaded — i.e. exactly the notification being clicked.
    // Anchor on the ADMIN lookup — the same file also holds the candidate
    // bell's own /api/portal/notifications/<id>/doc call, which is not this.
    const lookupAt = BELL.indexOf("/api/portal/admin/notifications/");
    expect(lookupAt, "the admin doc lookup moved — re-point this test").toBeGreaterThan(-1);
    const at = BELL.indexOf("bv-admin-deep-link", lookupAt);
    const dispatch = BELL.slice(at, at + 900);
    expect(dispatch).toMatch(/docId: doc\.id/);
    expect(dispatch, "the whole row must travel with the event").toMatch(/,\s*doc\s*[,}]/);
  });

  it("the bell puts the user id in the URL too", () => {
    // Older notification rows carry an empty user_email, and the URL handler
    // only ever acted when nav_email was present.
    expect(BELL).toContain("nav_user_id=");
  });

  it("the URL handler opens the doc on the id-only path", () => {
    const at = ADMIN.indexOf("function consumeAdminDeepLinkParams");
    expect(at, "consumeAdminDeepLinkParams not found").toBeGreaterThan(-1);
    const body = ADMIN.slice(at, ADMIN.indexOf("\n  }\n", at));
    const navUserAt = body.indexOf("if (navUserId && users[navUserId])");
    expect(navUserAt, "the nav_user_id branch moved").toBeGreaterThan(-1);
    const branch = body.slice(navUserAt, body.indexOf("const linkedUser", navUserAt));
    expect(branch, "selecting the candidate and stopping IS the bug").toContain("openNavDoc(navDocId)");
  });

  it("the panel falls back to the row the server resolved", () => {
    const at = ADMIN.indexOf("async function onDeepLink");
    expect(at, "onDeepLink not found").toBeGreaterThan(-1);
    const body = ADMIN.slice(at, ADMIN.indexOf("\n    }\n", at));
    expect(body).toContain("detail.doc");
    expect(body, "the local row wins when present — it has the freshest status")
      .toMatch(/local\s*\?\?\s*\(eventDoc/);
    expect(body, "a doc we cannot open must say so, not vanish").toContain("aDocOpenFailed");
  });

  it("a lookup that failed is announced, not swallowed", () => {
    expect(BELL, "the bell must tell the panel the lookup failed").toContain("lookupFailed: true");
    const at = ADMIN.indexOf("async function onDeepLink");
    const body = ADMIN.slice(at, ADMIN.indexOf("\n    }\n", at));
    expect(body).toContain("detail.lookupFailed");
  });

  it("LAW #25: the lookup route scopes by candidate, not by supreme admin", () => {
    // It answered 403 to anyone who was not the supreme admin, so the team's
    // one sub-admin never opened a document from the bell, ever.
    expect(NOTIF_DOC, "the supreme-only gate must be gone")
      .not.toMatch(/auth\.role !== "admin"/);
    expect(NOTIF_DOC, "scope must still be enforced — per candidate")
      .toContain("canActOnCandidate(");
    // Every success path must go through the gate, not around it.
    const returns = NOTIF_DOC.match(/return NextResponse\.json\(\{ doc/g) ?? [];
    expect(returns.length, "a doc may only be returned from inside serveDoc").toBe(1);
    expect(NOTIF_DOC.match(/return serveDoc\(/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("the resolved row carries where its bytes live", () => {
    // Without r2_key an R2-only file (every upload since the storage
    // migration) arrives as a row the panel cannot treat as having a file.
    expect(NOTIF_DOC).toContain("r2_key");
    expect(NOTIF_DOC).toContain("uploaded_by_admin");
  });
});
