/**
 * Possible duplicate candidate accounts.
 *
 * Lamia Addi had two accounts on the same passport for months — both in the
 * list, both counted as placement-ready — and nobody noticed, because nothing
 * compared accounts with each other. People who never got a confirmation code,
 * or forgot which address they used, simply register again.
 *
 * Three signals, each strong on its own in a pool this size:
 *   • same passport number (normalised: case, spaces, dashes)
 *   • same dialable phone number (same normalisation as the WhatsApp buttons)
 *   • same full name (accents, case and word order ignored; 2+ words)
 *
 * It only FLAGS. Deciding which account to keep stays a human call (the rule is:
 * keep the one that was active last and has the most activity).
 */
import { waNumber } from "@/lib/whatsapp";

export type DupReason = "passport" | "phone" | "name";
export type DupRow = {
  userId: string;
  name?: string | null;
  passportNo?: string | null;
  phone?: string | null;
};
export type DupMatch = { otherId: string; reasons: DupReason[] };

/** Combining accent marks left behind by NFD normalisation (é → e + U+0301). */
const ACCENTS = /[̀-ͯ]/g;

export function normPassport(p: string | null | undefined): string {
  const v = (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v.length >= 6 ? v : "";
}

export function normName(n: string | null | undefined): string {
  const s = (n ?? "").trim();
  if (!s || s.includes("@")) return ""; // an email standing in for a name is not a name
  const toks = s
    .normalize("NFD").replace(ACCENTS, "")
    .toLowerCase().replace(/[^a-z\s'-]/g, " ")
    .split(/[\s'-]+/).filter((t) => t.length > 1);
  return toks.length >= 2 ? [...toks].sort().join(" ") : "";
}

/** userId → every other account it collides with, and why. */
export function findDuplicateAccounts(rows: DupRow[]): Record<string, DupMatch[]> {
  const buckets = new Map<string, { reason: DupReason; ids: Set<string> }>();
  const add = (reason: DupReason, value: string, id: string) => {
    if (!value) return;
    const k = `${reason}:${value}`;
    const b = buckets.get(k) ?? buckets.set(k, { reason, ids: new Set() }).get(k)!;
    b.ids.add(id);
  };
  for (const r of rows) {
    add("passport", normPassport(r.passportNo), r.userId);
    add("phone", waNumber(r.phone), r.userId);
    add("name", normName(r.name), r.userId);
  }

  const pairs = new Map<string, Map<string, Set<DupReason>>>();
  for (const { reason, ids } of buckets.values()) {
    if (ids.size < 2) continue;
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      const m = pairs.get(a) ?? pairs.set(a, new Map()).get(a)!;
      (m.get(b) ?? m.set(b, new Set()).get(b)!).add(reason);
    }
  }

  const ORDER: DupReason[] = ["passport", "phone", "name"];
  const out: Record<string, DupMatch[]> = {};
  for (const [id, others] of pairs) {
    out[id] = [...others.entries()]
      .map(([otherId, rs]) => ({ otherId, reasons: ORDER.filter((r) => rs.has(r)) }))
      // strongest evidence first: more signals, then passport over phone over name
      .sort((x, y) => y.reasons.length - x.reasons.length || ORDER.indexOf(x.reasons[0]) - ORDER.indexOf(y.reasons[0]));
  }
  return out;
}
