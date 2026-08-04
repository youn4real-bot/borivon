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

/**
 * Fuzz: the point is not that the parser reads every mangled scan, it is that it
 * NEVER INVENTS A NAME. For any realistic OCR mangling the result must be the
 * right name or nothing — because a blank first name means an admin types it in,
 * while a wrong one is silently written to the profile, printed on the CV and
 * mailed to a German employer.
 *
 * This caught two defects that the hand-written cases above did not:
 *   1. a hard-truncated line 1 returned "ZA" for "ZAKARYA" (the length floor had
 *      been lowered to 12 to fix the merged-pair bug, which let fragments in)
 *   2. the first attempt at guarding that was inert, because padding the zone to
 *      44 appended the very "<<" terminator the guard looked for
 */
function buildTD3(surname: string, given: string, docNo: string, country = "MAR") {
  const nameZone = `${surname.replace(/[ -]/g, "<")}<<${given.replace(/ /g, "<")}`;
  const l1 = `P<${country}${nameZone}`.padEnd(44, "<").slice(0, 44);
  const doc9 = docNo.padEnd(9, "<").slice(0, 9);
  const dob = "991009", exp = "300525";
  const l2 = (doc9 + mrzCheck(doc9) + country + dob + mrzCheck(dob) + "F" + exp + mrzCheck(exp))
    .padEnd(43, "<").slice(0, 43);
  return { l1, l2: l2 + mrzCheck(l2.slice(0, 43)) };
}

// How Google Vision actually mangles an MRZ block on a phone photo of a passport.
const MANGLERS: [string, (a: string, b: string) => string][] = [
  ["clean",                    (a, b) => `${a}\n${b}`],
  ["trailing filler clipped",  (a, b) => `${a.replace(/<+$/, "<<<<")}\n${b}`],
  ["all trailing filler gone", (a, b) => `${a.replace(/<+$/, "")}\n${b}`],
  ["line 1 split in two",      (a, b) => `${a.slice(0, 8)}\n${a.slice(8)}\n${b}`],
  ["line 2 split in two",      (a, b) => `${a}\n${b.slice(0, 10)}\n${b.slice(10)}`],
  ["spaces injected",          (a, b) => `${a.replace(/(.{6})/g, "$1 ")}\n${b}`],
  ["page text around it",      (a, b) => `ROYAUME DU MAROC\nPASSEPORT\nPREFECTURE DE RABAT\n${a}\n${b}\nDGSN`],
  ["leading P dropped",        (a, b) => `${a.slice(1)}\n${b}`],
  ["filler read as a letter",  (a, b) => `${a.replace(/<{4,}$/, m => "K".repeat(m.length))}\n${b}`],
  ["O/0 confusion in line 2",  (a, b) => `${a}\n${b.replace(/0/g, "O")}`],
  ["lines reversed",           (a, b) => `${b}\n${a}`],
  ["line 1 cut mid-name",      (a, b) => `${a.slice(0, 18)}\n${b}`],
  ["blank line between",       (a, b) => `${a}\n\n${b}`],
  ["line 1 duplicated",        (a, b) => `${a}\n${a}\n${b}`],
  ["noise line of digits",     (a, b) => `${a}\n1234567890123456789012345678901234567890\n${b}`],
  ["CRLF",                     (a, b) => `${a}\r\n${b}\r\n`],
];

const PEOPLE = [
  ["AATMAN",        "IKRAM"],
  ["EL KARRAM",     "ZAKARYA"],
  ["ALMOUCHAOUICH", "IMANE"],
  ["BEN CHIR",      "MOHAMED YASSINE"],
  ["OUBELAHCEN",    "NAJOUA"],
  // MRZ cannot encode a hyphen — ICAO maps it to '<', so it reads back as a space.
  ["EL-ALAMI",      "ZINEB"],
];

describe("parseMRZ fuzz — a name is right or blank, never invented", () => {
  const bad: string[] = [];
  let total = 0, exact = 0, blank = 0, none = 0;

  for (const [surname, given] of PEOPLE) {
    const wantLast = surname.replace(/-/g, " ");
    for (const doc of ["EX8328793", "UZ1234567", "AB123456"]) {
      const { l1, l2 } = buildTD3(surname, given, doc);
      for (const [name, mangle] of MANGLERS) {
        total++;
        const r = parseMRZ(mangle(l1, l2));
        if (!r) { none++; continue; }
        const { first_name: f, last_name: s } = r;
        if (/[0-9<]/.test(f) || /[0-9<]/.test(s)) {
          bad.push(`INVENTED (junk) ${given} ${surname} / ${name}: first="${f}" last="${s}"`);
        } else if (f === given && s === wantLast) {
          exact++;
        } else if ((!f || f === given) && (!s || s === wantLast)) {
          blank++;   // a field was dropped rather than guessed — the safe outcome
        } else {
          bad.push(`INVENTED (wrong) ${given} ${surname} / ${name}: first="${f}" last="${s}"`);
        }
      }
    }
  }

  it("never returns a name the passport does not contain", () => {
    expect(bad).toEqual([]);
  });

  it("still reads the great majority of manglings exactly right", () => {
    expect(total).toBe(288);
    expect(none).toBeLessThanOrEqual(24);       // returning null is safe, just unhelpful
    expect(exact).toBeGreaterThanOrEqual(220);  // regression guard on usefulness
    expect(exact + blank + none).toBe(total);
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
