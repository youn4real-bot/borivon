import sanitizeHtml from "sanitize-html";

/**
 * SERVER-side twin of lib/sanitizeHtml.ts's sanitizeLetterHtml.
 *
 * Why a separate file: the client sanitizer uses isomorphic-dompurify, which on
 * the server loads jsdom. jsdom's transitive dep html-encoding-sniffer now
 * require()s an ESM-only package (@exodus/bytes), which throws ERR_REQUIRE_ESM
 * in Vercel's serverless Node runtime AT MODULE LOAD — so any route importing
 * the DOMPurify sanitizer 500s on every request before its handler runs. That
 * silently killed /api/portal/letter-body for ~7 weeks. `next start` never
 * reproduced it (local resolves node_modules normally); only Vercel's per-
 * function packaging does. See next.config.ts + the route.
 *
 * sanitize-html is pure CommonJS (htmlparser2, no jsdom, no ESM-only deps), so
 * it loads cleanly in the serverless function. This keeps the EXACT allow-list
 * as the client DOMPurify config: inline formatting + lists/paragraphs the
 * editor emits, `style` the only kept attribute (class/href/src/on* all
 * dropped), and script/style tag CONTENT discarded (not just the tags). The
 * client render sink re-sanitizes with DOMPurify anyway (defense in depth), but
 * the server must never persist an unsafe body — the PDF generator and any
 * future consumer read this column.
 *
 * Kept intentionally byte-compatible in behaviour with sanitizeLetterHtml —
 * tests/sanitizeHtml.test.ts runs the same XSS vectors through BOTH.
 */
const ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "s", "br", "p", "div", "span",
  "ul", "ol", "li", "h1", "h2", "h3", "blockquote",
];

/**
 * True if the (already-sanitized) letter HTML carries actual TEXT — false for an
 * emptied editor that left only structural tags ("<br>", "<p></p>", &nbsp;).
 *
 * Used by the letter-body PUT to tell a DELIBERATE clear (store "") from real
 * content (store the HTML). Storing "" — not NULL — for a clear is what lets the
 * client distinguish "admin emptied this" from "never written", so a cleared
 * letter is never resurrected by a stale per-browser draft (LAW #37).
 */
export function letterHtmlHasText(html: string): boolean {
  return html
    .replace(/<[^>]*>/g, "")     // drop tags
    .replace(/&nbsp;/gi, " ")    // nbsp → space
    .replace(/\s+/g, "")         // collapse remaining whitespace
    .length > 0;
}

export function sanitizeLetterHtmlServer(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    // Only `style` survives — matches DOMPurify ALLOWED_ATTR: ["style"].
    // class/href/src/data-*/event handlers are all stripped.
    allowedAttributes: { "*": ["style"] },
    // Inline style is not a script-execution vector in modern browsers (no
    // expression()); kept so bold/italic-via-styled-span formatting survives,
    // exactly as the DOMPurify config does. No allowedSchemes for attributes
    // since no url-bearing attribute is allowed in the first place.
    allowedSchemesByTag: {},
    // Discard disallowed tags but KEEP their text (so <a>click</a> → click),
    // except script/style/etc. whose CONTENT is dropped (nonTextTags default).
    disallowedTagsMode: "discard",
  });
}
