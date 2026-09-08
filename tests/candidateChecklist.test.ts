import { describe, it, expect } from "vitest";
import { computeChecklist, CHECKLIST_ITEMS, type DocLike } from "../lib/candidateChecklist";
import { FILE_KEY_ALL_LABELS } from "../lib/fileKeys";

// A representative stored label for a fileKey (what documents.file_type holds).
function labelFor(key: string): string {
  const set = FILE_KEY_ALL_LABELS[key];
  return set && set.size ? [...set][0] : key;
}

// Every catalog item (+ translations) approved.
function allApprovedDocs(): DocLike[] {
  const docs: DocLike[] = [];
  for (const it of CHECKLIST_ITEMS) {
    docs.push({ file_type: labelFor(it.key), status: "approved" });
    if (it.hasTranslation) docs.push({ file_type: labelFor(`${it.key}_de`), status: "approved" });
  }
  return docs;
}

describe("computeChecklist", () => {
  it("empty docs → everything missing, 0%", () => {
    const c = computeChecklist([]);
    expect(c.requiredComplete).toBe(0);
    expect(c.pct).toBe(0);
    expect(c.counts.missing).toBe(c.requiredTotal);
    expect(c.items.every(i => i.state === "missing")).toBe(true);
  });

  it("all required docs approved → 100%", () => {
    const c = computeChecklist(allApprovedDocs());
    expect(c.pct).toBe(100);
    expect(c.requiredComplete).toBe(c.requiredTotal);
    expect(c.counts.pending).toBe(0);
    expect(c.counts.rejected).toBe(0);
    expect(c.counts.missing).toBe(0);
  });

  it("matches a real stored label (file_type) to the right box", () => {
    const c = computeChecklist([{ file_type: labelFor("id"), status: "approved" }]);
    expect(c.items.find(i => i.key === "id")!.state).toBe("complete");
    expect(c.requiredComplete).toBe(1);
  });

  it("a dual doc isn't complete until BOTH original + translation are approved", () => {
    const c = computeChecklist([{ file_type: labelFor("diploma"), status: "approved" }]);
    const dip = c.items.find(i => i.key === "diploma")!;
    expect(dip.original).toBe("approved");
    expect(dip.translation).toBe("missing");
    expect(dip.state).toBe("pending");
  });

  it("a rejected doc surfaces as rejected (needs reupload)", () => {
    const c = computeChecklist([{ file_type: labelFor("langcert"), status: "rejected" }]);
    expect(c.items.find(i => i.key === "langcert")!.state).toBe("rejected");
    expect(c.counts.rejected).toBe(1);
  });

  it("approved beats a stale rejected re-upload on the same box", () => {
    const c = computeChecklist([
      { file_type: labelFor("id"), status: "rejected" },
      { file_type: labelFor("id"), status: "approved" },
    ]);
    expect(c.items.find(i => i.key === "id")!.original).toBe("approved");
  });

  it("optional items (work_experience) don't drag down the percentage", () => {
    const docs = allApprovedDocs().filter(d =>
      d.file_type !== labelFor("work_experience") && d.file_type !== labelFor("work_experience_de"));
    const c = computeChecklist(docs);
    expect(c.pct).toBe(100);
    const we = c.items.find(i => i.key === "work_experience")!;
    expect(we.optional).toBe(true);
    expect(we.state).toBe("missing");
  });

  it("pending (uploaded, awaiting review) is distinct from missing", () => {
    const c = computeChecklist([{ file_type: labelFor("cv_de"), status: "pending" }]);
    expect(c.items.find(i => i.key === "cv_de")!.state).toBe("pending");
    expect(c.counts.pending).toBe(1);
    expect(c.counts.missing).toBe(c.requiredTotal - 1);
  });

  // ── Per-org required-doc override (e.g. Calmaroi) ─────────────────────────
  describe("requiredKeys override", () => {
    it("null/empty override falls back to the built-in default set", () => {
      const base = computeChecklist(allApprovedDocs());
      expect(computeChecklist(allApprovedDocs(), { requiredKeys: null }).requiredTotal).toBe(base.requiredTotal);
      expect(computeChecklist(allApprovedDocs(), { requiredKeys: [] }).requiredTotal).toBe(base.requiredTotal);
    });

    it("only the listed docs count toward the denominator", () => {
      const c = computeChecklist([], { requiredKeys: ["id", "cv_de", "langcert"] });
      expect(c.requiredTotal).toBe(3);
      expect(c.counts.missing).toBe(3);
    });

    it("100% once exactly the required subset is approved — extra papers don't matter", () => {
      const req = ["id", "cv_de", "letter", "langcert", "diploma", "transcript", "workcert", "impfung"];
      const docs: DocLike[] = [];
      for (const key of req) {
        docs.push({ file_type: labelFor(key), status: "approved" });
        const it = CHECKLIST_ITEMS.find(i => i.key === key)!;
        if (it.hasTranslation) docs.push({ file_type: labelFor(`${key}_de`), status: "approved" });
      }
      const c = computeChecklist(docs, { requiredKeys: req });
      expect(c.requiredTotal).toBe(req.length);
      expect(c.pct).toBe(100);
      // Abitur/Praktikum are still MISSING but excluded from the % → no drag-down.
      expect(c.items.find(i => i.key === "abitur")!.state).toBe("missing");
    });

    it("override can drop a normally-required doc", () => {
      // Require ONLY diploma; id (default-required) is excluded by the override.
      const c = computeChecklist([{ file_type: labelFor("id"), status: "approved" }], { requiredKeys: ["diploma"] });
      expect(c.requiredTotal).toBe(1);
      expect(c.pct).toBe(0); // diploma missing → 0/1
    });

    it("STANDING RULE: Berufserfahrung / Ausbildungspraktikum are never required, even if an org override names them", () => {
      const c = computeChecklist([], { requiredKeys: ["work_experience", "praktikum", "id"] });
      expect(c.requiredTotal).toBe(1); // only `id` survives
      expect(c.items.find(i => i.key === "work_experience")!.optional).toBe(true);
      expect(c.items.find(i => i.key === "praktikum")!.optional).toBe(true);
    });

    it("STANDING RULE holds with no override: Praktikum never drags the % down", () => {
      const docs = allApprovedDocs().filter(d =>
        d.file_type !== labelFor("praktikum") && d.file_type !== labelFor("praktikum_de") &&
        d.file_type !== labelFor("work_experience") && d.file_type !== labelFor("work_experience_de"));
      expect(computeChecklist(docs).pct).toBe(100);
    });

    it("unknown keys in the override are ignored (can't inflate the denominator)", () => {
      const c = computeChecklist([{ file_type: labelFor("id"), status: "approved" }], { requiredKeys: ["id", "not_a_real_key"] });
      expect(c.requiredTotal).toBe(1);
      expect(c.pct).toBe(100);
    });
  });
});
