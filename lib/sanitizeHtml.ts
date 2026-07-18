import { sanitizeLetterHtmlServer } from "@/lib/sanitizeHtmlServer";

/**
 * Sanitizer for the collaborative cover-letter editor body (CLIENT render sink).
 *
 * The body is the contentEditable's innerHTML — it travels three paths, ALL of
 * which must be sanitized:
 *   1. server persistence  (PUT /api/portal/letter-body → sanitizeLetterHtmlServer)
 *   2. DB → editor load     (motivationsschreiben page innerHTML)
 *   3. peer → editor live   (Supabase realtime broadcast → innerHTML)
 * Paths 2 + 3 run in the BROWSER; path 3 never touches the server, so sanitizing
 * at the render sink is mandatory — server-only sanitizing would leave the live
 * broadcast path open.
 *
 * jsdom trap: isomorphic-dompurify loads jsdom on the SERVER, and jsdom crashes
 * at module load on Cloudflare Workers (html-encoding-sniffer require()s an
 * ESM-only pkg → ERR_REQUIRE_ESM). The motivationsschreiben page is a CLIENT
 * component that Next still SSRs on the worker; a top-level isomorphic-dompurify
 * import here 500'd that whole page. So:
 *   • in the BROWSER  → DOMPurify, lazily required (never pulls jsdom during SSR),
 *   • on the SERVER    → delegate to the jsdom-free sanitizeLetterHtmlServer
 *     (same allow-list; used when SSR/Node calls this — e.g. tests). Both produce
 *     equivalent safe HTML (locked by tests/sanitizeHtml.test.ts).
 *
 * Allow-list = inline formatting + lists/paragraphs the editor emits. NO
 * `<a>`/`<img>`/`<svg>`/`<iframe>`, NO event handlers, NO src/href.
 */
const ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "s", "br", "p", "div", "span",
  "ul", "ol", "li", "h1", "h2", "h3", "blockquote",
];

type Purify = { sanitize: (html: string, opts: Record<string, unknown>) => string };
let _dompurify: Purify | null = null;

export function sanitizeLetterHtml(html: string): string {
  // SERVER / Node (SSR on workerd, tests): use the jsdom-free sanitizer so the
  // module never pulls jsdom. This branch also runs during SSR module import —
  // the lazy require below is what keeps jsdom out of the server bundle's eval.
  if (typeof window === "undefined") return sanitizeLetterHtmlServer(html);
  // BROWSER: DOMPurify (isomorphic-dompurify picks the window build — no jsdom).
  // Required lazily so importing this module during SSR never touches jsdom.
  if (!_dompurify) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("isomorphic-dompurify");
    _dompurify = (mod.default ?? mod) as Purify;
  }
  return _dompurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["style"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "img", "svg", "a", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "href", "src"],
  });
}
