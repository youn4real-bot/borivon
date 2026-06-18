import { describe, it, expect } from "vitest";
import { isSetRule, parseRuleText } from "@/lib/confirmIntent";

describe("self-programming: rule capture", () => {
  it("detects an explicit 'rule:' and extracts the text verbatim", () => {
    expect(isSetRule("rule: always CC omar@borivon.com on UKSH emails")).toBe(true);
    expect(parseRuleText("rule: always CC omar@borivon.com on UKSH emails")).toBe("always CC omar@borivon.com on UKSH emails");
  });
  it("accepts the variants (new rule / set a rule / dash / FR / DE)", () => {
    expect(isSetRule("new rule: never promise candidates a 3-month timeline")).toBe(true);
    expect(isSetRule("set a rule - lead every briefing with passports")).toBe(true);
    expect(parseRuleText("set a rule - lead every briefing with passports")).toBe("lead every briefing with passports");
    expect(isSetRule("règle: réponds toujours en français")).toBe(true);
    expect(isSetRule("regel: antworte immer auf Deutsch")).toBe(true);
    expect(isSetRule("/rule answer dates as DD.MM.YYYY")).toBe(true);
  });
  it("does NOT misfire on normal sentences that merely contain 'rule'", () => {
    expect(isSetRule("the rule is simple, just send it")).toBe(false); // no 'rule:' lead
    expect(isSetRule("what's the rule for B2 again?")).toBe(false);
    expect(isSetRule("send the contract to Anna")).toBe(false);
    expect(isSetRule("ruler: 30cm")).toBe(false); // 'ruler', not 'rule:'
    expect(isSetRule("rule:")).toBe(false); // nothing after the lead
    expect(isSetRule("rule: ok")).toBe(false); // too short (<3 chars)
  });
  it("parseRuleText returns '' when it isn't a rule command", () => {
    expect(parseRuleText("send the contract to Anna")).toBe("");
  });
});
