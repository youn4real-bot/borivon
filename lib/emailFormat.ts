/**
 * Strip Markdown formatting the model sprinkles in (**bold**, *italic*, `code`,
 * # headings, * bullets, [text](url)) so output is PLAIN TEXT. Enforced in CODE
 * so the asterisks/backticks can NEVER reach the user — not in a sent email, not
 * in an email preview, and not in any Telegram message — instead of relying on
 * the model to remember the "no markdown" rule every turn (which a small model
 * reliably forgets). Dependency-free so every layer can import it cheaply.
 *
 * Why this matters for Telegram specifically: Telegram's default message mode
 * does NOT render Markdown, so a model habit of wrapping text in `**…**` shows
 * up as literal ugly asterisks. Stripping at the boundary makes the bot read
 * like a normal chat no matter how the model formats its reply.
 */
export function stripMarkdown(s: string): string {
  return (s || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")                            // **bold**
    .replace(/__([^_]+)__/g, "$1")                                // __bold__
    .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2")  // *italic* (word-bounded)
    .replace(/`([^`\n]+)`/g, "$1")                                // `code`
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")                           // # headings
    .replace(/^(\s*)[*+]\s+/gm, "$1- ")                           // "* item" → "- item"
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)");       // [text](url) → text (url)
}

/** Alias kept for the email call sites — emails must be plain text too. */
export const stripEmailFormatting = stripMarkdown;
