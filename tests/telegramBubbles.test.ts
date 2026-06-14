import { describe, it, expect } from "vitest";
import { splitIntoBubbles } from "../lib/telegram";

// splitIntoBubbles makes the bot reply in 1–4 chat-like bubbles instead of one
// monolith — but a SHORT reply must stay a single bubble, and we must never
// exceed the cap. Pinned so the "natural chat feel" send can't regress.

describe("splitIntoBubbles", () => {
  it("keeps a short single-paragraph reply as ONE bubble", () => {
    expect(splitIntoBubbles("Sent to Anna ✅")).toEqual(["Sent to Anna ✅"]);
  });

  it("keeps a single block (no blank lines) as one bubble even if long", () => {
    const long = "x".repeat(2000);
    expect(splitIntoBubbles(long)).toEqual([long]);
  });

  it("splits multiple paragraphs into separate bubbles", () => {
    const text = "First thought here.\n\nSecond, separate thought.\n\nThird one.";
    const out = splitIntoBubbles(text, 30);
    expect(out.length).toBeGreaterThan(1);
    // every paragraph's text survives intact across the bubbles
    expect(out.join(" ")).toContain("First thought");
    expect(out.join(" ")).toContain("Third one");
  });

  it("never exceeds maxBubbles — overflow merges into the last bubble", () => {
    const text = ["A", "B", "C", "D", "E", "F"].join("\n\n");
    const out = splitIntoBubbles(text, 1, 4); // force one para per bubble, cap 4
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.join("\n\n")).toContain("F"); // nothing dropped
  });

  it("returns [] for empty/whitespace", () => {
    expect(splitIntoBubbles("   \n  ")).toEqual([]);
  });
});
