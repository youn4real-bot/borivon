import { describe, it, expect } from "vitest";
import {
  isCommitmentOverdue, isCommitmentNudgeable, commitmentKey, normalizeWhat, formatCommitments,
  COMMITMENT_MAX_NUDGES, type Commitment,
} from "../lib/commitments";
import { parseExtractedPromises } from "../lib/commitmentsRun";

const NOW = Date.UTC(2026, 6, 24, 12, 0, 0); // 2026-07-24 12:00 UTC
const iso = (d: number) => new Date(d).toISOString();
const DAY = 86_400_000, HOUR = 3_600_000;

const c = (o: Partial<Commitment>): Commitment => ({
  id: o.id ?? 1,
  who_email: o.who_email ?? "anna@klinik.de",
  // `in` not `??` so an explicit `who_name: null` survives (?? would coalesce it).
  who_name: "who_name" in o ? o.who_name! : "Anna",
  what: o.what ?? "Fahrplan",
  due_at: "due_at" in o ? o.due_at! : null,
  promised_at: o.promised_at ?? iso(NOW - 1 * DAY),
  source_subject: o.source_subject ?? "Re: Kandidaten",
  status: o.status ?? "open",
  last_nudge_at: o.last_nudge_at ?? null,
  nudge_count: o.nudge_count ?? 0,
});

describe("isCommitmentOverdue — when has a promise gone bad?", () => {
  it("a stated deadline is overdue only AFTER the grace period", () => {
    const due = iso(NOW - 2 * HOUR); // 2h past due
    expect(isCommitmentOverdue(c({ due_at: due }), NOW)).toBe(false);   // inside 12h grace
    const older = iso(NOW - 20 * HOUR);
    expect(isCommitmentOverdue(c({ due_at: older }), NOW)).toBe(true);  // past grace
  });

  it("a future deadline is never overdue", () => {
    expect(isCommitmentOverdue(c({ due_at: iso(NOW + 3 * DAY) }), NOW)).toBe(false);
  });

  it("with NO deadline it goes overdue on age alone", () => {
    expect(isCommitmentOverdue(c({ promised_at: iso(NOW - 2 * DAY) }), NOW)).toBe(false);
    expect(isCommitmentOverdue(c({ promised_at: iso(NOW - 6 * DAY) }), NOW)).toBe(true);
  });

  it("anything already done or dropped is never overdue", () => {
    const old = { promised_at: iso(NOW - 90 * DAY) };
    expect(isCommitmentOverdue(c({ ...old, status: "done" }), NOW)).toBe(false);
    expect(isCommitmentOverdue(c({ ...old, status: "dropped" }), NOW)).toBe(false);
  });

  it("survives an unparseable date instead of throwing", () => {
    expect(isCommitmentOverdue(c({ due_at: "not-a-date", promised_at: "junk" }), NOW)).toBe(false);
  });
});

describe("isCommitmentNudgeable — chase, but never nag", () => {
  const overdue = { promised_at: iso(NOW - 10 * DAY) };

  it("chases an overdue promise never nudged before", () => {
    expect(isCommitmentNudgeable(c(overdue), NOW)).toBe(true);
  });

  it("does NOT chase again inside the gate", () => {
    expect(isCommitmentNudgeable(c({ ...overdue, last_nudge_at: iso(NOW - 2 * HOUR), nudge_count: 1 }), NOW)).toBe(false);
  });

  it("chases again once the gate has passed", () => {
    expect(isCommitmentNudgeable(c({ ...overdue, last_nudge_at: iso(NOW - 30 * HOUR), nudge_count: 1 }), NOW)).toBe(true);
  });

  it("gives up after the cap — it is clearly not coming", () => {
    expect(isCommitmentNudgeable(c({ ...overdue, last_nudge_at: iso(NOW - 30 * HOUR), nudge_count: COMMITMENT_MAX_NUDGES }), NOW)).toBe(false);
  });

  it("never chases something that is not overdue yet", () => {
    expect(isCommitmentNudgeable(c({ promised_at: iso(NOW - 1 * DAY) }), NOW)).toBe(false);
  });
});

describe("dedup — re-scanning the same email must not duplicate", () => {
  it("normalises articles, case and spacing", () => {
    expect(normalizeWhat("The  Fahrplan ")).toBe("fahrplan");
    expect(normalizeWhat("der Vertrag")).toBe("vertrag");
    expect(normalizeWhat("le contrat")).toBe("contrat");
  });
  it("same promise in the same email → same key", () => {
    expect(commitmentKey({ source_message_id: "m1", what: "the Fahrplan" }))
      .toBe(commitmentKey({ source_message_id: "m1", what: "Fahrplan" }));
  });
  it("different email → different key (a re-promise is its own row)", () => {
    expect(commitmentKey({ source_message_id: "m1", what: "Fahrplan" }))
      .not.toBe(commitmentKey({ source_message_id: "m2", what: "Fahrplan" }));
  });
});

describe("formatCommitments — minimalist by standing rule", () => {
  it("is bare: no emojis, no chatter, one line each", () => {
    const out = formatCommitments([
      c({ who_name: "Anna", what: "Fahrplan", due_at: iso(NOW - 3 * DAY) }),
      c({ id: 2, who_name: "UKSH", what: "signed contract", promised_at: iso(NOW - 9 * DAY) }),
    ], NOW);
    expect(out).toBe("Anna: Fahrplan (due 2026-07-21)\nUKSH: signed contract (promised 9d ago)");
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u); // no emoji
  });
  it("says so plainly when there is nothing", () => {
    expect(formatCommitments([], NOW)).toBe("Nothing outstanding.");
  });
  it("falls back to the email when there is no name", () => {
    expect(formatCommitments([c({ who_name: null, what: "X", promised_at: iso(NOW) })], NOW))
      .toBe("anna@klinik.de: X (promised 0d ago)");
  });
});

describe("parseExtractedPromises — the model's output must never crash the scan", () => {
  it("reads clean JSON", () => {
    const out = parseExtractedPromises('{"promises":[{"what":"Fahrplan","due":"2026-08-01"}]}');
    expect(out).toEqual([{ what: "Fahrplan", due: "2026-08-01" }]);
  });
  it("tolerates a code fence and surrounding prose", () => {
    const out = parseExtractedPromises('Sure!\n```json\n{"promises":[{"what":"contract","due":null}]}\n```');
    expect(out).toEqual([{ what: "contract", due: null }]);
  });
  it("returns [] for the explicit empty case", () => {
    expect(parseExtractedPromises('{"promises":[]}')).toEqual([]);
  });
  it("returns [] on junk / refusal / empty instead of throwing", () => {
    for (const junk of ["", "I cannot help with that.", "{", "null", "[1,2,3]"]) {
      expect(parseExtractedPromises(junk), junk).toEqual([]);
    }
  });
  it("drops a malformed due date rather than inventing one", () => {
    const out = parseExtractedPromises('{"promises":[{"what":"Fahrplan","due":"next Friday"}]}');
    expect(out).toEqual([{ what: "Fahrplan", due: null }]);
  });
  it("drops entries with no usable 'what'", () => {
    // "" and a 1-char stub are noise; only the real one survives.
    expect(parseExtractedPromises('{"promises":[{"what":"","due":null},{"what":"X","due":null},{"what":"signed contract","due":null}]}'))
      .toEqual([{ what: "signed contract", due: null }]);
  });
});
