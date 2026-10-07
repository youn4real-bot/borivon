import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AUTH_LINKED_ROWS, deleteAuthLinkedRows } from "@/lib/authLinkedRows";

function latestCatalog(): { foreign_keys: { t: string; cols: string[]; ref: string }[] } {
  const dir = "d1/snapshot";
  const newest = fs.readdirSync(dir).filter((f) => /^catalog-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1)!;
  return JSON.parse(fs.readFileSync(path.join(dir, newest), "utf8"));
}

describe("rows tied to a login", () => {
  it("are exactly the live catalog's foreign keys to auth.users — a new one fails here", () => {
    const fromCatalog = latestCatalog().foreign_keys
      .filter((k) => k.ref === "auth.users")
      .map((k) => `${k.t}.${k.cols.join(",")}`)
      .sort();
    expect(fromCatalog.length).toBeGreaterThan(0);
    expect(AUTH_LINKED_ROWS.map((r) => `${r.table}.${r.column}`).sort()).toEqual(fromCatalog);
  });

  it("deletes each one for that user, and stops at the first failure", async () => {
    const calls: string[] = [];
    const fail = "academy_tab_access";
    const db = {
      from: (table: string) => ({
        delete: () => ({
          eq: async (column: string, value: string) => {
            calls.push(`${table}.${column}=${value}`);
            return { error: table === fail ? { message: "boom" } : null };
          },
        }),
      }),
    };
    const r = await deleteAuthLinkedRows(db as never, "u1");
    expect(r.error).toBe("academy_tab_access.user_id: boom");
    const stopAt = AUTH_LINKED_ROWS.findIndex((x) => x.table === fail);
    expect(calls).toEqual(AUTH_LINKED_ROWS.slice(0, stopAt + 1).map((x) => `${x.table}.${x.column}=u1`));
  });

  it("both delete paths clear them BEFORE app_delete_user removes the login", () => {
    for (const file of ["app/api/portal/admin/delete-user/route.ts", "lib/assistantWrites.ts"]) {
      const src = fs.readFileSync(file, "utf8");
      const sweep = src.indexOf("await deleteAuthLinkedRows(db, userId)");
      const rpc = src.indexOf('db.rpc("app_delete_user"');
      expect(sweep, file).toBeGreaterThan(-1);
      expect(sweep, file).toBeLessThan(rpc);
    }
  });
});
