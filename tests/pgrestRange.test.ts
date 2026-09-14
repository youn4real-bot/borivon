import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { readInteger } from "../lib/d1/pgrest/range";
import { parseParts, isPgrestError } from "../lib/d1/pgrest/parseRequest";
import type { Registry } from "../lib/d1/pgrest/types";

/**
 * PostgREST's paging window (lib/d1/pgrest/range.ts). The adapter used to 400
 * anything but a plain non-negative integer; Supabase reads limit and offset
 * with Haskell's `readMaybe`, ignores what it can't read, and folds the two and
 * a Range header into one range whose empty cases are a 416.
 *
 * EVERY expectation below is what the live Supabase project answered for the
 * same request on `documents` (761 rows, ordered by id): which rows came back,
 * or which PGRST103 it refused with. `[offset, limit]` is the window the rows
 * reveal — undefined for "from the start" and "no limit".
 */
const registry = JSON.parse(fs.readFileSync("d1/types.json", "utf8")) as Registry;
const MAX = Number.MAX_SAFE_INTEGER;

type Want = [number | undefined, number | undefined] | "negative" | "lower>upper";
type Case = [string, Record<string, string>, Want];

function windowOf(query: string, headers: Record<string, string> = {}, method = "GET"): Want | string {
  const r = parseParts({ method, url: `http://d1.local/rest/v1/documents?select=id&${query}`, headers }, registry);
  if (!isPgrestError(r)) return [r.offset, r.limit];
  if (r.code !== "PGRST103" || r.status !== 416 || r.message !== "Requested range not satisfiable") return `${r.code}: ${r.message}`;
  if (r.details === "Limit should be greater than or equal to zero.") return "negative";
  if (r.details === "The lower boundary must be lower than or equal to the upper boundary in the Range header.") return "lower>upper";
  return `PGRST103: ${r.details}`;
}

describe("readInteger — Haskell's readMaybe :: Integer", () => {
  it("reads what GHC reads", () => {
    const read: [string, number][] = [
      ["3", 3], ["03", 3], [" 3", 3], ["3 ", 3], ["3\t", 3], ["\n3", 3], ["\u00a03", 3],
      ["0x3", 3], ["0X3", 3], ["0xA", 10], ["0o3", 3], ["0O3", 3], ["(3)", 3], ["( 3 )", 3], ["((3))", 3],
      ["-3", -3], ["- 3", -3], ["(-3)", -3], [" -3", -3], ["-0x3", -3], ["-0", 0], ["(-0)", 0],
    ];
    for (const [s, n] of read) expect(readInteger(s), JSON.stringify(s)).toBe(BigInt(n));
    expect(readInteger("99999999999999999999")).toBe(BigInt("99999999999999999999"));
  });

  it("refuses what GHC refuses", () => {
    const refused = ["", "abc", "3.5", "1e2", "3e0", "3abc", "+3", "0b11", "0x", "1_0", "--3", "3-", "-(3)", "( - (3))",
      "NaN", "Infinity", "\uff13", "\ufeff3", "(3", "3)"];
    for (const s of refused) expect(readInteger(s), JSON.stringify(s)).toBeNull();
  });
});

describe("the window, request by request", () => {
  const each = (values: string[], query: (v: string) => string, want: Want): Case[] => values.map((v) => [query(v), {}, want]);
  const cases: Case[] = [
    // limit alone: unreadable → every row; readable → that many; negative → 416
    ...each(["abc", "", "3.5", "1e2", "3abc", "%2B3", "0b11", "3e0", "%EF%BC%93", "NaN", "Infinity", "0x", "1_0", "--3", "3-", "-(3)", "(%20-%20(3))", "%EF%BB%BF3"],
      (v) => `limit=${v}`, [undefined, undefined]),
    ...each(["%203", "3%20", "0x3", "0X3", "0o3", "0O3", "(3)", "(%203%20)", "((3))", "03", "3%09", "%0A3", "%C2%A03", "+3"],
      (v) => `limit=${v}`, [undefined, 3]),
    ["limit=0xA", {}, [undefined, 10]],
    ["limit=-0", {}, [undefined, 0]], ["limit=(-0)", {}, [undefined, 0]],
    ...each(["-3", "(-3)", "-%203", "%20-3", "-0x3"], (v) => `limit=${v}`, "negative"),
    ["limit=99999999999999999999", {}, [undefined, MAX]], ["limit=9223372036854775807", {}, [undefined, MAX]],
    // offset alone: unreadable or negative → from the start
    ...each(["abc", "", "-5", "(-5)", "-0", "3.5"], (v) => `offset=${v}`, [undefined, undefined]),
    ["offset=(5)", {}, [5, undefined]], ["offset=0x5", {}, [5, undefined]], ["offset=%205", {}, [5, undefined]], ["offset=760", {}, [760, undefined]],
    ["offset=99999999999999999999", {}, [MAX, undefined]],
    // both: one range, where an unreadable limit counts as 0 and an unreadable offset as 0
    ["limit=abc&offset=5", {}, "negative"], ["limit=3&offset=abc", {}, [undefined, 3]],
    ["offset=-2&limit=3", {}, [undefined, 1]], ["offset=-5&limit=10", {}, [undefined, 5]], ["offset=-0x5&limit=10", {}, [undefined, 5]],
    ["offset=-2&limit=0", {}, "negative"], ["limit=0&offset=5", {}, "negative"], ["limit=-0&offset=5", {}, "negative"],
    ["limit=NaN&offset=NaN", {}, [undefined, 0]], ["limit=abc&offset=abc", {}, [undefined, 0]],
    ["offset=-5&limit=3", {}, "negative"], ["limit=-3&offset=10", {}, "negative"],
    ["offset=755&limit=99999999999999999999", {}, [755, MAX]],
    // the last value wins; a bare key with no `=` is no value at all, `limit=` an unreadable one
    ["limit=1&limit=2", {}, [undefined, 2]], ["offset=1&offset=2&limit=2", {}, [2, 2]],
    ["limit=abc&limit=2", {}, [undefined, 2]], ["limit=2&limit=abc", {}, [undefined, undefined]],
    ["limit=2&limit", {}, [undefined, 2]], ["offset=759&offset", {}, [759, undefined]],
    ["limit&offset=5", {}, [5, undefined]], ["limit=&offset=5", {}, "negative"],
    // the Range header
    ["", { Range: "0-4" }, [undefined, 5]], ["", { Range: "10-" }, [10, undefined]], ["", { Range: "5-2" }, "lower>upper"],
    ...["abc", "-5", "0-4,6-8", "items=0-4", "0-"].map((r): Case => ["", { Range: r }, [undefined, undefined]]),
    ["", { Range: " 0-4" }, [undefined, 5]], ["", { Range: "0-4 " }, [undefined, 5]], ["", { Range: "00-04" }, [undefined, 5]],
    ["", { Range: "0-99999999999999999999" }, [undefined, MAX]], ["", { Range: "3-3" }, [3, 1]], ["", { Range: "760-770" }, [760, 11]],
    // …intersected with the query string's range
    ["limit=2", { Range: "0-4" }, [undefined, 2]], ["limit=2", { Range: "3-10" }, "negative"],
    ["offset=10", { Range: "0-4" }, "negative"], ["offset=2&limit=2", { Range: "0-4" }, [2, 2]],
    ["limit=10", { Range: "3-5" }, [3, 3]], ["limit=abc", { Range: "0-4" }, [undefined, 5]],
    ["limit=0", { Range: "0-4" }, [undefined, 0]], ["offset=-1", { Range: "0-4" }, [undefined, 5]],
  ];

  it.each(cases)("GET ?%s %j", (query, headers, want) => {
    expect(windowOf(query, headers)).toEqual(want);
  });

  it("reads the Range header on GET only", () => {
    // live: HEAD with Range 0-4 or 5-2 describes every row (0-760/*)
    expect(windowOf("", { Range: "5-2" }, "HEAD")).toEqual([undefined, undefined]);
    expect(windowOf("", { Range: "0-4" }, "HEAD")).toEqual([undefined, undefined]);
    // …while limit/offset apply to every method (live: HEAD ?limit=-1 is a 416)
    expect(windowOf("limit=-1", {}, "HEAD")).toBe("negative");
  });
});
