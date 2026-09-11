import { describe, it, expect } from "vitest";
import { findDuplicateAccounts, normName, normPassport } from "../lib/duplicateAccounts";

describe("findDuplicateAccounts", () => {
  it("flags two accounts on the same passport, both ways", () => {
    const d = findDuplicateAccounts([
      { userId: "a", name: "Lamia Addi", passportNo: "AB 123456" },
      { userId: "b", name: "lamiaaddi99@gmail.com", passportNo: "ab-123456" },
      { userId: "c", name: "Someone Else", passportNo: "ZZ999999" },
    ]);
    expect(d.a).toEqual([{ otherId: "b", reasons: ["passport"] }]);
    expect(d.b).toEqual([{ otherId: "a", reasons: ["passport"] }]);
    expect(d.c).toBeUndefined();
  });

  it("matches the same phone however it was typed", () => {
    const d = findDuplicateAccounts([
      { userId: "a", phone: "+212 654 546 861" },
      { userId: "b", phone: "0654546861" },
    ]);
    expect(d.a).toEqual([{ otherId: "b", reasons: ["phone"] }]);
  });

  it("matches a full name regardless of accents, case and word order", () => {
    const d = findDuplicateAccounts([
      { userId: "a", name: "Hanaé ZAOUIA" },
      { userId: "b", name: "zaouia hanae" },
    ]);
    expect(d.a?.[0].reasons).toEqual(["name"]);
  });

  it("combines every signal for the same pair, strongest first", () => {
    const d = findDuplicateAccounts([
      { userId: "a", name: "Doha Zini", phone: "+212654546861", passportNo: "X1234567" },
      { userId: "b", name: "DOHA ZINI", phone: "0654546861", passportNo: "x1234567" },
      { userId: "c", name: "Doha Zini" },
    ]);
    expect(d.a).toEqual([
      { otherId: "b", reasons: ["passport", "phone", "name"] },
      { otherId: "c", reasons: ["name"] },
    ]);
  });

  it("never matches on blanks, one-word names, emails or short junk", () => {
    const d = findDuplicateAccounts([
      { userId: "a", name: "Amina", passportNo: "123", phone: "" },
      { userId: "b", name: "Amina", passportNo: "123", phone: null },
      { userId: "c", name: "x@y.com" },
      { userId: "d", name: "x@y.com" },
    ]);
    expect(d).toEqual({});
  });

  it("normalisers", () => {
    expect(normPassport(" ab-12 34 56 ")).toBe("AB123456");
    expect(normPassport("12345")).toBe("");
    expect(normName("  El-Alami  Zineb ")).toBe("alami el zineb");
    expect(normName("Zineb")).toBe("");
  });
});
