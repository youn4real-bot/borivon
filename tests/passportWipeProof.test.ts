/**
 * INDEPENDENT PROOF of the two halves of the passport-wipe blocker.
 *
 * tests/passportDraftGuard.test.ts already covers this ground from the fixing
 * branch's own point of view. This file is a deliberate second opinion,
 * written against the MERGED tree with its own harness, because the bug it
 * guards can destroy a candidate's stored identity data in either direction
 * and one branch grading its own homework is not proof.
 *
 * It asserts exactly two invariants, end to end, through the REAL route:
 *
 *   (A) A failed or unfinished profile read can NEVER cause a save to write
 *       over stored passport fields. "I could not check" is not "it is empty".
 *
 *   (B) A nurse can still legitimately clear a field she mistyped, and that
 *       save must go through. A guard that also blocks (B) is not a fix, it
 *       is a second bug wearing the first one's coat.
 *
 * The server is the boundary worth proving: it is the backstop that still
 * holds when a candidate's phone runs a stale bundle whose client-side gate
 * predates the fix. Every assertion below is on what actually reached the
 * database, never on the shape of the source.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { PASSPORT_DRAFT_FIELDS } from "@/lib/passportDraftGuard";

const CAND = "33333333-3333-4333-8333-333333333333";

let storedRow: Record<string, unknown> | null = null;
let readError: { message: string } | null = null;
let upserts: Record<string, unknown>[] = [];

function table(name: string) {
  const chain: Record<string, unknown> = {
    select: () => chain, eq: () => chain, ilike: () => chain, is: () => chain,
    order: () => chain, limit: () => chain,
    maybeSingle: async () =>
      readError ? { data: null, error: readError } : { data: storedRow, error: null },
    upsert: async (row: Record<string, unknown>) => {
      if (name === "candidate_profiles") upserts.push(row);
      return { error: null };
    },
    insert: async () => ({ error: null }),
  };
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
  return chain;
}

const fakeDb = {
  from: (n: string) => table(n),
  auth: {
    getUser: async () => ({
      data: { user: { id: CAND, email: "proof@x.test", user_metadata: {} } },
      error: null,
    }),
  },
};

vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => fakeDb,
  getAnonVerifyClient: () => fakeDb,
}));
vi.mock("@/lib/rateLimit", () => ({ enforceRateLimit: () => ({ ok: true }) }));
vi.mock("@/lib/passport-pdf", () => ({ uploadPassportPdfToDrive: async () => undefined }));
vi.mock("@/lib/keepAlive", () => ({ keepAlive: () => undefined }));

let POST: (r: never) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = await import("@/app/api/portal/passport/route"));
});
beforeEach(() => {
  storedRow = null;
  readError = null;
  upserts = [];
});

async function post(body: Record<string, unknown>) {
  const req = {
    headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? "Bearer stub-jwt" : null) },
    json: async () => body,
    url: "https://www.borivon.com/api/portal/passport",
  };
  const res = await POST(req as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** A filled, ADMIN-APPROVED row: the shape the wipe actually destroyed. */
const FILLED_APPROVED = {
  first_name: "AMINA", last_name: "TAZI", dob: "1992-07-14", sex: "F",
  nationality: "marokkanisch", passport_no: "XY7654321", passport_expiry: "2030-01-20",
  issuing_authority: "Casablanca", issue_date: "2020-01-21",
  city_of_birth: "Oujda", country_of_birth: "Marokko",
  address_street: "Rue Test", address_number: "4", address_postal: "20000",
  city_of_residence: "Casablanca", country_of_residence: "Marokko",
  marital_status: "ledig", children_ages: null,
  passport_status: "approved",
  passport_confirmed_fields: ["first_name", "last_name", "passport_no"],
};

/** The eighteen-empty-input autosave a never-loaded form fires 800ms in. */
const blankDraft = (extra: Record<string, unknown> = {}) => ({
  __draft: true,
  ...Object.fromEntries(PASSPORT_DRAFT_FIELDS.map((k) => [k, ""])),
  ...extra,
});

// ---------------------------------------------------------------------------
// (A) A failed or unfinished read can never write over stored fields.
// ---------------------------------------------------------------------------
describe("(A) a read we could not complete never overwrites stored passport data", () => {
  it("a FAILED profile read refuses the write outright, writing nothing at all", async () => {
    // The read is the only thing in the request that knows what is stored.
    // When it errors we know nothing, so the only safe answer is to refuse.
    readError = { message: "connection terminated unexpectedly" };
    const r = await post(blankDraft({ confirmed_fields: [] }));
    expect(r.status).toBe(503);
    expect(upserts, "a failed read must not produce a write").toHaveLength(0);
  });

  it("a failed read refuses even a payload that LOOKS like a real edit", async () => {
    // Not just the blank case: if we cannot read the row we cannot tell
    // whether this payload is an edit or a half-seeded form, so nothing goes.
    readError = { message: "57014 statement timeout" };
    const r = await post(blankDraft({ first_name: "AMINA", confirmed_fields: ["first_name"] }));
    expect(r.status).toBe(503);
    expect(upserts).toHaveLength(0);
  });

  it("THE WIPE: an all-blank autosave never reaches a filled, approved row", async () => {
    storedRow = { ...FILLED_APPROVED };
    const r = await post(blankDraft({ confirmed_fields: [] }));
    // The client is told the draft is handled (her stored data IS intact and
    // the blank local copy held nothing worth keeping) but NOTHING is written.
    expect(r.status).toBe(200);
    expect(r.body.skipped).toBe("blank_over_stored");
    expect(upserts, "the 62-profile wipe must write nothing").toHaveLength(0);
  });

  it("and therefore cannot clear a single stored field or a single LAW #38 tick", async () => {
    storedRow = { ...FILLED_APPROVED };
    await post(blankDraft({ confirmed_fields: [] }));
    // Nothing was written, so by construction every field and every human tick
    // still stands, and passport_status was never touched either.
    expect(upserts).toHaveLength(0);
    expect(storedRow.passport_no).toBe("XY7654321");
    expect(storedRow.passport_confirmed_fields).toEqual(["first_name", "last_name", "passport_no"]);
    expect(storedRow.passport_status).toBe("approved");
  });

  it("whitespace is not data: a form autofilled with spaces is still blank", async () => {
    storedRow = { ...FILLED_APPROVED };
    const r = await post(blankDraft({
      ...Object.fromEntries(PASSPORT_DRAFT_FIELDS.map((k) => [k, "   "])),
      confirmed_fields: [],
    }));
    expect(r.body.skipped).toBe("blank_over_stored");
    expect(upserts).toHaveLength(0);
  });

  it("LAW #38: a body that never carried the tick list never rewrites the ticks", async () => {
    // This is the half that un-ticked confirmations while the fields survived.
    // The write itself is legitimate here, so it proceeds - but the tick
    // column must be left exactly as the human left it.
    storedRow = { ...FILLED_APPROVED };
    const r = await post({ __draft: true, ...FILLED_APPROVED });
    expect(r.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(
      "passport_confirmed_fields" in upserts[0],
      "an absent confirmed_fields must not be coerced to [] and written",
    ).toBe(false);
  });

  it("a malformed tick list is 'not talking about the ticks', not 'clear them'", async () => {
    storedRow = { ...FILLED_APPROVED };
    await post({ __draft: true, ...FILLED_APPROVED, confirmed_fields: "first_name" });
    expect(upserts).toHaveLength(1);
    expect("passport_confirmed_fields" in upserts[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (B) A real correction still saves. The guard must not cost her the edit.
// ---------------------------------------------------------------------------
describe("(B) a nurse can still clear a field she mistyped", () => {
  it("clearing ONE mistyped field among filled ones saves, and lands as null", async () => {
    storedRow = { ...FILLED_APPROVED };
    const r = await post({
      __draft: true,
      ...FILLED_APPROVED,
      passport_no: "", // she mistyped it and cleared the box
      confirmed_fields: ["first_name", "last_name"],
    });
    expect(r.status).toBe(200);
    expect(r.body.skipped ?? null).toBeNull();
    expect(upserts, "a real correction MUST be written").toHaveLength(1);
    expect(upserts[0].passport_no, "the cleared field must actually clear").toBeNull();
    // ...and the rest of her data rides along untouched.
    expect(upserts[0].first_name).toBe("AMINA");
    expect(upserts[0].last_name).toBe("TAZI");
  });

  it("clearing several fields at once still saves", async () => {
    storedRow = { ...FILLED_APPROVED };
    const r = await post({
      __draft: true,
      ...FILLED_APPROVED,
      address_street: "", address_number: "", address_postal: "",
      confirmed_fields: ["first_name"],
    });
    expect(r.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].address_street).toBeNull();
    expect(upserts[0].address_postal).toBeNull();
  });

  it("seventeen of eighteen cleared is still an edit, not a wipe", async () => {
    // The line is drawn at eighteen-of-eighteen precisely so that an
    // aggressive but genuine correction is never mistaken for a dead form.
    storedRow = { ...FILLED_APPROVED };
    const r = await post(blankDraft({ first_name: "AMINA", confirmed_fields: ["first_name"] }));
    expect(r.status).toBe(200);
    expect(upserts, "17 blank + 1 filled is a real edit").toHaveLength(1);
    expect(upserts[0].first_name).toBe("AMINA");
    expect(upserts[0].passport_no).toBeNull();
  });

  it("a human un-ticking every box IS obeyed when she actually sent []", async () => {
    // The mirror of the LAW #38 case above: an explicit empty array is a human
    // clearing her confirmations, and must be written.
    storedRow = { ...FILLED_APPROVED };
    await post({ __draft: true, ...FILLED_APPROVED, confirmed_fields: [] });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].passport_confirmed_fields).toEqual([]);
  });

  it("a brand-new candidate's first draft saves: 'absent' is not 'failed'", async () => {
    storedRow = null; // genuinely no row yet, and the read SUCCEEDED
    const r = await post({ __draft: true, first_name: "NEW", confirmed_fields: [] });
    expect(r.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].first_name).toBe("NEW");
  });

  it("even a blank draft saves when there is genuinely nothing to lose", async () => {
    storedRow = null;
    const r = await post(blankDraft({ confirmed_fields: [] }));
    expect(r.status).toBe(200);
    expect(upserts).toHaveLength(1);
  });
});
