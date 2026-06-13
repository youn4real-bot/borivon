import { describe, it, expect } from "vitest";
import { stripMarkdown, stripEmailFormatting } from "../lib/emailFormat";

// stripMarkdown is the CODE-ENFORCED guarantee that the model's habitual
// Markdown never reaches the user — not in a sent email, not in its preview,
// and not in any Telegram message (Telegram shows literal ** otherwise). It
// must hold regardless of what the model emits, so it's pinned here.
describe("stripMarkdown — no markdown ever reaches the user", () => {
  it("removes **bold** and __bold__", () => {
    expect(stripMarkdown("Hello **Anna**, your __profile__ is ready")).toBe(
      "Hello Anna, your profile is ready",
    );
  });

  it("removes *italic* but leaves bare/multiplication asterisks alone", () => {
    expect(stripMarkdown("this is *important* now")).toBe("this is important now");
    // a lone asterisk mid-sentence isn't italic markup → untouched
    expect(stripMarkdown("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  it("removes `code` ticks and # headings", () => {
    expect(stripMarkdown("run `npm test`")).toBe("run npm test");
    expect(stripMarkdown("# Betreff\nHallo")).toBe("Betreff\nHallo");
  });

  it("converts '* bullet' / '+ bullet' to a plain dash", () => {
    expect(stripMarkdown("* one\n* two")).toBe("- one\n- two");
    expect(stripMarkdown("+ one")).toBe("- one");
  });

  it("flattens [text](url) markdown links to 'text (url)'", () => {
    expect(stripMarkdown("see [the CV](https://x.com/cv.pdf)")).toBe(
      "see the CV (https://x.com/cv.pdf)",
    );
  });

  it("kills a realistic email draft full of markdown (the recurring complaint)", () => {
    const draft = "**Betreff:** Profile\n\n**Ismail Louali:**\n* B2 passed\n\nBest, `Youness`";
    const clean = stripMarkdown(draft);
    expect(clean).not.toContain("**");
    expect(clean).not.toContain("`");
    expect(clean).toContain("Betreff: Profile");
    expect(clean).toContain("- B2 passed");
  });

  it("is null/undefined safe", () => {
    expect(stripMarkdown(undefined as unknown as string)).toBe("");
    expect(stripMarkdown("")).toBe("");
  });

  it("stripEmailFormatting is the same function (alias kept for email call sites)", () => {
    expect(stripEmailFormatting).toBe(stripMarkdown);
  });
});
