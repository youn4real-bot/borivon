import { describe, it, expect } from "vitest";
import { latestApprovedPerName, agencyRootFolderName, selectStaleMirrorFiles, type ApprovedDoc, type MirrorFile } from "../lib/driveMirror";
import { isPreMatchDoc } from "../lib/fileKeys";

const doc = (o: Partial<ApprovedDoc>): ApprovedDoc => ({
  id: o.id ?? "id", file_name: o.file_name ?? null, file_type: o.file_type ?? null,
  // NB: use `in` not `??` so an explicit `r2_key: null` survives (?? would coalesce it).
  r2_key: "r2_key" in o ? o.r2_key! : "r2/key", file_sha256: o.file_sha256 ?? null,
  drive_mirror_id: o.drive_mirror_id ?? null, drive_mirror_sha256: o.drive_mirror_sha256 ?? null,
  uploaded_at: o.uploaded_at ?? null,
});

describe("agencyRootFolderName", () => {
  it("appends ' X Borivon'", () => {
    expect(agencyRootFolderName("Calmaroi")).toBe("Calmaroi X Borivon");
    expect(agencyRootFolderName("  Calmaroi ")).toBe("Calmaroi X Borivon");
  });
  it("falls back for empty", () => {
    expect(agencyRootFolderName("")).toBe("Agentur X Borivon");
  });
});

describe("latestApprovedPerName — dedup keeps newest per filename (saves API)", () => {
  it("collapses re-uploads of the same filename to the latest", () => {
    const docs = [
      doc({ id: "a", file_name: "walid_lebenslauf.pdf", uploaded_at: "2026-05-01T00:00:00Z" }),
      doc({ id: "b", file_name: "walid_lebenslauf.pdf", uploaded_at: "2026-07-01T00:00:00Z" }),
      doc({ id: "c", file_name: "walid_lebenslauf.pdf", uploaded_at: "2026-06-01T00:00:00Z" }),
    ];
    const out = latestApprovedPerName(docs);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b"); // the newest
  });

  it("keeps distinct filenames separate", () => {
    const docs = [
      doc({ id: "a", file_name: "walid_lebenslauf.pdf" }),
      doc({ id: "b", file_name: "walid_reisepass.pdf" }),
      doc({ id: "c", file_name: "walid_diplom.pdf" }),
    ];
    expect(latestApprovedPerName(docs)).toHaveLength(3);
  });

  it("is case-insensitive on the filename key", () => {
    const docs = [
      doc({ id: "a", file_name: "Walid_Lebenslauf.pdf", uploaded_at: "2026-05-01T00:00:00Z" }),
      doc({ id: "b", file_name: "walid_lebenslauf.pdf", uploaded_at: "2026-07-01T00:00:00Z" }),
    ];
    const out = latestApprovedPerName(docs);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b");
  });

  it("drops docs with no r2_key (nothing to copy)", () => {
    const docs = [
      doc({ id: "a", file_name: "x.pdf", r2_key: null }),
      doc({ id: "b", file_name: "y.pdf", r2_key: "r2/y" }),
    ];
    const out = latestApprovedPerName(docs);
    expect(out.map((d) => d.id)).toEqual(["b"]);
  });

  it("falls back to file_type then id when file_name is null", () => {
    const docs = [
      doc({ id: "a", file_name: null, file_type: "Lebenslauf", uploaded_at: "2026-05-01T00:00:00Z" }),
      doc({ id: "b", file_name: null, file_type: "Lebenslauf", uploaded_at: "2026-07-01T00:00:00Z" }),
    ];
    const out = latestApprovedPerName(docs);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("b");
  });
});

describe("isPreMatchDoc — Vor Matching (dossier) vs Nach Matching (visa/slots)", () => {
  it("classifies the pre-match dossier as Vor Matching", () => {
    for (const t of ["Lebenslauf (DE)", "Passeport", "Reisepass", "Diplom (DE)", "Anschreiben", "Autre", "Impfung"]) {
      expect(isPreMatchDoc(t), t).toBe(true);
    }
  });
  it("keeps the German B2 language cert in the dossier", () => {
    expect(isPreMatchDoc("B2 Sprachzertifikat")).toBe(true);
  });
  it("classifies visa/Bearbeitung docs as post-match (NOT Vor Matching)", () => {
    for (const t of ["Motivationsschreiben Visum", "EZB", "Zusatzblatt A", "Vorabzustimmung", "Arbeitsvertrag", "Defizitbescheid", "Videx", "Mawista", "Versicherung"]) {
      expect(isPreMatchDoc(t), t).toBe(false);
    }
  });
  it("treats a wizard-slot UUID file_type as post-match", () => {
    expect(isPreMatchDoc("3caccf17-9740-440a-ab96-d74524ff75d7")).toBe(false);
  });
  it("treats an untyped doc as dossier (safe default)", () => {
    expect(isPreMatchDoc("")).toBe(true);
    expect(isPreMatchDoc(null)).toBe(true);
  });
});

describe("selectStaleMirrorFiles — retraction safety (LAW #33)", () => {
  const f = (id: string, docId?: string, name = `${id}.pdf`): MirrorFile =>
    ({ id, name, appProperties: docId ? { borivon_doc_id: docId } : undefined });

  it("NEVER touches a file the portal didn't place (no marker)", () => {
    // The founder's own notes/contracts sitting in the same folder.
    const files = [f("x", undefined, "meine_notizen.docx"), f("y", undefined, "vertrag.pdf")];
    expect(selectStaleMirrorFiles(files, ["d1"])).toEqual([]);
  });

  it("leaves a mirrored copy alone while its doc is still live", () => {
    expect(selectStaleMirrorFiles([f("x", "d1")], ["d1", "d2"])).toEqual([]);
  });

  it("retracts a mirrored copy whose doc is no longer current", () => {
    // doc got rejected / superseded / swapped → its id drops out of the live set.
    const out = selectStaleMirrorFiles([f("x", "d1"), f("y", "d2")], ["d2"]);
    expect(out.map((o) => o.id)).toEqual(["x"]);
  });

  it("retracts everything mirrored when the candidate has no live docs left", () => {
    const out = selectStaleMirrorFiles([f("x", "d1"), f("y", "d2")], []);
    expect(out.map((o) => o.id)).toEqual(["x", "y"]);
  });

  it("skips entries with no file id (can't be moved)", () => {
    const files: MirrorFile[] = [{ id: null, name: "ghost", appProperties: { borivon_doc_id: "gone" } }];
    expect(selectStaleMirrorFiles(files, [])).toEqual([]);
  });

  it("mixes safely: retract ours, keep his, keep live", () => {
    const files = [f("mine-stale", "d-old"), f("mine-live", "d-live"), f("his", undefined, "handout.pdf")];
    const out = selectStaleMirrorFiles(files, ["d-live"]);
    expect(out.map((o) => o.id)).toEqual(["mine-stale"]);
  });
});
