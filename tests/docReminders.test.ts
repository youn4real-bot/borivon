import { describe, it, expect } from "vitest";
import { planReminder, outstandingItems, reminderLabel, REMINDER_RULES, type ReminderDoc } from "../lib/docReminders";
import { CHECKLIST_ITEMS } from "../lib/candidateChecklist";
import { FILE_KEY_ALL_LABELS } from "../lib/fileKeys";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 11, 10);
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const label = (key: string) => [...(FILE_KEY_ALL_LABELS[key] ?? new Set([key]))][0];

const doc = (key: string, status: string | null, days: number, extra: Partial<ReminderDoc> = {}): ReminderDoc =>
  ({ id: `${key}-${status}-${days}`, file_type: label(key), status, uploaded_at: ago(days), ...extra });

/** Every default-required paper (+ translation) uploaded and approved. */
function allPapers(days = 30): ReminderDoc[] {
  const out: ReminderDoc[] = [];
  for (const it of CHECKLIST_ITEMS) {
    if (it.optional) continue;
    out.push(doc(it.key, "approved", days));
    if (it.hasTranslation) out.push(doc(`${it.key}_de`, "approved", days));
  }
  return out;
}
const without = (docs: ReminderDoc[], ...keys: string[]) =>
  docs.filter(d => !keys.some(k => FILE_KEY_ALL_LABELS[k]?.has(d.file_type ?? "")));

const base = { sentAts: [] as number[], arrived: false, now: NOW };

describe("planReminder — who gets a reminder", () => {
  it("never writes to someone who has not started", () => {
    expect(planReminder({ ...base, docs: [] })).toMatchObject({ send: false, skip: "not_started" });
  });

  it("never writes to someone who has arrived", () => {
    const docs = [...without(allPapers(), "diploma"), doc("diploma", "rejected", 20)];
    expect(planReminder({ ...base, docs, arrived: true })).toMatchObject({ send: false, skip: "arrived" });
  });

  it("leaves her alone while she is actively uploading", () => {
    const docs = [doc("id", "approved", 1)];
    expect(planReminder({ ...base, docs })).toMatchObject({ send: false, skip: "active" });
  });

  it("sends nothing when everything is in and waiting for OUR review", () => {
    const docs = allPapers().map(d => ({ ...d, status: "pending" }));
    expect(planReminder({ ...base, docs })).toMatchObject({ send: false, skip: "nothing_outstanding" });
  });

  it("reminds a refused document past the grace period", () => {
    const docs = [...without(allPapers(), "diploma"), doc("diploma", "rejected", 10)];
    const p = planReminder({ ...base, docs });
    expect(p.send).toBe(true);
    expect(p.items).toEqual([{ kind: "rejected", key: "diploma" }]);
  });

  it("uses the refusal time, not the upload time, for the grace period", () => {
    const d = doc("diploma", "rejected", 30);
    const docs = [...without(allPapers(), "diploma"), d];
    const rejectedAt = new Map([[d.id!, NOW - 1 * DAY]]); // refused yesterday
    // the newest upload is 30 days old, so she is not "active" — but the grace holds
    expect(planReminder({ ...base, docs, rejectedAt })).toMatchObject({ send: false, skip: "nothing_outstanding" });
  });

  it("ignores a refused copy once a newer one is approved or pending", () => {
    const docs = [...without(allPapers(), "diploma"), doc("diploma", "rejected", 20), doc("diploma", "pending", 5)];
    expect(planReminder({ ...base, docs })).toMatchObject({ send: false, skip: "nothing_outstanding" });
  });

  it("ignores archived documents entirely (LAW #33)", () => {
    const docs = [...allPapers(), doc("diploma", "rejected", 20, { superseded_at: ago(15) })];
    expect(planReminder({ ...base, docs })).toMatchObject({ send: false, skip: "nothing_outstanding" });
  });

  it("never chases optional documents", () => {
    const docs = [...allPapers(), doc("other", "rejected", 20), doc("work_experience", "rejected", 20), doc("praktikum", "rejected", 20)];
    expect(planReminder({ ...base, docs })).toMatchObject({ send: false, skip: "nothing_outstanding" });
  });

  it("lists missing papers only once she has gone quiet for a week", () => {
    const docs = without(allPapers(5), "transcript", "transcript_de");
    expect(planReminder({ ...base, docs })).toMatchObject({ send: false, skip: "nothing_outstanding" });
    const quiet = without(allPapers(REMINDER_RULES.QUIET_DAYS), "transcript", "transcript_de");
    const p = planReminder({ ...base, docs: quiet });
    expect(p.send).toBe(true);
    expect(p.items).toEqual([{ kind: "missing", key: "transcript" }, { kind: "missing", key: "transcript_de" }]);
  });

  it("names a missing German translation on its own", () => {
    const docs = without(allPapers(), "abitur_de");
    expect(planReminder({ ...base, docs }).items).toEqual([{ kind: "missing", key: "abitur_de" }]);
  });

  it("honours an agency's own list of required papers", () => {
    const docs = [doc("id", "approved", 30)];
    const p = planReminder({ ...base, docs, requiredKeys: ["id", "diploma"] });
    expect(p.items).toEqual([{ kind: "missing", key: "diploma" }, { kind: "missing", key: "diploma_de" }]);
  });

  it("puts refused documents before missing ones", () => {
    const docs = [...without(allPapers(), "diploma", "abitur"), doc("diploma", "rejected", 20)];
    expect(planReminder({ ...base, docs }).items).toEqual([{ kind: "rejected", key: "diploma" }, { kind: "missing", key: "abitur" }]);
  });

  it("never asks for a B2 certificate she may not have yet — but does chase a refused one", () => {
    expect(planReminder({ ...base, docs: without(allPapers(), "langcert") }))
      .toMatchObject({ send: false, skip: "nothing_outstanding" });
    const refused = [...without(allPapers(), "langcert"), doc("langcert", "rejected", 20)];
    expect(planReminder({ ...base, docs: refused }).items).toEqual([{ kind: "rejected", key: "langcert" }]);
  });

  it("never asks for the CV or cover letter — those are built in the portal", () => {
    const docs = [...without(allPapers(), "cv_de", "letter"), doc("letter", "rejected", 20)];
    expect(planReminder({ ...base, docs })).toMatchObject({ send: false, skip: "nothing_outstanding" });
  });

  it("treats a legacy '(Archiv)' row as archived", () => {
    const docs = [...allPapers(), { ...doc("diploma", "rejected", 20), file_type: "Diplôme Infirmier (Archiv)" }];
    expect(planReminder({ ...base, docs })).toMatchObject({ send: false, skip: "nothing_outstanding" });
  });
});

describe("planReminder — how often", () => {
  const docs = [...without(allPapers(), "diploma"), doc("diploma", "rejected", 20)];

  it("waits a week between two reminders", () => {
    expect(planReminder({ ...base, docs, sentAts: [NOW - 6 * DAY] })).toMatchObject({ send: false, skip: "too_soon" });
    expect(planReminder({ ...base, docs, sentAts: [NOW - 7 * DAY] }).send).toBe(true);
  });

  it("stops after three in two months", () => {
    const three = [NOW - 8 * DAY, NOW - 20 * DAY, NOW - 40 * DAY];
    expect(planReminder({ ...base, docs, sentAts: three })).toMatchObject({ send: false, skip: "cap" });
    const old = [NOW - 8 * DAY, NOW - 20 * DAY, NOW - 70 * DAY];
    expect(planReminder({ ...base, docs, sentAts: old }).send).toBe(true);
  });
});

describe("outstandingItems / reminderLabel", () => {
  it("reminds a refused slot document under its slot id", () => {
    const slotId = "2b8e1c1e-1111-4222-8333-944455556666";
    const items = outstandingItems(
      [{ id: "x", file_type: slotId, status: "rejected", uploaded_at: ago(10) }],
      { now: NOW, includeMissing: false },
    );
    expect(items).toEqual([{ kind: "rejected", key: slotId }]);
    expect(reminderLabel(slotId, "de", new Map([[slotId, "Untervollmacht"]]))).toBe("Untervollmacht");
  });

  it("names catalog documents in her language", () => {
    const fr = reminderLabel("diploma", "fr");
    const de = reminderLabel("diploma", "de");
    expect(fr).toBeTruthy();
    expect(de).toBeTruthy();
    expect(fr).not.toBe(de);
  });
});
