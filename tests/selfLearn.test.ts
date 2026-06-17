import { describe, it, expect } from "vitest";
import { looksLikeCorrection } from "@/lib/selfLearn";

describe("looksLikeCorrection — gates the auto-learn reflection", () => {
  for (const t of [
    "don't remind me about docs",
    "I told you to stop",
    "you keep forgetting",
    "from now on always show the filenames",
    "that's not what I asked",
    "why do you keep doing this",
    "this is bullshit, fix it",
    "I prefer you answer in German",
    "never send without showing me first",
    "stop being so robotic",
  ]) {
    it(`correction: "${t}"`, () => expect(looksLikeCorrection(t)).toBe(true));
  }
  for (const t of ["", "email Anna the CV", "how is Hajar doing?", "pull up Samira's passport", "what's on my calendar", "yes"]) {
    it(`not a correction: "${t}"`, () => expect(looksLikeCorrection(t)).toBe(false));
  }
});
