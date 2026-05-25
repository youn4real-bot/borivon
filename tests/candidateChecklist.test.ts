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
});
