import { describe, it, expect } from "vitest";
import { candidateKey } from "../lib/r2";

// R2 object key builder. The candidate's filename is attacker-influenced
// (they name their upload), so it must never be able to break out of the
// candidates/<userId>/ prefix.
describe("candidateKey (path-traversal safety)", () => {
  it("builds the per-candidate path", () => {
    expect(candidateKey("user-1", "passport.pdf")).toBe("candidates/user-1/passport.pdf");
  });

  it("strips slashes so a filename can never escape the candidate folder", () => {
    const key = candidateKey("user-1", "../../etc/passwd");
    // Exactly 3 path segments: candidates / <uid> / <filename>.
    expect(key.split("/")).toHaveLength(3);
    expect(key.startsWith("candidates/user-1/")).toBe(true);
    expect(key).not.toContain("/etc/");
  });

  it("replaces spaces and unsafe characters with underscores", () => {
    const name = candidateKey("u", "my file (1)!.pdf").split("/")[2];
    expect(name).not.toMatch(/[ ()!]/);
  });

  it("falls back to 'document' for an empty name", () => {
    expect(candidateKey("u", "")).toBe("candidates/u/document");
  });
});
