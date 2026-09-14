import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import registryJson from "@/d1/types.json";
import type { Registry } from "@/lib/d1/pgrest/types";
import { parseParityArgs } from "../d1/parity-args.mjs";
import { REPLAY_RECOMPUTED } from "../d1/replay-journal.mjs";

/**
 * The rollback's parity gate compares every row of D1 with Supabase, minus a
 * short, named list of columns Supabase recomputes itself on replay. Too short a
 * list and the gate can never pass after an ordinary employer edit; too long
 * (or a pattern) and it passes with real losses. So the list is exact, and it
 * is tied to the triggers in the live Supabase catalog.
 */

const registry = registryJson as unknown as Registry;

describe("parseParityArgs", () => {
  it("keeps the old positional form: root, then tables", () => {
    expect(parseParityArgs(["/r"])).toEqual({ root: "/r", only: [], ignore: new Set() });
    expect(parseParityArgs(["/r", "leads", "documents"])).toEqual({ root: "/r", only: ["leads", "documents"], ignore: new Set() });
  });

  it("takes exact table.column names to leave out, in either spelling", () => {
    expect(parseParityArgs(["/r", "--ignore=employers.updated_at,a.b"]).ignore).toEqual(new Set(["employers.updated_at", "a.b"]));
    expect(parseParityArgs(["/r", "--ignore", "employers.updated_at", "leads"])).toEqual({ root: "/r", only: ["leads"], ignore: new Set(["employers.updated_at"]) });
  });

  it("refuses anything that is not an exact column, and unknown options", () => {
    expect(() => parseParityArgs(["/r", "--ignore=updated_at"])).toThrow(/table\.column/);
    expect(() => parseParityArgs(["/r", "--ignore=*.updated_at"])).toThrow(/table\.column/);
    expect(() => parseParityArgs(["/r", "--ignore-all"])).toThrow(/unknown option/);
  });
});

describe("REPLAY_RECOMPUTED", () => {
  it("names exactly the tables whose Supabase triggers rewrite a row, with real columns", () => {
    const snapshots = fs.readdirSync("d1/snapshot").filter((f) => /^catalog-.*\.json$/.test(f)).sort();
    expect(snapshots.length).toBeGreaterThan(0);
    const catalog = JSON.parse(fs.readFileSync(path.join("d1/snapshot", snapshots[snapshots.length - 1]), "utf8")) as {
      triggers: { t: string; n: string; when: string; on: string }[];
    };
    // A BEFORE INSERT/UPDATE trigger can overwrite what the replayed request sent.
    const rewriting = [...new Set(catalog.triggers.filter((t) => t.when === "BEFORE" && /INSERT|UPDATE/.test(t.on)).map((t) => t.t))].sort();
    const listed = [...new Set(Object.keys(REPLAY_RECOMPUTED).map((k) => k.split(".")[0]))].sort();
    expect(listed).toEqual(rewriting);
    for (const key of Object.keys(REPLAY_RECOMPUTED)) {
      const [table, column] = key.split(".");
      expect(registry[table]?.columns[column], key).toBeDefined();
    }
  });
});
