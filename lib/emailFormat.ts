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

/**
 * When the bot is DELIVERING files into the chat, the files ARE the answer — the
 * founder wants them WITHOUT chatter. The model habitually wraps file delivery in
 * noise: "Here are the attachments:", "the link(s) expire in 3 minutes" (we send
 * the actual files, not links), and a redundant filename list (the delivered docs
 * already show their names). Strip those at the boundary so a "pull them up"
 * request yields just the files. Substantive text (a summary the founder asked
 * for) doesn't match these patterns and survives. If nothing's left, the caller
 * sends no text bubble at all.
 */
export function stripFileDeliveryNoise(s: string): string {
  return (s || "")
    // "the link/links expire(s) in 3 minutes" — always wrong, we deliver files.
    .replace(/^.*\blinks?\b[^.\n]*\bexpires?\b.*$/gim, "")
    // Lead-ins: "Here are the attachments:", "Here's the file Abdelhak sent:", etc.
    .replace(/^\s*here(?:'s| is| are)\b[^.\n]*\b(?:attachment|file|document|pdf|photo|image)s?\b[^.\n]*:?\s*$/gim, "")
    .replace(/^\s*(?:the|those|these)\s+(?:attachment|file|document|photo|image)s?\b[^.\n]*:?\s*$/gim, "")
    // Redundant filename bullets (the delivered documents already show the names).
    .replace(/^\s*[-•*]\s*\S.*\.(?:pdf|jpe?g|png|docx?|xlsx?|pptx?|zip|txt|csv)\b.*$/gim, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
