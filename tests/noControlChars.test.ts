import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * NO INVISIBLE BYTES IN SOURCE.
 *
 * A regex in lib/workspaceCalendar.ts was written as /\b(404|410)\b/ but stored
 * two LITERAL BACKSPACE BYTES (0x08) instead of the escape. It printed perfectly
 * in every editor, every diff and every review, and it could never match a real
 * string — so a deleted Google event came back as a confusing 502 instead of a
 * clean "that event no longer exists", and nobody could see why by reading the
 * line. It was found by dumping the bytes, not by reading the code.
 *
 * This walks the source tree and fails on any C0 control character other than
 * tab, LF and CR, so that class of bug can never be invisible again.
 *
 * Zero-width and bidirectional-override characters are checked too: same hazard
 * wearing a different hat, and the bidi ones are a known source-obfuscation
 * attack, where a line can render as the opposite of what it actually runs.
 */

const ROOTS = ["app", "components", "lib", "tests", "scripts", "supabase"];
const EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|sql|css|json)$/;
const SKIP = new Set(["node_modules", ".next", ".open-next", ".git", "dist", "build", ".wrangler"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

/**
 * Built from ESCAPES, never literal bytes — a literal one here would make this
 * file break the very rule it enforces, and would be just as invisible.
 *
 * C0 minus tab/LF/CR, plus the zero-width space, the bidi marks, the bidi
 * overrides and isolates, and the BOM. ZWNJ and ZWJ (U+200C/U+200D) are
 * deliberately absent: both are legitimate inside emoji sequences.
 */
const FORBIDDEN = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u200B\\u200E\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]",
);

const NAMES: Record<number, string> = {
  0x08: "BACKSPACE (0x08) — did you mean the escape \\b ?",
  0x0c: "FORM FEED (0x0C) — did you mean \\f ?",
  0x1b: "ESCAPE (0x1B)",
  0x200b: "ZERO WIDTH SPACE",
  0x200e: "LEFT-TO-RIGHT MARK",
  0x200f: "RIGHT-TO-LEFT MARK",
  0xfeff: "ZERO WIDTH NO-BREAK SPACE / BOM",
};

describe("source contains no invisible control characters", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it("actually finds source files — a silent empty walk would pass vacuously", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("has no C0, zero-width or bidi-override characters anywhere in source", () => {
    const offenders: string[] = [];
    for (const f of files) {
      let text: string;
      try { text = readFileSync(f, "utf8"); } catch { continue; }
      if (!FORBIDDEN.test(text)) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = FORBIDDEN.exec(lines[i]);
        if (!m) continue;
        const cp = m[0].charCodeAt(0);
        const hex = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
        offenders.push(`${relative(process.cwd(), f)}:${i + 1} col ${m.index + 1} — ${NAMES[cp] ?? hex}`);
      }
    }
    expect(offenders, `invisible characters in source:\n${offenders.join("\n")}`).toEqual([]);
  });
});
