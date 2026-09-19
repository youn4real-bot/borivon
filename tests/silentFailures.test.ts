import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * NO USER-TRIGGERED FAILURE MAY BE SILENT.
 *
 * Every incident on 2026-09-19 was the same shape: something failed, and the
 * interface said nothing. An upload that 413'd looked like a click that had
 * not registered. A reorder that 403'd stayed dragged on screen and reverted
 * days later. A Download button whose token had not minted did precisely
 * nothing, twice, and then the candidate messaged support saying the portal
 * was broken. Not one of those was a hard crash — each was a handler ending in
 * `console.error`, an empty `.catch`, or a `return` with nothing rendered.
 *
 * These assertions are made against the SOURCE of the two portal pages and the
 * modals they render. The handlers live inside 5,000-line client components
 * whose failure paths are React state writes into JSX; the vitest suite runs
 * in plain Node with no jsdom, so there is no component to mount. The shape of
 * the code IS the behaviour under test, and a scan is what actually stops the
 * pattern coming back — the same way tests/iosPdfFrameSrc.test.ts guards its
 * component's URL assembly.
 */

/**
 * Scan CODE, not prose. Each fix below is commented with the exact broken line
 * it replaces ("Was `if (!dlt) return;` — a dead tap"), which is the point of
 * the comment and would otherwise make every assertion here fail against its
 * own explanation. Block and line comments are blanked, preserving offsets so
 * a reported match still points at the right place.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const ADMIN     = code("app/portal/admin/page.tsx");
const DASHBOARD = code("app/portal/dashboard/page.tsx");
const DOC_MODAL = code("components/AdminDocPreviewModal.tsx");
const PP_MODAL  = code("components/PassportReviewModal.tsx");

const ALL: [string, string][] = [
  ["app/portal/admin/page.tsx", ADMIN],
  ["app/portal/dashboard/page.tsx", DASHBOARD],
  ["components/AdminDocPreviewModal.tsx", DOC_MODAL],
  ["components/PassportReviewModal.tsx", PP_MODAL],
];

describe("the iOS download token never dead-ends a button", () => {
  /**
   * `dlt` is the short-lived signed token that every iOS download and every
   * iOS preview needs, because WebKit carries no Authorization header on a
   * navigation. The mint endpoint 401s in bursts — 617 of 637 calls over three
   * days from one admin client — so "no token right now" is the common case,
   * not the rare one.
   *
   * A guard that returns without rendering anything therefore is not a guard,
   * it is an outage. triggerIosDownloadWithToken exists precisely to mint
   * inside the tap gesture and to demand an onError the caller cannot forget.
   */
  it("no handler bails out on a missing token without saying so", () => {
    for (const [name, src] of ALL) {
      // `if (!dlt) return;` and `if (!dlt) { setSomeSpinner(false); return; }`
      // — a bail-out whose body contains no error reporting at all.
      const bailouts = [...src.matchAll(/if\s*\(\s*!\s*dlt\s*\)\s*(\{[^{}]*\}|[^;\n]*;)/g)]
        .map(m => m[0])
        .filter(m => !/setErr|showError|setActionError|setSlotMsg|alert\(/.test(m));
      expect(bailouts, `${name} must not drop an iOS download on a missing dl token`).toEqual([]);
    }
  });

  it("every file downloaded through a minted token reports its failure", () => {
    for (const [name, src] of ALL) {
      const calls = [...src.matchAll(/triggerIosDownloadWithToken\(\{[\s\S]*?\n\s*\}\)/g)].map(m => m[0]);
      if (calls.length === 0) continue;
      for (const call of calls) {
        expect(call, `${name}: every triggerIosDownloadWithToken needs a visible onError`)
          .toMatch(/onError:/);
        expect(
          /onError:\s*\(\)\s*=>\s*(\{\s*\}|undefined)/.test(call),
          `${name}: onError must not be an empty function`,
        ).toBe(false);
      }
    }
  });
});

describe("rotation is saved or the failure is shown", () => {
  /**
   * LAW #39 forbids re-saving passport bytes, so `documents.rotation` IS the
   * orientation of a passport — rotating is a write, not a view preference.
   * When the PATCH failed silently the page stayed rotated on screen and
   * reopened sideways, so the same person rotated the same passport for ever.
   */
  const REPORTS = /setErr\(|showError\(|setActionError\(|setSlotMsg|showPreviewNotice\(|alert\(/;

  it("every rotate failure is reported to the person who rotated", () => {
    for (const [name, src] of ALL) {
      const unreported = src
        .split(/\r?\n/)
        .filter(l => l.includes("[rotation] persist failed"))
        .filter(l => !REPORTS.test(l));
      expect(unreported, `${name}: a rotate failure is logged but never shown`).toEqual([]);
    }
  });

  it("each rotate-persist handles BOTH a rejected response and a thrown error", () => {
    for (const [name, src] of ALL) {
      const writes  = (src.match(/deltaRotation: 90/g) ?? []).length;
      const reports = (src.match(/\[rotation\] persist failed/g) ?? []).length;
      if (writes === 0) continue;
      // One `!r.ok` report plus one `.catch` report per write. A 403 resolves
      // normally — handling only the throw is how the rotation that "never
      // sticks" stayed invisible.
      expect(reports, `${name}: ${writes} rotate write(s) need ${writes * 2} failure paths`)
        .toBe(writes * 2);
    }
  });
});

describe("a replace never quietly leaves both documents in the slot", () => {
  /**
   * A replace is two operations: upload the new file, then delete the one it
   * supersedes. The delete's response was never read, so a 403 or a 500
   * counted as done and the slot kept BOTH — her rejected first attempt beside
   * the corrected one, under a green "uploaded", with an admin left to guess.
   */
  it("the cleanup delete goes through the reporting helper", () => {
    expect(DASHBOARD).toContain("async function deleteReplacedDoc(");
    expect(
      DASHBOARD,
      "the replace cleanup must not fire a bare DELETE with a console-only catch",
    ).not.toMatch(/\.catch\(e => console\.error\("\[replace\] cleanup delete failed:", e\)\)/);
  });

  it("warnOldKept is a real message type with text in all three languages", () => {
    expect(DASHBOARD, "the MsgType union must carry warnOldKept").toContain('"warnOldKept"');
    // LAW #19: rendered through the page's own lang ternary, FR + DE + EN.
    const render = DASHBOARD.match(/msg\.type === "warnOldKept" \?[^\n]*/)?.[0] ?? "";
    expect(render, "warnOldKept needs FR/EN/DE text").toMatch(/lang === "fr"/);
    expect(render).toMatch(/lang === "de"/);
  });
});

describe("the fill-and-sign modal always explains itself", () => {
  /**
   * Tapping "sign your employment contract" in a notification fetched the slot
   * template and, on a non-ok response, did `if (!blob) return;` behind an
   * empty catch: the page scrolled to the row and that was the whole response.
   * No modal, no error, no retry. The row-click path beside it had no catch at
   * all, so offline it threw into an unhandled rejection and opened nothing.
   */
  it("neither template fetch can resolve into opening nothing", () => {
    expect(DASHBOARD, "the deep-link path must not bail before setFillForm")
      .not.toMatch(/\.then\(r => r\.ok \? r\.blob\(\) : null\)\.then\(blob => \{\s*\r?\n\s*if \(!blob\) return;/);
    const templateFetches = (DASHBOARD.match(/fetch\(`\/api\/portal\/slot-template\?slotId=/g) ?? []).length;
    const openers = (DASHBOARD.match(/loadFailed\b/g) ?? []).length;
    // Two fetches open the modal (deep-link + row click); the third is the
    // blank-template download, which alerts on its own. Each opener declares
    // loadFailed in its signature, its call sites and the render check.
    expect(templateFetches).toBeGreaterThanOrEqual(2);
    expect(openers, "both modal-opening template fetches must set loadFailed").toBeGreaterThan(4);
  });

  it("the stall message shows on a known failure, not only after the timeout", () => {
    expect(DASHBOARD).toContain("fillFormStalled || fillForm.loadFailed");
  });
});

describe("admin write-actions report a rejected write", () => {
  it("the Visum document order is not saved 'best-effort'", () => {
    // The order every candidate sees. It used to not even read the response.
    expect(ADMIN, "saveVisumDocOrder must check the response")
      .toMatch(/const r = await fetch\("\/api\/portal\/phase-doc-order"[\s\S]{0,400}?if \(!r\.ok\) showError\(/);
  });

  it("the document download never saves an error body under a .pdf name", () => {
    // `.then(r => r.blob())` with no status check wrote the JSON error into a
    // file named like the document, which reads as a corrupt document.
    expect(ADMIN).not.toMatch(/\.then\(r => r\.blob\(\)\)/);
  });

  it("the candidate-status autosave speaks up once its retries keep failing", () => {
    expect(ADMIN).toContain("function noteStatusSaveFailure()");
    expect(ADMIN, "the endless 4 s retry loop must report eventually")
      .toMatch(/noteStatusSaveFailure\(\);[\s\S]{0,400}?statusSaveTimer\.current = setTimeout/);
  });
});

describe("every new error string exists in all three languages (LAW #19)", () => {
  const KEYS = [
    "adErrDownload", "adErrRotate", "adErrLinkOrg",
    "adErrBranding", "adErrAttachSend", "adErrAutosave",
  ];
  it("lib/translations.ts carries fr + en + de for each", async () => {
    const { translations } = await import("../lib/translations");
    for (const lang of ["fr", "en", "de"] as const) {
      for (const key of KEYS) {
        const v = (translations[lang] as unknown as Record<string, string>)[key];
        expect(typeof v, `${lang}.${key} must exist`).toBe("string");
        expect(v.trim().length, `${lang}.${key} must not be blank`).toBeGreaterThan(0);
      }
    }
    // Three distinct languages, not the same sentence copied across.
    for (const key of KEYS) {
      const vals = (["fr", "en", "de"] as const)
        .map(l => (translations[l] as unknown as Record<string, string>)[key]);
      expect(new Set(vals).size, `${key} is not actually translated`).toBe(3);
    }
  });

  it("the modals' own dictionaries carry their new strings in all three", () => {
    for (const [name, src] of [["AdminDocPreviewModal", DOC_MODAL]] as const) {
      for (const key of ["failRotate", "failAttach", "failDownload"]) {
        const hits = (src.match(new RegExp(`${key}:`, "g")) ?? []).length;
        expect(hits, `${name}.${key} needs an en, fr and de entry`).toBe(3);
      }
    }
  });
});
