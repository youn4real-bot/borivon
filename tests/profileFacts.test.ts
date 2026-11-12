import { describe, it, expect } from "vitest";
import { profileFacts } from "@/lib/facility/profile";

const today = new Date(Date.UTC(2026, 10, 12));

describe("profileFacts", () => {
  it("counts work months once across overlaps, skips gaps, newest departments first", () => {
    const f = profileFacts({
      city: " EL HAJEB ",
      workEntries: [
        { isGap: false, title: "Pflegepraktikantin", departments: ["Chirurgie"], start: { month: "02", year: "2020" }, end: { month: "07", year: "2021" } },
        { isGap: true, title: "", departments: [], start: { month: "08", year: "2021" }, end: { month: "08", year: "2021" } },
        { isGap: false, title: "Gesundheits- und Krankenpflegerin", departments: ["Innere Medizin", "Kardiologie"], start: { month: "09", year: "2021" }, end: null },
        { isGap: false, title: "Nachtdienst", departments: ["Innere Medizin"], start: { month: "01", year: "2022" }, end: { month: "06", year: "2022" } },
      ],
      langs: [{ name: "Deutsch", level: "B1" }],
    }, "", today);
    // the internship does not count; 09/2021–11/2026 = 63 months (the overlapping Nachtdienst adds nothing)
    expect(f.months).toBe(63);
    expect(f.depts).toEqual(["Innere Medizin", "Kardiologie", "Chirurgie"]);
    expect(f.city).toBe("El Hajeb");
    expect(f.german).toBe("B1");
  });

  it("fx_lang level wins over the CV, and an empty draft gives no facts", () => {
    expect(profileFacts({ langs: [{ name: "Deutsch", level: "B1" }] }, "b2", today).german).toBe("B2");
    expect(profileFacts(null, "", today)).toEqual({ city: "", german: "", months: 0, depts: [] });
  });
});
