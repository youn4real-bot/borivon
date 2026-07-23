import { describe, it, expect } from "vitest";
import { latestApprovedPerName, agencyRootFolderName, selectStaleMirrorFiles, mirrorFingerprint, isNachMatchingDoc, type ApprovedDoc, type MirrorFile } from "../lib/driveMirror";
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

  it("reject→re-approve round-trip: stale while rejected, NOT stale once live again", () => {
    // The doc's Drive copy carries its marker throughout. When the doc is
    // rejected it drops out of the live set → selected for Archiv. When the SAME
    // row is re-approved it's live again → must NOT be selected. (The companion
    // pointer-null in reconcile is what makes the re-approval actually re-upload;
    // this locks the classification half of that invariant.)
    const file = f("copy", "doc-1");
    expect(selectStaleMirrorFiles([file], []).map((o) => o.id)).toEqual(["copy"]);       // rejected
    expect(selectStaleMirrorFiles([file], ["doc-1"]).map((o) => o.id)).toEqual([]);      // re-approved
  });
});

describe("mirrorFingerprint — the sync must CONVERGE", () => {
  // Reality check 2026-07-20 against the live DB: 195 of 231 live approved docs
  // have file_sha256 = NULL. Under the old `file_sha256 === drive_mirror_sha256`
  // rule every one of them re-uploaded on EVERY sync, forever.
  const mirrored = (d: ApprovedDoc, fp: string | null) => !!(d.drive_mirror_id && fp && d.drive_mirror_sha256 === fp);

  it("uses file_sha256 when present", () => {
    expect(mirrorFingerprint(doc({ file_sha256: "abc", r2_key: "r2/x" }))).toBe("abc");
  });

  it("falls back to the r2 key when file_sha256 is missing", () => {
    expect(mirrorFingerprint(doc({ file_sha256: null, r2_key: "candidates/u/1_cv.pdf" })))
      .toBe("r2key:candidates/u/1_cv.pdf");
  });

  it("is null when there is nothing to identify the bytes by", () => {
    expect(mirrorFingerprint(doc({ file_sha256: null, r2_key: null }))).toBeNull();
  });

  it("CONVERGES: a sha-less doc is skipped on the second sync", () => {
    const d = doc({ id: "d1", file_sha256: null, r2_key: "candidates/u/1_cv.pdf" });
    const fp = mirrorFingerprint(d);
    expect(mirrored(d, fp)).toBe(false);                 // first sync: uploads
    const after = { ...d, drive_mirror_id: "drive-1", drive_mirror_sha256: fp };
    expect(mirrored(after, mirrorFingerprint(after))).toBe(true); // second sync: skipped
  });

  it("re-uploads when the bytes change, because a new upload mints a new r2 key", () => {
    const before = doc({ id: "d1", file_sha256: null, r2_key: "candidates/u/1_cv.pdf",
      drive_mirror_id: "drive-1", drive_mirror_sha256: "r2key:candidates/u/1_cv.pdf" });
    expect(mirrored(before, mirrorFingerprint(before))).toBe(true);
    const swapped = { ...before, r2_key: "candidates/u/2_cv.pdf" }; // CV regenerated
    expect(mirrored(swapped, mirrorFingerprint(swapped))).toBe(false);
  });

  it("re-uploads when a real sha appears later (fingerprint changes shape)", () => {
    const d = doc({ id: "d1", file_sha256: "realsha", r2_key: "candidates/u/1_cv.pdf",
      drive_mirror_id: "drive-1", drive_mirror_sha256: "r2key:candidates/u/1_cv.pdf" });
    expect(mirrored(d, mirrorFingerprint(d))).toBe(false); // one extra upload, then stable
  });

  it("never claims mirrored without a recorded drive file id", () => {
    const d = doc({ file_sha256: "abc", drive_mirror_id: null, drive_mirror_sha256: "abc" });
    expect(mirrored(d, mirrorFingerprint(d))).toBe(false);
  });
});

describe("isNachMatchingDoc — post-match docs route to Nach Matching", () => {
  it("routes visa-phase docs to Nach Matching (partner-shareable)", () => {
    for (const t of ["Motivationsschreiben Visum", "EZB", "Zusatzblatt A", "Vorabzustimmung", "Arbeitsvertrag", "Mawista", "Versicherung", "Videx"]) {
      expect(isNachMatchingDoc(t), t).toBe(true);
    }
  });
  it("does NOT route pre-match dossier docs to Nach Matching", () => {
    for (const t of ["Lebenslauf (DE)", "Reisepass", "Diplom (DE)", "Anschreiben", "B2 Sprachzertifikat", "Impfung", "Autre"]) {
      expect(isNachMatchingDoc(t), t).toBe(false);
    }
  });
  it("routes a wizard-slot UUID doc (post-match) to Nach Matching", () => {
    expect(isNachMatchingDoc("3caccf17-9740-440a-ab96-d74524ff75d7")).toBe(true);
  });
  it("pre and post are mutually exclusive (every doc goes to exactly one folder)", () => {
    for (const t of ["Lebenslauf (DE)", "Reisepass", "EZB", "Arbeitsvertrag", "", null, "3caccf17-9740-440a-ab96-d74524ff75d7"]) {
      // exactly one of the two predicates is true
      expect(isPreMatchDoc(t) !== isNachMatchingDoc(t), String(t)).toBe(true);
    }
  });
});
