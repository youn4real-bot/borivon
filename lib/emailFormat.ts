/**
 * Strip Markdown formatting the model sprinkles in (**bold**, *italic*, `code`,
 * # headings, * bullets, [text](url)) — emails must be PLAIN TEXT. Enforced in
 * CODE so it can never reach a sent email or its preview, instead of relying on
 * the model to remember the rule every time. Dependency-free so any layer
 * (the tool's confirm summary AND the send path) can import it cheaply.
 */
export function stripEmailFormatting(s: string): string {
  return (s || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")                            // **bold**
    .replace(/__([^_]+)__/g, "$1")                                // __bold__
    .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2")  // *italic* (word-bounded)
    .replace(/`([^`\n]+)`/g, "$1")                                // `code`
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")                           // # headings
    .replace(/^(\s*)[*+]\s+/gm, "$1- ")                           // "* item" → "- item"
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)");       // [text](url) → text (url)
}
