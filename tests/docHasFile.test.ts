import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A DOCUMENT LIVES IN EITHER STORE.
 *
 * Files went R2-primary on 2026-06-09 and `drive_file_id` has been null for
 * every upload since. The candidate dashboard gated her row click, her Replace
 * button and her Download button on `drive_file_id` alone, so for those files
 * none of it rendered.
 *
 * Measured against the live database when this was found: 425 live document
 * rows, 103 of them R2-only — including uploads from that same morning. A nurse
 * uploaded her diploma, saw the row appear with her filename (it had really
 * saved), then tapped it to check she had sent the right scan and nothing
 * happened. She could not verify it, could not replace a blurry passport photo
 * while it was still pending, and could not download her own B2 certificate
 * back. Nothing errored; the row was simply inert.
 *
 * The admin page hit the identical bug at the migration and fixed it there. The
 * candidate side was not touched for seven weeks. These pin the predicate on
 * BOTH pages so they cannot drift apart again.
 */

const predicate = (d?: { drive_file_id?: string | null; r2_key?: string | null } | null): boolean =>
  !!(d?.drive_file_id || d?.r2_key);

const DASHBOARD = readFileSync("app/portal/dashboard/page.tsx", "utf8");
const ADMIN = readFileSync("app/portal/admin/page.tsx", "utf8");

describe("docHasFile", () => {
  it("is true for an R2-only document — the 103 rows that were invisible", () => {
    expect(predicate({ drive_file_id: null, r2_key: "docs/abc.pdf" })).toBe(true);
  });

  it("is true for a legacy Drive-only document, so old rows keep working", () => {
    expect(predicate({ drive_file_id: "1AbC", r2_key: null })).toBe(true);
  });

  it("is true when both stores have it (the migrated majority)", () => {
    expect(predicate({ drive_file_id: "1AbC", r2_key: "docs/abc.pdf" })).toBe(true);
  });

  it("is false only when there are genuinely no bytes anywhere", () => {
    for (const d of [{ drive_file_id: null, r2_key: null }, {}, null, undefined]) {
      expect(predicate(d), JSON.stringify(d)).toBe(false);
    }
  });
});

describe("both pages use the same rule", () => {
  it("each defines the predicate over BOTH stores", () => {
    for (const [name, src] of [["dashboard", DASHBOARD], ["admin", ADMIN]] as const) {
      expect(src, `${name} must define docHasFile`).toContain("docHasFile");
      const decl = /docHasFile\s*=\s*\([^)]*\)[^=]*=>\s*\n?\s*!!\(d\?\.drive_file_id \|\| d\?\.r2_key\)/.test(src);
      expect(decl, `${name}'s docHasFile must test drive_file_id OR r2_key`).toBe(true);
    }
  });

  it("the candidate dashboard SELECTS r2_key, or the predicate is always false there", () => {
    // The bug would come straight back if the column stopped being fetched:
    // r2_key would be undefined on every row and docHasFile would collapse to
    // the old Drive-only behaviour, silently.
    expect(DASHBOARD).toContain("r2_key");
    // The column list lives in named constants (FULL / NO_SUPERSEDED) that are
    // passed to .select(cols), so assert on the list itself rather than on the
    // call. At least one requested column set must include r2_key AND
    // drive_file_id — the fallback that drops r2_key is deliberate and must not
    // be the only one.
    const columnLists = [...DASHBOARD.matchAll(/"(id, file_name[^"]*)"/g)].map((m) => m[1]);
    expect(columnLists.length, "the document column lists should be findable").toBeGreaterThan(0);
    expect(
      columnLists.some((c) => c.includes("r2_key") && c.includes("drive_file_id")),
      `no column list requests r2_key:\n${columnLists.join("\n")}`,
    ).toBe(true);
  });

  it("no candidate-facing affordance gates on drive_file_id alone any more", () => {
    const offenders = DASHBOARD.split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) =>
        /(uploaded && doc\?\.drive_file_id|isClickable = !!d\.drive_file_id|subDoc\.drive_file_id &&|: previewDoc\.drive_file_id \?)/.test(line))
      .map(({ line, n }) => `${n}: ${line.trim().slice(0, 90)}`);
    expect(offenders, `these hide controls for R2-only docs:\n${offenders.join("\n")}`).toEqual([]);
  });
});
