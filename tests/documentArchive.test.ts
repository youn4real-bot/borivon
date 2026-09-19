import { describe, it, expect } from "vitest";
import { archivePatch, archivedCopyOf } from "@/lib/documentArchive";

/**
 * LAW #33 — "replaced files stay archived indefinitely".
 *
 * Two real regressions are pinned here. Both looked like archiving in the source
 * and were not:
 *
 *  1. The candidate's "Remove" / "Replace" hard-deleted the documents row. The
 *     only archiving in that handler was a Google Drive move guarded by
 *     GOOGLE_DRIVE_FOLDER_ID, which is unset since R2 became the store of
 *     record — so the guard skipped it and the delete ran unconditionally.
 *  2. Replacing a passport scan overwrote `r2_key` in place, dropping the only
 *     pointer to the previous scan while its bytes stayed in the bucket.
 */
describe("archivePatch", () => {
  it("marks a row archived with an ISO timestamp", () => {
    const p = archivePatch(new Date("2026-08-07T10:00:00.000Z"));
    expect(p).toEqual({ superseded_at: "2026-08-07T10:00:00.000Z" });
  });

  it("touches nothing except superseded_at — the bytes stay reachable", () => {
    // If this ever grew an `r2_key: null` or a status change, the archived row
    // would still be hidden but would no longer open, which is the same loss.
    expect(Object.keys(archivePatch())).toEqual(["superseded_at"]);
  });
});

describe("archivedCopyOf", () => {
  const row = {
    user_id: "11111111-1111-4111-8111-111111111111",
    file_name: "ikram_aatman_pflegekraft_reisepass.pdf",
    file_type: "reisepass",
    status: "approved",
    feedback: null,
    r2_key: "candidates/1111/old_reisepass.pdf",
    drive_file_id: "drive-abc",
    file_sha256: "a".repeat(64),
    rotation: 90,
    uploaded_at: "2026-01-02T03:04:05.000Z",
  };

  it("preserves the OUTGOING pointer, not the incoming one", () => {
    const copy = archivedCopyOf(row, new Date("2026-08-07T10:00:00.000Z"))!;
    expect(copy.r2_key).toBe("candidates/1111/old_reisepass.pdf");
    expect(copy.drive_file_id).toBe("drive-abc");
    expect(copy.file_sha256).toBe("a".repeat(64));
    expect(copy.superseded_at).toBe("2026-08-07T10:00:00.000Z");
  });

  it("keeps the review verdict the old bytes earned", () => {
    // Months later this is the only thing that says whether the scan being
    // looked at is the one that was actually approved.
    expect(archivedCopyOf(row)!.status).toBe("approved");
  });

  it("keeps the original upload time so ordering still puts it behind the new row", () => {
    // The live passport lookup takes the newest row; an archived copy stamped
    // with `now` would sort ahead of the replacement it was archived for.
    expect(archivedCopyOf(row)!.uploaded_at).toBe("2026-01-02T03:04:05.000Z");
  });

  it("returns null when there are no previous bytes to preserve", () => {
    expect(archivedCopyOf({ ...row, r2_key: null, drive_file_id: null })).toBeNull();
  });

  it("still archives a Drive-only row (one such document is left in prod)", () => {
    const copy = archivedCopyOf({ ...row, r2_key: null });
    expect(copy).not.toBeNull();
    expect(copy!.drive_file_id).toBe("drive-abc");
  });

  it("never carries the source row's id — it must insert as a new row", () => {
    expect(archivedCopyOf(row)).not.toHaveProperty("id");
  });

  /**
   * The regression that made the page organiser fail 100% of the time, from the
   * day it shipped until 2026-09-19. `documents.file_path` is NOT NULL with no
   * database default; the archived clone never set it, so Postgres refused the
   * INSERT with
   *
   *   null value in column "file_path" of relation "documents"
   *   violates not-null constraint
   *
   * and both callers abort on a failed archive (correctly — losing the original
   * is worse than not reordering), so every save answered 500. The suite was
   * green throughout because it asserted every field EXCEPT this one and never
   * touched a database. These tests are that gap closed.
   */
  it("carries file_path — NOT NULL in Postgres, so a missing one rejects the INSERT", () => {
    const copy = archivedCopyOf({ ...row, file_path: "gdrive/1111/1700000000000" })!;
    expect(copy.file_path).toBe("gdrive/1111/1700000000000");
  });

  it("still produces a usable file_path when the caller did not select one", () => {
    // Degrade gracefully rather than 500 the whole operation: r2_key and
    // drive_file_id are what actually reach the bytes, so an approximate
    // bookkeeping path on an archived row costs nothing.
    const copy = archivedCopyOf({ ...row, file_path: undefined }, new Date("2026-08-07T10:00:00.000Z"))!;
    expect(copy.file_path).toBeTruthy();
    expect(typeof copy.file_path).toBe("string");
  });

  it("every NOT NULL column without a database default is present and non-null", () => {
    // user_id, file_name and file_path are NOT NULL with no default (id,
    // rotation and uploaded_by_admin all default in the database). If this ever
    // fails again, every reorder and every passport replace is 500-ing in prod.
    const copy = archivedCopyOf({ ...row, file_path: "r2/1111/1" })! as Record<string, unknown>;
    for (const col of ["user_id", "file_name", "file_path"]) {
      expect(copy[col], `${col} must be non-null`).not.toBeNull();
      expect(copy[col], `${col} must be present`).toBeDefined();
    }
  });
});
