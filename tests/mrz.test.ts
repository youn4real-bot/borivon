import { describe, it, expect } from "vitest";
import { parseMRZ, splitMrzNameZone, scrubMrzJunk, looksLikeMrzJunk, mrzCheck } from "@/lib/mrz";

/**
 * The bug this file exists for:
 *
 * A candidate showed up in the admin list as
 *   "IKRAM    EX83287939MAR991OO9OF2 AATMAN"
 * — her entire MRZ line 2 had been glued onto her first name.
 *
 * Cause: Google Vision returned line 1 WITHOUT its trailing `<` filler, so it was
 * only 22 chars. findLine1 required 36+, skipped it, and matched the merged
 * "line1+line2" candidate instead. The given-name field then ran to the end of
 * that 44-char slice, swallowing row 2.
 */

// A real TD3 pair, rebuilt from the stored values of the affected record.
// Row 1 as Vision returned it — trailing filler dropped.
const L1_SHORT = "P<MARAATMAN<<IKRAM<<<<";
const L1_FULL  = "P<MARAATMAN<<IKRAM<<<<<<<<<<<<<<<<<<<<<<<<<<";
// Row 2 with the OCR's O-for-0 misreads in the date fields, exactly as captured.
const L2       = "EX83287939MAR9910O9OF2OO51O25<<<<<<<<<<<<<<06";

describe("MRZ name extraction", () => {
  it("does not let a short line 1 pull line 2 into the first name", () => {
    const r = parseMRZ(`${L1_SHORT}\n${L2}`);
    expect(r).not.toBeNull();
    expect(r!.first_name).toBe("IKRAM");
    expect(r!.last_name).toBe("AATMAN");
    // The exact regression: the stored value was "IKRAM    EX83287939MAR991OO9OF2"
    expect(r!.first_name).not.toContain("EX");
    expect(r!.first_name).not.toMatch(/[0-9]/);
  });

  it("still reads a full-width line 1 correctly", () => {
    const r = parseMRZ(`${L1_FULL}\n${L2}`);
    expect(r).not.toBeNull();
    expect(r!.first_name).toBe("IKRAM");
    expect(r!.last_name).toBe("AATMAN");
  });

  it("reads the rest of the record off line 2 unchanged", () => {
    const r = parseMRZ(`${L1_SHORT}\n${L2}`)!;
    expect(r.passport_no).toBe("EX8328793");
    expect(r.nationality).toBe("MAR");
    expect(r.dob).toBe("09.10.1999");
    expect(r.sex).toBe("F");
  });

  it("keeps multiple given names, which are single-< separated", () => {
    const l1 = "P<MARELMANSOURI<<FATIMA<ZAHRA<<<<<<<<<<<<<<<";
    const r = parseMRZ(`${l1}\n${L2}`)!;
    expect(r.first_name).toBe("FATIMA ZAHRA");
    expect(r.last_name).toBe("ELMANSOURI");
  });

  it("keeps compound surnames", () => {
    const l1 = "P<MARBEN<ALI<<YOUSSEF<<<<<<<<<<<<<<<<<<<<<<<";
    const r = parseMRZ(`${l1}\n${L2}`)!;
    expect(r.last_name).toBe("BEN ALI");
    expect(r.first_name).toBe("YOUSSEF");
  });

  it("survives OCR splitting line 1 across two output lines", () => {
    // The reason merged pairs are tried at all — neither half is usable alone.
    const r = parseMRZ(`P<MARAAT\nMAN<<IKRAM<<<<<<<<<<<<<<<<<<<<<<<<<<\n${L2}`);
    expect(r).not.toBeNull();
    expect(r!.first_name).toBe("IKRAM");
    expect(r!.last_name).toBe("AATMAN");
  });

  it("rejects non-MRZ text that happens to start with P", () => {
    expect(parseMRZ("PREFECTURE DE RABAT\nROYAUME DU MAROC")).toBeNull();
  });

  it("returns null when there is no line 2", () => {
    expect(parseMRZ(L1_FULL)).toBeNull();
  });
});

describe("splitMrzNameZone", () => {
  it("terminates the given-name field at the first << after the names", () => {
    expect(splitMrzNameZone("AATMAN<<IKRAM<<<<EX83287939MAR991OO9OF2")).toEqual({
      lastName: "AATMAN",
      firstName: "IKRAM",
    });
  });

  it("handles a zone with no given names", () => {
    expect(splitMrzNameZone("AATMAN<<<<<<<<<<")).toEqual({ lastName: "AATMAN", firstName: "" });
  });

  it("handles a zone with no separator at all", () => {
    expect(splitMrzNameZone("AATMAN")).toEqual({ lastName: "AATMAN", firstName: "" });
  });

  it("turns an OCR 0 back into the letter O", () => {
    expect(splitMrzNameZone("B0UAZZA<<0MAR<<<<<<").firstName).toBe("OMAR");
    expect(splitMrzNameZone("B0UAZZA<<0MAR<<<<<<").lastName).toBe("BOUAZZA");
  });
});

describe("MRZ junk detectors", () => {
  it("flags a stored name that is really MRZ", () => {
    expect(looksLikeMrzJunk("IKRAM    EX83287939MAR991OO9OF2")).toBe(true);
    expect(looksLikeMrzJunk("AATMAN<<IKRAM")).toBe(true);
  });

  it("leaves real names alone", () => {
    expect(looksLikeMrzJunk("IKRAM")).toBe(false);
    expect(looksLikeMrzJunk("FATIMA ZAHRA")).toBe(false);
    expect(looksLikeMrzJunk("")).toBe(false);
    expect(scrubMrzJunk("FATIMA ZAHRA")).toBe("FATIMA ZAHRA");
  });

  it("scrubs the leaked row and keeps the name", () => {
    expect(scrubMrzJunk("IKRAM    EX83287939MAR991OO9OF2")).toBe("IKRAM");
  });
});

describe("mrzCheck", () => {
  it("computes the ICAO 9303 check digit", () => {
    // ICAO Doc 9303 specimen: line 2 begins "L898902C36UTO…" — the 9-char
    // document-number field is "L898902C3" and its check digit is 6.
    expect(mrzCheck("L898902C3")).toBe(6);
    // Our own fixture must be a check-digit-valid MRZ, or findLine2's strict
    // branch would never be the thing under test.
    expect(mrzCheck("EX8328793")).toBe(9);
  });
});
