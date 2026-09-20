import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { savePassportDraft } from "../lib/passportDraft";
import {
  classifyProfileRead,
  hasAnyPassportValue,
  planPassportWrite,
  PASSPORT_DRAFT_FIELDS,
} from "../lib/passportDraftGuard";

/**
 * BUG 1 — A BLANK FORM OVERWROTE 62 PASSPORTS.
 *
 * A nurse taps her passport box. The dashboard reads her profile, the read
 * fails, and `const { data } = await getMyProfile(...)` throws the error away —
 * so `data` is null, which reads exactly like "she has no row yet". The form
 * opens with eighteen empty inputs. 800 ms later the draft autosave POSTs that
 * emptiness, the route upserts it verbatim, and her name, passport number,
 * issue and expiry dates are nulled and every LAW #38 confirmation tick is
 * cleared — while `passport_status` stays "approved", because a draft
 * deliberately preserves the review status. Nothing anywhere flags it.
 *
 * Three independent things had to be true for that to happen, so three
 * independent guards are pinned here:
 *   1. the read's error was discarded        → classifyProfileRead
 *   2. an all-blank payload was written      → planPassportWrite + the route
 *   3. absent ticks were coerced to []       → planPassportWrite + the route
 * plus the client-side seed gate, asserted against the dashboard source
 * because it is a ref read inside a React effect in a 5,900-line client
 * component that this Node-environment suite cannot mount.
 */

// ── The pure rules ──────────────────────────────────────────────────────────

describe("classifyProfileRead: a failed read is not an empty one", () => {
  it("an error is 'failed', whatever data says", () => {
    expect(classifyProfileRead({ data: null, error: "network" })).toBe("failed");
    expect(classifyProfileRead({ data: { first_name: "X" }, error: "boom" })).toBe("failed");
  });

  it("no result object at all is 'failed', not 'absent'", () => {
    expect(classifyProfileRead(null)).toBe("failed");
    expect(classifyProfileRead(undefined)).toBe("failed");
  });

  it("a clean read with no row is 'absent' — a brand-new candidate", () => {
    expect(classifyProfileRead({ data: null, error: null })).toBe("absent");
    expect(classifyProfileRead({ data: undefined, error: null })).toBe("absent");
  });

  it("a clean read with a row is 'loaded'", () => {
    expect(classifyProfileRead({ data: { first_name: "SALMA" }, error: null })).toBe("loaded");
    // An existing row whose columns happen to be empty is still 'loaded' —
    // that is a real answer about the database, not a failure.
    expect(classifyProfileRead({ data: {}, error: null })).toBe("loaded");
  });
});

describe("hasAnyPassportValue", () => {
  it("whitespace is not a value — otherwise a space defeats the guard", () => {
    expect(hasAnyPassportValue({ first_name: "   ", last_name: "" })).toBe(false);
    expect(hasAnyPassportValue({ first_name: "S" })).toBe(true);
  });
  it("null, undefined and an empty bag hold nothing", () => {
    expect(hasAnyPassportValue(null)).toBe(false);
    expect(hasAnyPassportValue(undefined)).toBe(false);
    expect(hasAnyPassportValue({})).toBe(false);
  });
  it("covers every column the form owns", () => {
    for (const k of PASSPORT_DRAFT_FIELDS) {
      expect(hasAnyPassportValue({ [k]: "x" })).toBe(true);
    }
  });
});

describe("planPassportWrite", () => {
  const STORED = { first_name: "SALMA", passport_no: "AB1234567", dob: "1994-03-02" };
  const BLANK = Object.fromEntries(PASSPORT_DRAFT_FIELDS.map((k) => [k, null]));

  it("an all-blank payload may not overwrite a row that holds data", () => {
    const p = planPassportWrite({ incoming: BLANK, stored: STORED, confirmedSupplied: true });
    expect(p.writeFields).toBe(false);
    expect(p.writeConfirmed).toBe(false);
    expect(p.skipped).toBe("blank_over_stored");
  });

  it("clearing ONE field among filled ones is a real edit and goes through", () => {
    const p = planPassportWrite({
      incoming: { ...BLANK, first_name: "SALMA", passport_no: null },
      stored: STORED,
      confirmedSupplied: true,
    });
    expect(p.writeFields).toBe(true);
    expect(p.skipped).toBeNull();
  });

  it("a blank payload over a blank row is fine — nothing to lose", () => {
    expect(planPassportWrite({ incoming: BLANK, stored: null, confirmedSupplied: true }).writeFields).toBe(true);
    expect(planPassportWrite({ incoming: BLANK, stored: {}, confirmedSupplied: true }).writeFields).toBe(true);
  });

  it("LAW #38: ticks are only rewritten when the body actually carried the list", () => {
    expect(planPassportWrite({ incoming: STORED, stored: STORED, confirmedSupplied: false }).writeConfirmed).toBe(false);
    expect(planPassportWrite({ incoming: STORED, stored: STORED, confirmedSupplied: true }).writeConfirmed).toBe(true);
  });
});

// ── The route, driven for real ──────────────────────────────────────────────

const CAND = "22222222-2222-4222-8222-222222222222";

/** What the profile read answers, and what the upsert received. */
let storedRow: Record<string, unknown> | null = null;
let readError: { message: string } | null = null;
let upserts: Record<string, unknown>[] = [];
let upsertError: { message: string } | null = null;

function table(name: string) {
  const chain: Record<string, unknown> = {
    select: () => chain, eq: () => chain, ilike: () => chain, is: () => chain,
    order: () => chain, limit: () => chain,
    maybeSingle: async () => (readError ? { data: null, error: readError } : { data: storedRow, error: null }),
    upsert: async (row: Record<string, unknown>) => {
      if (name === "candidate_profiles") upserts.push(row);
      return { error: upsertError };
    },
    insert: async () => ({ error: null }),
  };
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
  return chain;
}

const fakeDb = {
  from: (n: string) => table(n),
  auth: {
    getUser: async () => ({ data: { user: { id: CAND, email: "n@x.test", user_metadata: {} } }, error: null }),
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
  storedRow = null; readError = null; upserts = []; upsertError = null;
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

/** The row as it stands for an APPROVED passport — the 62-profile shape. */
const APPROVED = {
  first_name: "SALMA", last_name: "BENALI", dob: "1994-03-02", sex: "F",
  nationality: "marokkanisch", passport_no: "AB1234567", passport_expiry: "2031-05-09",
  issuing_authority: "Rabat", issue_date: "2021-05-10",
  city_of_birth: "Fes", country_of_birth: "Marokko",
  address_street: null, address_number: null, address_postal: null,
  city_of_residence: null, country_of_residence: null,
  marital_status: null, children_ages: null,
  passport_status: "approved",
};

/** Exactly what the dashboard sent when the form opened blank. */
const BLANK_DRAFT = {
  __draft: true, confirmed_fields: [],
  ...Object.fromEntries(PASSPORT_DRAFT_FIELDS.map((k) => [k, ""])),
};

describe("POST /api/portal/passport", () => {
  it("THE WIPE: a blank draft never reaches an approved passport", async () => {
    storedRow = { ...APPROVED };
    const r = await post(BLANK_DRAFT);
    expect(r.status).toBe(200);
    expect(r.body.skipped).toBe("blank_over_stored");
    // Nothing was written at all — not the fields, not the ticks.
    expect(upserts).toHaveLength(0);
  });

  it("a real edit still saves, and still clears one field on purpose", async () => {
    storedRow = { ...APPROVED };
    const r = await post({
      ...BLANK_DRAFT,
      first_name: "SALMA", last_name: "BENALI", passport_no: "",
      confirmed_fields: ["first_name"],
    });
    expect(r.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].first_name).toBe("SALMA");
    expect(upserts[0].passport_no).toBeNull();
    expect(upserts[0].passport_confirmed_fields).toEqual(["first_name"]);
  });

  it("LAW #38: a body with no confirmed_fields leaves the ticks alone", async () => {
    storedRow = { ...APPROVED };
    const r = await post({ __draft: true, first_name: "SALMA", last_name: "BENALI" });
    expect(r.status).toBe(200);
    expect(upserts).toHaveLength(1);
    // Absent must mean "not talking about the ticks", never "clear them".
    expect("passport_confirmed_fields" in upserts[0]).toBe(false);
  });

  it("LAW #38: a malformed confirmed_fields leaves the ticks alone too", async () => {
    storedRow = { ...APPROVED };
    await post({ __draft: true, first_name: "SALMA", confirmed_fields: "first_name" });
    expect(upserts).toHaveLength(1);
    expect("passport_confirmed_fields" in upserts[0]).toBe(false);
  });

  it("SHAPE A: a failed profile read refuses the write instead of guessing", async () => {
    storedRow = { ...APPROVED };
    readError = { message: "connection terminated" };
    const r = await post({ __draft: true, first_name: "SALMA" });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("read_failed");
    // "I could not check" must never be spent as "there is nothing there".
    expect(upserts).toHaveLength(0);
  });

  it("a brand-new candidate's first draft still saves", async () => {
    storedRow = null;
    const r = await post({ __draft: true, first_name: "SALMA", confirmed_fields: [] });
    expect(r.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].first_name).toBe("SALMA");
    expect(upserts[0].passport_confirmed_fields).toEqual([]);
  });

  it("an explicit blank Submit is refused, not silently accepted", async () => {
    storedRow = { ...APPROVED };
    const r = await post({ ...BLANK_DRAFT, __draft: false });
    expect(r.status).toBe(409);
    expect(upserts).toHaveLength(0);
  });

  it("the candidate never sees raw Postgres prose (LAW #19)", async () => {
    storedRow = { ...APPROVED };
    upsertError = { message: 'null value in column "passport_no" violates not-null constraint' };
    const r = await post({ __draft: true, first_name: "SALMA" });
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("save_failed");
    expect(String(r.body.error)).not.toMatch(/constraint|column/i);
  });
});

// ── A missing local tick key is not an empty tick set ───────────────────────

describe("savePassportDraft omits the ticks it does not know about", () => {
  /** A fetch that records the body it was handed. */
  function spy() {
    const bodies: Record<string, unknown>[] = [];
    const impl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    return { impl, bodies };
  }

  it("no confirmed list at all leaves confirmed_fields out of the body", async () => {
    const f = spy();
    await savePassportDraft({ fetchImpl: f.impl, token: "jwt", data: { first_name: "SALMA" } });
    // LAW #38: the bootstrap restore used to send [] here when the
    // bv-passport-confirmed-<id> key was missing, un-ticking every box.
    expect("confirmed_fields" in f.bodies[0]).toBe(false);
  });

  it("an explicit null leaves it out too", async () => {
    const f = spy();
    await savePassportDraft({ fetchImpl: f.impl, token: "jwt", data: { first_name: "S" }, confirmed: null });
    expect("confirmed_fields" in f.bodies[0]).toBe(false);
  });

  it("an explicit [] is a human un-ticking everything and IS sent", async () => {
    const f = spy();
    await savePassportDraft({ fetchImpl: f.impl, token: "jwt", data: { first_name: "S" }, confirmed: [] });
    expect(f.bodies[0].confirmed_fields).toEqual([]);
  });
});

// ── The client-side seed gate ───────────────────────────────────────────────

/** Source with comments blanked, offsets preserved: every fix here is
 *  commented with the broken line it replaces, so raw text would match the
 *  explanation instead of the code. Same approach as adminPanelHonesty. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\r\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

const DASH = code("app/portal/dashboard/page.tsx");
const ROUTE = code("app/api/portal/passport/route.ts");

describe("the dashboard cannot autosave a form it never loaded", () => {
  it("the profile read is classified, not destructured into a blank form", () => {
    expect(DASH).toContain("classifyProfileRead");
    // The exact line that started the wipe must not come back.
    expect(DASH).not.toMatch(/const\s*\{\s*data\s*\}\s*=\s*await\s+getMyProfile\(\s*\r?\n?\s*"first_name/);
  });

  it("the autosave effect is gated on a form that was actually seeded", () => {
    expect(DASH).toMatch(/if\s*\(!passportFormSeededRef\.current\)\s*return;/);
    // The gate has to sit INSIDE the open-modal branch, above the localStorage
    // write and the debounced POST — after them it would guard nothing.
    const gate = DASH.indexOf("if (!passportFormSeededRef.current) return;");
    const localWrite = DASH.indexOf("writeLocalDraft(localStorage");
    const debounced = DASH.indexOf("passportDraftTimer.current = setTimeout");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(localWrite);
    expect(gate).toBeLessThan(debounced);
  });

  it("a missing local tick key is carried as null, never as []", () => {
    // Two readers of bv-passport-confirmed-<id>: the bootstrap restore and the
    // retry button. Both must start from null so an absent key says nothing
    // about the ticks instead of clearing them.
    expect(DASH).toMatch(/let\s+confArr:\s*string\[\]\s*\|\s*null\s*=\s*null;/);
    expect(DASH).toMatch(/let\s+confirmed:\s*string\[\]\s*\|\s*null\s*=\s*null;/);
    expect(DASH).toMatch(/confirmed:\s*string\[\]\s*\|\s*null\s*=\s*null\)\s*=>/);
  });

  it("every seed that sets the form also claims it, and closing releases it", () => {
    // Three trusted seeds: a successful read, a fresh OCR extraction, the
    // local draft restored at bootstrap. Plus the reset when the form closes.
    const claims = DASH.match(/passportFormSeededRef\.current\s*=\s*true/g) ?? [];
    expect(claims.length).toBe(3);
    expect(DASH).toMatch(/passportFormSeededRef\.current\s*=\s*false/);
  });

  it("an unknown passport_status is not rendered as 'not submitted'", () => {
    // SHAPE A on the bootstrap read: its error was destructured away, so a
    // failed read set passportStatus to null — the same value as "she never
    // submitted". An approved passport lost its colour (LAW #4) and the
    // auto-open effect offered an editable Submit form over approved data.
    expect(DASH).toContain("passportStatusKnown");
    expect(DASH).toMatch(/const\s+readOk\s*=\s*classifyProfileRead\(read\)\s*!==\s*"failed";/);
    expect(DASH).toMatch(/if\s*\(!readOk\)\s*\{[^}]*return;\s*\}/);
    // The auto-open guard reads it, before it opens anything.
    const guard = DASH.indexOf("if (!passportStatusKnown) return;");
    const open = DASH.indexOf("reopenPassportData();", guard);
    expect(guard).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(guard);
  });

  it("the retry redoes the read that actually failed", () => {
    // A failed STATUS read must not pop the eighteen-field form open on a
    // candidate who tapped "try again", not her passport box.
    expect(DASH).toMatch(/if\s*\(passportLoadFailed === "status"\)\s*await refreshPassportStatus\(\);/);
    expect(DASH).toMatch(/else await reopenPassportData\(\);/);
  });

  it("a failed load says so in all three languages (LAW #19)", () => {
    expect(DASH).toContain("passportLoadFailed");
    expect(DASH).toContain("Ihre Passdaten konnten nicht geladen werden");
    expect(DASH).toContain("n’ont pas pu être chargées");
    expect(DASH).toContain("could not be loaded");
  });
});

describe("a form that opens empty says WHY it is empty", () => {
  /**
   * The Google Cloud Vision fallback was removed on 2026-09-20 (billing is
   * disabled on that Google project, so every call it made came back refused).
   * "The reader found nothing" is therefore an ordinary outcome now, not a
   * rare one, and it lands as the same blank eighteen-field form that BUG 1
   * above was about. The difference has to be visible to her: a blank form
   * with no explanation reads as a broken upload, and a candidate who thinks
   * the upload broke re-uploads instead of typing.
   *
   * LAW #38 is untouched either way — she ticks every confirmation box by
   * hand, so the only thing a missing prefill costs her is the typing.
   */
  it("the server's reason is read off the upload response, not guessed", () => {
    expect(DASH).toContain("passportOcrSkipped");
    expect(DASH).toMatch(/json\.ocrSkipped === "too_large"/);
  });

  it("a re-upload over existing data never shows the apology", () => {
    // hadData means her fields are already filled in; there is nothing to
    // explain, and saying "we could not read it" over good data is a lie.
    const branch = DASH.indexOf("if (json.hadData)");
    expect(branch).toBeGreaterThan(0);
    // The window is generous because `code()` blanks comments in place, so
    // the explanation above the call survives as whitespace.
    expect(DASH.slice(branch, branch + 900)).toContain("setPassportOcrSkipped(null)");
  });

  it("it says so in all three languages (LAW #19)", () => {
    expect(DASH).toContain("Wir konnten ihn nicht automatisch lesen");
    expect(DASH).toContain("Nous n'avons pas pu le lire automatiquement");
    expect(DASH).toContain("We couldn't read it automatically");
    // And the over-the-cap case has its own sentence, in all three too.
    expect(DASH).toContain("Die Datei ist zu groß, um sie automatisch zu lesen");
    expect(DASH).toContain("Le fichier est trop volumineux pour une lecture automatique");
    expect(DASH).toContain("The file is too large to read automatically");
  });
});

describe("the route's own guards are wired, not merely available", () => {
  it("the existing-row read's error is checked before anything is written", () => {
    const check = ROUTE.indexOf("if (readErr)");
    const plan = ROUTE.indexOf("planPassportWrite({");
    const upsert = ROUTE.indexOf('from("candidate_profiles").upsert');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(plan);
    expect(plan).toBeLessThan(upsert);
  });
  it("confirmed_fields presence is a decision, not a coercion", () => {
    expect(ROUTE).toMatch(/const\s+confirmedSupplied\s*=\s*Array\.isArray\(body\.confirmed_fields\)/);
    expect(ROUTE).toMatch(/if\s*\(!plan\.writeConfirmed\)\s*delete\s+upsertRow\.passport_confirmed_fields;/);
  });
});
