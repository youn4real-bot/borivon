import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { diffOpenApi } from "../d1/check-drift.mjs";

/**
 * d1/check-drift.mjs is the guard that stops the D1 copy falling a migration
 * behind again (assistant_commitments.source_message_id went NOT NULL DEFAULT ''
 * live while the snapshot kept it nullable). Every kind of structural change
 * must produce a line — and an unchanged document must produce none.
 */
const snap = JSON.parse(fs.readFileSync("d1/snapshot/openapi.json", "utf8"));
const clone = () => JSON.parse(JSON.stringify(snap));

describe("diffOpenApi", () => {
  it("finds nothing between a document and itself", () => {
    expect(diffOpenApi(clone(), snap)).toEqual([]);
  });

  it("names the drift that actually happened (a column gaining NOT NULL and a default)", () => {
    const old = clone();
    delete old.definitions.assistant_commitments.properties.source_message_id.default;
    old.definitions.assistant_commitments.required = old.definitions.assistant_commitments.required.filter((c: string) => c !== "source_message_id");
    expect(diffOpenApi(snap, old)).toEqual([
      'assistant_commitments.source_message_id: default (none) → ""',
      "assistant_commitments.source_message_id: now NOT NULL",
    ]);
  });

  it("reports added / removed tables and columns, type changes and new functions", () => {
    const live = clone();
    live.definitions.brand_new = { type: "object", properties: { id: { format: "uuid", type: "string" } } };
    delete live.definitions.leads;
    live.definitions.documents.properties.checksum = { format: "text", type: "string" };
    delete live.definitions.documents.properties.file_type;
    live.definitions.notifications.properties.action.format = "character varying";
    live.paths["/rpc/new_function"] = { post: {} };
    const out = diffOpenApi(live, snap);
    expect(out).toEqual(expect.arrayContaining([
      "table added: brand_new",
      "table removed: leads",
      "column added: documents.checksum (text)",
      "column removed: documents.file_type",
      'notifications.action: format "text" → "character varying"',
      "path added: /rpc/new_function",
    ]));
  });

  it("does not print row data — only structure lives in the document", () => {
    const live = clone();
    live.info.version = "99";
    expect(diffOpenApi(live, snap)).toEqual(["info: changed"]);
  });
});
