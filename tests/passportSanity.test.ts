import { describe, it, expect } from "vitest";
import {
  looksLikeCaption, looksLikeNationalityWord, cleanScalar,
  cleanPlaceValue, cleanPassportNo, sanePassportDates,
} from "@/lib/passportSanity";

/**
 * Every case below is a value that was LIVE in the production database on a
 * candidate whose passport a human had already ticked as confirmed and an admin
 * had approved. The audit that found them is the reason this file exists.
 */

const TODAY = new Date("2026-08-04");

describe("caption detection — the passport's own printed labels", () => {
  it("catches the exact values found in production", () => {
    expect(looksLikeCaption("Date of birth")).toBe(true);
    expect(looksLikeCaption("الإمضاء Signature/Signature")).toBe(true);
    expect(looksLikeCaption("Signature/Signature")).toBe(true);
    expect(looksLikeCaption("الجنسية Nationalité Nationality الجنس Sexe Sex")).toBe(true);
  });

  it("catches captions in all three passport languages", () => {
    for (const s of ["LIEU DE NAISSANCE", "PLACE OF BIRTH", "GEBURTSORT",
                     "ROYAUME DU MAROC", "AUTORITE", "Nationalité"]) {
      expect(looksLikeCaption(s), s).toBe(true);
    }
  });

  it("catches a value that is mostly Arabic script", () => {
    expect(looksLikeCaption("المملكة المغربية")).toBe(true);
  });

  it("leaves real Moroccan places alone", () => {
    for (const s of ["CASABLANCA", "RABAT", "PROVINCE DE FES", "PREFECTURE DE MARRAKECH",
                     "OUISLANE", "TIZGANE", "AIT MELLOUL", "EL HAJEB", "SALÈ",
                     "PROVINCE D'EL JADIDA", "KSABI MOULOUYA"]) {
      expect(looksLikeCaption(s), s).toBe(false);
    }
  });
});

describe("nationality words are not places", () => {
  it("rejects the two that were live", () => {
    expect(looksLikeNationalityWord("Marocaine")).toBe(true);
    expect(looksLikeNationalityWord("MAROCAINE")).toBe(true);
  });
  it("does not reject the country itself or a city", () => {
    expect(looksLikeNationalityWord("Maroc")).toBe(false);
    expect(looksLikeNationalityWord("MARRAKECH")).toBe(false);
  });
});

describe("cleanPlaceValue", () => {
  it("drops the caption values, keeping nothing rather than junk", () => {
    expect(cleanPlaceValue("Date of birth")).toBe("");
    expect(cleanPlaceValue("الإمضاء Signature/Signature")).toBe("");
    expect(cleanPlaceValue("Marocaine")).toBe("");
  });

  it("drops the candidate's own name used as a city", () => {
    // LAMIA ADDI had city_of_residence = "LAMIA".
    expect(cleanPlaceValue("LAMIA", ["LAMIA", "ADDI"])).toBe("");
    expect(cleanPlaceValue("MARRAKECH", ["LAMIA", "ADDI"])).toBe("MARRAKECH");
  });

  it("trims the MRZ filler padding that was left on 30+ rows", () => {
    expect(cleanPlaceValue("PROVINCE DE FES ")).toBe("PROVINCE DE FES");
    expect(cleanPlaceValue(" PROVINCE DE OUJDA")).toBe("PROVINCE DE OUJDA");
    expect(cleanPlaceValue("OUISLANE ")).toBe("OUISLANE");
  });

  it("keeps accents and apostrophes that belong to the place", () => {
    expect(cleanPlaceValue("SALÈ")).toBe("SALÈ");
    expect(cleanPlaceValue("PROVINCE D'EL JADIDA")).toBe("PROVINCE D'EL JADIDA");
  });
});

describe("cleanScalar", () => {
  it("strips the MRZ filler that survived as spaces on real names", () => {
    expect(cleanScalar("RACHID        ")).toBe("RACHID");
    expect(cleanScalar(" ALYA       ")).toBe("ALYA");
    expect(cleanScalar("NAJOUA   ")).toBe("NAJOUA");
    expect(cleanScalar("SALMA  ")).toBe("SALMA");
  });
  it("removes control characters", () => {
    expect(cleanScalar("AD308237\nFT")).toBe("AD308237 FT");
    expect(cleanScalar("A\u0000B")).toBe("A B");
  });
});

describe("cleanPassportNo", () => {
  it("REFUSES the newline-bleed value rather than salvaging a head that may be short", () => {
    // "AD308237\nFT" was live, human-confirmed, on an approved profile. The head
    // "AD308237" is 8 chars where this dataset's dominant shape is 9 — the
    // missing character may be the one that bled onto the next line, so keeping
    // the head would store a plausible-looking WRONG passport number.
    expect(cleanPassportNo("AD308237\nFT")).toBe("");
  });

  it("keeps well-formed numbers in both Moroccan shapes", () => {
    expect(cleanPassportNo("EX8328793")).toBe("EX8328793");
    expect(cleanPassportNo("F695018")).toBe("F695018");
    expect(cleanPassportNo(" ex8328793 ")).toBe("EX8328793");
  });

  it("rejects anything that is not an ICAO document number", () => {
    expect(cleanPassportNo("R087428921")).toBe("");   // 10 chars, over the ICAO max
    expect(cleanPassportNo("AB-12345")).toBe("");     // punctuation
    expect(cleanPassportNo("12345")).toBe("");        // too short
    expect(cleanPassportNo(null)).toBe("");
    expect(cleanPassportNo("   ")).toBe("");
  });
});

describe("sanePassportDates — refuse the impossible, never guess the truth", () => {
  const run = (d: Parameters<typeof sanePassportDates>[0]) => sanePassportDates(d, TODAY);

  it("keeps a normal 5-year passport untouched", () => {
    const r = run({ dob: "1999-10-09", issue_date: "2021-05-25", passport_expiry: "2026-05-25" });
    expect(r.dates).toEqual({ dob: "1999-10-09", issue_date: "2021-05-25", passport_expiry: "2026-05-25" });
    expect(r.dropped).toEqual([]);
  });

  it("keeps a normal 10-year passport untouched", () => {
    const r = run({ dob: "1990-01-02", issue_date: "2020-03-04", passport_expiry: "2030-03-04" });
    expect(r.dropped).toEqual([]);
  });

  it("ASMAE LAKSSOUMI: issued 21 years before she was born", () => {
    const r = run({ dob: "1997-08-13", issue_date: "1976-12-02", passport_expiry: "2010-12-02" });
    expect(r.dates.issue_date).toBeNull();
    expect(r.dates.dob).toBe("1997-08-13");           // her dob is fine, keep it
    expect(r.dropped.join(" ")).toContain("before date of birth");
  });

  it("ZAKARYA EL KARRAM: expires four years before it was issued", () => {
    const r = run({ dob: "1998-01-01", issue_date: "2022-05-25", passport_expiry: "2018-05-25" });
    expect(r.dates.issue_date).toBeNull();
    expect(r.dates.passport_expiry).toBeNull();
    expect(r.dropped.join(" ")).toContain("expiry precedes issue");
  });

  it("ANAS GHANEM: expiry five years before the holder was born", () => {
    const r = run({ dob: "1999-09-11", issue_date: null, passport_expiry: "1994-01-01" });
    expect(r.dates.passport_expiry).toBeNull();
    expect(r.dates.dob).toBe("1999-09-11");
  });

  it("YOUSRA ERRAFI: issued in 2038", () => {
    const r = run({ dob: "2003-04-24", issue_date: "2038-04-08", passport_expiry: "2030-04-08" });
    expect(r.dates.issue_date).toBeNull();
    expect(r.dropped.join(" ")).toContain("in the future");
  });

  it("IMANE ALMOUCHAOUICH: a 17-year validity no passport has", () => {
    const r = run({ dob: "1998-06-01", issue_date: "2011-04-11", passport_expiry: "2028-04-11" });
    expect(r.dates.issue_date).toBeNull();
    expect(r.dates.passport_expiry).toBeNull();
    expect(r.dropped.join(" ")).toContain("not issuable");
  });

  it("AMALE LAMRABET: an 11-year validity — one year digit misread", () => {
    const r = run({ dob: "1995-01-01", issue_date: "2020-10-27", passport_expiry: "2031-10-27" });
    expect(r.dropped.join(" ")).toContain("not issuable");
  });

  it("DOHA ZINI: a 9-year validity", () => {
    const r = run({ dob: "1995-01-01", issue_date: "2023-12-21", passport_expiry: "2032-12-21" });
    expect(r.dropped.join(" ")).toContain("not issuable");
  });

  it("does NOT touch a passport that is merely expired — that is real, not corrupt", () => {
    // IKRAM AATMAN's passport genuinely expired on 2026-05-25. The founder needs
    // to see that, so it must survive the gate untouched.
    const r = run({ dob: "1999-10-09", issue_date: "2021-05-25", passport_expiry: "2026-05-25" });
    expect(r.dates.passport_expiry).toBe("2026-05-25");
    expect(r.dropped).toEqual([]);
  });

  it("drops a birth date in the future or before 1930", () => {
    expect(run({ dob: "2031-01-01" }).dates.dob).toBeNull();
    expect(run({ dob: "1899-01-01" }).dates.dob).toBeNull();
  });

  it("leaves partial records alone when there is nothing to contradict", () => {
    const r = run({ dob: "2002-12-06", issue_date: null, passport_expiry: "2029-12-25" });
    expect(r.dates.passport_expiry).toBe("2029-12-25");
    expect(r.dropped).toEqual([]);
  });
});
