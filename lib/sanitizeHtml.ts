import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitizer for the collaborative cover-letter editor body.
 *
 * The body is the contentEditable's innerHTML — it travels three paths, ALL of
 * which must be sanitized:
 *   1. server persistence  (PUT /api/portal/letter-body)
 *   2. DB → editor load     (motivationsschreiben page innerHTML)
 *   3. peer → editor live   (Supabase realtime broadcast → innerHTML)
 * Path 3 never touches the server, so client-side sanitization at the render
 * sink is mandatory — server-only sanitizing would leave the live path open.
 *
 * Without this a candidate could store `<img src=x onerror=…>` in their letter
 * body; when an admin opens it to review (LAW #37 admin-edit), it would execute
 * in the admin's authenticated session (session theft / privilege escalation).
 *
 * Allow-list = inline formatting + lists/paragraphs the editor actually emits.
 * NO `<a>`/`<img>`/`<svg>`/`<iframe>`, NO event handlers, NO src/href. `style`
 * is kept (DOMPurify CSS-sanitizes it; it is not a script-execution vector) so
 * bold/italic-via-styled-span formatting survives.
 */
const ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "s", "br", "p", "div", "span",
  "ul", "ol", "li", "h1", "h2", "h3", "blockquote",
];

export function sanitizeLetterHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["style"],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "img", "svg", "a", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "href", "src"],
  });
}
