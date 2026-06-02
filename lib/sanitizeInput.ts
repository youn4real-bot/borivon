/**
 * Input sanitizer for PUBLIC free-text fields (e.g. the /online-courses
 * registration form). Cleans on the way IN so the stored value is inert at rest.
 *
 * React already escapes on render (admin views use no dangerouslySetInnerHTML),
 * so this is DEFENSE-IN-DEPTH: it neutralizes anything that could bite a future
 * render path, a CSV/Excel export, or an email template.
 *   • drop control chars (incl. CR/LF/TAB used for header / CSV-formula injection)
 *   • strip angle brackets entirely (kills any <script>/<img onerror> shape)
 *   • neutralize dangerous URL schemes (javascript:, data:, vbscript:)
 *   • leading =,+,-,@ → prefixed with ' so spreadsheets don't run it as a formula
 * then trim + length-cap.
 */
export function cleanPublicText(s: unknown, n: number): string {
  let v = typeof s === "string" ? s : "";
  // Drop control chars (codepoint < 32, or DEL 127) by char code — avoids a
  // literal control-char regex while still killing CR/LF/TAB injection vectors.
  v = Array.from(v).filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 && c !== 127; }).join("");
  v = v.replace(/[<>]/g, "");                              // no angle brackets
  v = v.replace(/(javascript|data|vbscript)\s*:/gi, "");   // no script URL schemes
  v = v.trim().slice(0, n);
  if (/^[=+\-@]/.test(v)) v = "'" + v;                     // CSV/formula-injection guard
  return v;
}
