import { describe, it, expect, afterEach } from "vitest";
import { anonymizeIp, isBot, parseUa, refHost, buildRows, insertRows, readTrack, visitorId } from "../lib/track/server";
import { setD1Runner } from "../lib/d1/client";

/** First-party analytics (founder 2026-11-09): legal by construction, so these rules are pinned. */
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const LINKEDIN_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]";
const LEAD = "6f1c2a9e-1b2c-4d5e-8f90-123456789abc";

afterEach(() => setD1Runner(null));

describe("privacy rules", () => {
  it("never keeps a full IP", () => {
    expect(anonymizeIp("203.0.113.77")).toBe("203.0.113.0");
    expect(anonymizeIp("2a02:8108:1240:5a00:1234:5678:9abc:def0")).toBe("2a02:8108:1240::");
    expect(anonymizeIp("garbage")).toBe("");
  });
  it("a visitor id changes every day and needs no storage on the device", async () => {
    const a = await visitorId("203.0.113.77", CHROME, Date.parse("2026-11-09T10:00:00Z"));
    const b = await visitorId("203.0.113.77", CHROME, Date.parse("2026-11-09T20:00:00Z"));
    const c = await visitorId("203.0.113.77", CHROME, Date.parse("2026-11-10T10:00:00Z"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("skips bots and link previews (a LinkedIn preview is not a click)", () => {
    expect(isBot("LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)")).toBe(true);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot(CHROME)).toBe(false);
    expect(isBot(LINKEDIN_IOS)).toBe(false);
  });
});

describe("enrichment", () => {
  it("reads device, system and the in-app browser", () => {
    expect(parseUa(CHROME)).toEqual({ device: "desktop", os: "Windows", browser: "Chrome" });
    expect(parseUa(LINKEDIN_IOS)).toEqual({ device: "mobile", os: "iOS", browser: "LinkedIn app" });
  });
  it("keeps only an outside referrer's host", () => {
    expect(refHost("https://www.linkedin.com/feed/update/123")).toBe("linkedin.com");
    expect(refHost("https://borivon.com/workshop")).toBe("");
    expect(refHost("youtube.com")).toBe("youtube.com");
    expect(refHost("")).toBe("");
  });
  it("builds rows: allowed types only, shortened IP, lead id, never a form value", async () => {
    const h = new Headers({ "user-agent": CHROME, "cf-connecting-ip": "203.0.113.77", "cf-ipcountry": "DE" });
    const rows = await buildRows(h, readTrack({ path: "/fahrplan", src: "LI-abc", ref: "https://www.linkedin.com/", sid: "s1", lid: LEAD }), [
      { type: "view", name: "Fahrplan" },
      { type: "keylog", name: "c-mail", value: "secret@x.de" },
      { type: "field_done", name: "c-mail", value: "1" },
    ], Date.parse("2026-11-09T10:00:00Z"));
    expect(rows.map((r) => r.type)).toEqual(["view", "field_done"]);
    expect(rows[0]).toMatchObject({ path: "/fahrplan", src: "li-abc", ref: "linkedin.com", ip: "203.0.113.0", country: "DE", device: "desktop", lead_id: LEAD });
    expect(JSON.stringify(rows)).not.toContain("secret@x.de");
    expect(JSON.stringify(rows)).not.toContain("203.0.113.77");
    expect(await buildRows(new Headers({ "user-agent": "curl/8.0" }), {}, [{ type: "view" }])).toEqual([]);
  });
});

describe("storage", () => {
  it("writes a whole batch in ONE statement with ONE parameter (D1 allows 100)", async () => {
    const calls: { sql: string; params?: unknown[] }[] = [];
    setD1Runner({ async run(sql, params) { calls.push({ sql, params }); return { results: [], meta: {} }; } });
    const h = new Headers({ "user-agent": CHROME, "cf-connecting-ip": "203.0.113.77" });
    const rows = await buildRows(h, { path: "/workshop", sid: "s2" }, Array.from({ length: 40 }, (_, i) => ({ type: "scroll", name: String(i) })));
    await insertRows(rows);
    const insert = calls.find((c) => c.sql.startsWith("INSERT INTO track_events"))!;
    expect(insert.sql).toContain("json_each(?)");
    expect(insert.params).toHaveLength(1);
    expect(JSON.parse(String(insert.params![0]))).toHaveLength(40);
    expect(calls.some((c) => c.sql.includes("CREATE TABLE IF NOT EXISTS track_events"))).toBe(true);
  });
});
