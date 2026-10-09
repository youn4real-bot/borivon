import { describe, it, expect } from "vitest";
import registryJson from "@/d1/types.json";
import { compareText } from "@/lib/d1/pgrest/collate";
import { norm, sortByKey } from "../d1/parity-rows.mjs";

/**
 * The rollback gate (d1/parity-check.mjs) pairs Supabase's rows with D1's by
 * position. Each side used to arrive in its own database's ORDER BY — and on a
 * text key the two disagree: Supabase sorts linguistically (compareText
 * reproduces it, measured against the live project), D1 by bytes.
 */
const types = registryJson as unknown as Record<string, { pk: string[]; columns: Record<string, { pg: string }> }>;

describe("parity pairs the same rows whatever order each database sent them in", () => {
  const ORG = "33333333-3333-4333-8333-333333333333";
  const emails = ["admin@borivon.example", "admin2@borivon.example", "a_b@x.example", "a.b@x.example", "Zed@x.example", "bob@x.example"];
  const rows = emails.map((e) => ({ org_id: ORG, sub_admin_email: e, role: "member", created_at: "2026-01-01T00:00:00+00:00" }));
  const supabaseOrder = [...rows].sort((a, b) => compareText(a.sub_admin_email, b.sub_admin_email));
  const d1Order = [...rows].sort((a, b) => (a.sub_admin_email < b.sub_admin_email ? -1 : 1));
  const { pk, columns } = types.organization_members;
  const line = (r: Record<string, unknown>) => Object.keys(columns).map((c) => norm(r[c], columns[c].pg)).join("|");

  it("the two databases really do disagree on such keys", () => {
    expect(supabaseOrder.map(line)).not.toEqual(d1Order.map(line));
  });

  it("sorted by sortByKey, identical tables compare equal row for row", () => {
    expect(sortByKey(supabaseOrder, pk, columns).map(line)).toEqual(sortByKey(d1Order, pk, columns).map(line));
  });

  it("numeric keys sort as numbers", () => {
    const ids = [{ id: 10 }, { id: 9 }, { id: "100" }];
    expect(sortByKey(ids, ["id"], { id: { pg: "bigint" } }).map((r: { id: unknown }) => Number(r.id))).toEqual([9, 10, 100]);
  });
});
