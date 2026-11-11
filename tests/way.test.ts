import { describe, it, expect } from "vitest";
import { buildWay, until, shortDate, stepName, type WayInput } from "@/lib/facility/way";
import { VISA_STEPS } from "@/lib/facility/visa";

const base = (o: Partial<WayInput> = {}): WayInput => ({
  docs: { papers: [21, 21], bearbeitung: [4, 4], visum: [0, 0], pending: 0 },
  b2: { stage: "exam_booked", failed: false },
  steps: { visa: {}, move: {}, weeks: {}, six: {} },
  dates: { submitted: "", flight: "", start: "" },
  today: "2026-11-11",
  ...o,
});

describe("the way (lib/facility/way.ts)", () => {
  it("she is at the first open station of the chain; Deutsch never blocks it", () => {
    const w = buildWay(base());
    expect(w.stations.map((s) => s.key)).toEqual(["lang", "papers", "contract", "recog", "visa", "trip", "arrive", "kp", "stay"]);
    expect(w.now).toBe("visa");
    expect(w.win).toBe("recog");
    expect(w.next).toBe("vorab");
    expect(w.ticks).toHaveLength(VISA_STEPS.length);
    expect(w.stations.find((s) => s.key === "lang")!.done).toBe(false);
  });

  it("papers not done → papers; no countdown without a date", () => {
    const w = buildWay(base({ docs: { papers: [5, 21], bearbeitung: [0, 4], visum: [0, 3] } }));
    expect(w.now).toBe("papers");
    expect(w.win).toBe(null);
    expect(w.eta).toBe(null);
    expect(w.nowEta).toBe(null);
    expect(w.ticks).toEqual([]);
  });

  it("unknown documents → those stations are left out, not drawn wrong", () => {
    const w = buildWay(base({ docs: null, b2: null }));
    expect(w.stations.map((s) => s.key)).toEqual(["contract", "visa", "trip", "arrive", "kp", "stay"]);
    expect(w.now).toBe("visa");
  });

  it("visa handed in → estimate 20 days later; flight and first day win the header", () => {
    const w = buildWay(base({ dates: { submitted: "2026-11-05", flight: "", start: "" } }));
    expect(w.nowEta).toEqual({ kind: "visa", date: "2026-11-25", est: true });
    expect(w.eta).toEqual(w.nowEta);
    const w2 = buildWay(base({ dates: { submitted: "2026-11-05", flight: "2026-12-20", start: "2027-01-02" } }));
    expect(w2.eta).toEqual({ kind: "start", date: "2027-01-02", est: false });
    expect(w2.nowEta!.kind).toBe("visa");
  });

  it("visa granted → no visa estimate; started → probation end", () => {
    const allVisa = Object.fromEntries(VISA_STEPS.map((s) => [s.id, "x"]));
    const w = buildWay(base({ steps: { visa: allVisa, move: { flight: "x", pickup: "x", day1: "x" }, weeks: {}, six: {} }, dates: { submitted: "2026-11-05", flight: "", start: "2026-10-01" } }));
    expect(w.now).toBe("arrive");
    expect(w.eta).toEqual({ kind: "probation", date: "2027-04-01", est: false });
  });

  it("the flat runs beside the visa: its own four ticks, owned by the facility", () => {
    const w = buildWay(base({ steps: { visa: {}, move: { find: "x", wgb: "x" }, weeks: {}, six: {} } }));
    expect(w.home.map((t) => [t.id, t.done, t.who])).toEqual([["find", true, "facility"], ["lease", false, "facility"], ["wgb", true, "facility"], ["keys", false, "facility"]]);
    // the flat doesn't count for the journey station
    expect(w.stations.find((s) => s.key === "trip")!.p).toEqual([0, 3]);
  });

  it("Vertrag and Kenntnisprüfung never block; German in detail", () => {
    const lang = { level: "B1" as const, modules: { lesen: "passed" as const, hoeren: "passed" as const, schreiben: "pending" as const, sprechen: "failed" as const }, exam_date: "2026-11-20", provider: "telc" as const, school: "", path: "" as const };
    const w = buildWay(base({ lang, marks: { contract: "", kp_date: "2027-02-01", kp_result: "", urkunde: "" } }));
    expect(w.now).toBe("visa");
    expect(w.stations.find((s) => s.key === "lang")!.p).toEqual([2, 4]);
    expect(w.stations.find((s) => s.key === "contract")!.done).toBe(false);
    expect(w.upcoming.map((e) => e.kind)).toEqual(["exam", "kp"]);
    const all = { ...lang, modules: { lesen: "passed" as const, hoeren: "passed" as const, schreiben: "passed" as const, sprechen: "passed" as const } };
    const w2 = buildWay(base({ b2: { stage: "studying", failed: false }, lang: all, marks: { contract: "2026-10-01", kp_date: "2026-10-01", kp_result: "passed", urkunde: "2026-11-01" } }));
    expect(w2.stations.find((s) => s.key === "lang")!.done).toBe(true);
    expect(w2.stations.find((s) => s.key === "contract")!.done).toBe(true);
    expect(w2.stations.find((s) => s.key === "kp")!.done).toBe(true);
    expect(w2.upcoming).toEqual([]);
  });

  it("landed: the way there folds; she is in Germany", () => {
    const allVisa = Object.fromEntries(VISA_STEPS.map((s) => [s.id, "x"]));
    const w = buildWay(base({ steps: { visa: allVisa, move: { flight: "x", pickup: "x", day1: "x" }, weeks: {}, six: {} } }));
    expect(w.landed).toBe(true);
    expect(buildWay(base()).landed).toBe(false);
  });

  it("countdown words", () => {
    expect(until("2026-11-11", "2026-11-23", "de")).toEqual({ n: "12", unit: "Tage", word: "in 12 Tagen" });
    expect(until("2026-11-11", "2026-12-30", "de")).toEqual({ n: "7", unit: "Wochen", word: "in 7 Wochen" });
    expect(until("2026-11-11", "2027-05-11", "de").word).toBe("in 6 Monaten");
    expect(until("2026-11-11", "2026-11-12", "de").word).toBe("morgen");
    expect(until("2026-11-11", "2026-11-11", "fr").word).toBe("aujourd’hui");
    expect(until("2026-11-11", "2026-11-23", "fr").word).toBe("dans 12 jours");
    expect(shortDate("2026-12-04", "de")).toBe("Fr · 4. Dez.");
    expect(stepName("m1a", "de")).toBe("Monat 1");
    expect(stepName("wgb", "de")).toBe("Bestätigung vom Vermieter");
  });
});
