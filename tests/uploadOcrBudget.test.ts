import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { OCR_MAX_BYTES } from "../lib/ocrBudget";
import { HEIC_CODE } from "../lib/heic";

/**
 * Upload-route behaviours proved through the REAL handler rather than asserted
 * about it.
 *
 *  H. A 25 MB passport scan used to exhaust the 128 MB isolate during OCR
 *     (+125.6 MB over baseline for the Azure call alone — lib/ocrBudget.ts has
 *     the table). The fix caps what we READ, never what we STORE: the big scan
 *     must still reach R2 and the documents row and answer 200, just with no
 *     prefilled fields. If this ever flips to a 413 the fix has become the bug.
 *
 *  I. An iPhone photo picked out of the Files app arrives as image/heic and was
 *     refused as "Type non autorise" — the wrong sentence for the commonest
 *     phone on earth. It must be refused with its own code so the client can
 *     tell her to re-pick from Photos.
 *
 *  J. When the reader comes back with nothing the answer must SAY so. The
 *     Google Vision fallback was removed on 2026-09-20 (its Google project has
 *     billing disabled, so every call it made was refused), which makes "no
 *     prefill" an ordinary outcome rather than a rare one. A bare
 *     `passportData: null` opened a blank eighteen-field form with no reason
 *     on it, and a candidate who thinks the upload broke re-uploads instead of
 *     typing. `ocrSkipped` is what the dashboard reads to tell her otherwise.
 */

const ADMIN = "admin@borivon.test";

vi.mock("@/lib/rateLimit", () => ({ enforceUserRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/scheduleMirror", () => ({ scheduleCandidateMirror: () => {} }));
vi.mock("@/lib/admin-auth", () => ({ canActOnCandidate: async () => true }));

/** Every byte the route stored, so "the big scan is still stored" is a fact. */
const stored: { key: string; bytes: number }[] = [];
vi.mock("@/lib/r2", () => ({
  r2Configured: () => true,
  r2Put: async (key: string, body: Buffer) => { stored.push({ key, bytes: body.length }); },
  candidateKey: (u: string, n: string) => `candidates/${u}/${n}`,
}));

function table() {
  const chain: Record<string, unknown> = {
    select: () => chain, eq: () => chain, is: () => chain, not: () => chain,
    in: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    insert: () => {
      const res = { data: { id: "doc-1" }, error: null };
      return { select: () => ({ single: async () => res, maybeSingle: async () => res }) };
    },
    update: () => chain,
    upsert: async () => ({ data: null, error: null }),
  };
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
  return chain;
}
const fakeDb = {
  from: () => table(),
  auth: {
    admin: { getUserById: async () => ({ data: { user: { email: "cand@x.test", user_metadata: {} } } }) },
    getUser: async () => ({ data: { user: { email: "nurse@x.test", id: "11111111-1111-4111-8111-111111111111" } }, error: null }),
  },
  storage: { from: () => ({ upload: async () => ({ error: null }) }) },
};
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => fakeDb,
  getAnonVerifyClient: () => fakeDb,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeDb }));

let POST: (r: never) => Promise<Response>;
beforeAll(async () => {
  process.env.ADMIN_EMAIL = ADMIN;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub";
  // No OCR provider configured: Azure returns null immediately, so nothing
  // reaches the network. What is under test here is whether the route DECIDES
  // to OCR, and whether the upload survives either way.
  delete process.env.AZURE_DOC_INTEL_ENDPOINT;
  delete process.env.AZURE_DOC_INTEL_KEY;
  ({ POST } = await import("@/app/api/portal/upload/route"));
});
beforeEach(() => { stored.length = 0; });

async function post(file: File, fileKey: string, fileType: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("fileKey", fileKey);
  fd.append("fileType", fileType);
  const res = await POST(new Request("https://www.borivon.com/api/portal/upload", {
    method: "POST", headers: { authorization: "Bearer stub-jwt" }, body: fd,
  }) as never);
  let body: Record<string, unknown> = {};
  try { body = await res.clone().json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

/** A real, single-page PDF padded to `bytes` so the page cap cannot fire. */
async function pdfOf(bytes: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  const base = await d.save();
  if (bytes <= base.length) return base;
  // Pad AFTER %%EOF — readers stop there, so the file stays a valid 1-page PDF
  // while weighing what a real scan weighs.
  const out = new Uint8Array(bytes);
  out.set(base, 0);
  out.fill(0x20, base.length);
  return out;
}

describe("H — a scan too big to OCR is still STORED", () => {
  it("a 25 MB passport answers 200 and reaches R2, with the prefill skipped", async () => {
    const big = await pdfOf(25 * 1024 * 1024 - 1024);
    const r = await post(new File([big as unknown as BlobPart], "reisepass.pdf", { type: "application/pdf" }), "id", "Reisepass");

    // The upload itself is the thing that must not break.
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(stored).toHaveLength(1);
    expect(stored[0].bytes).toBe(big.length);

    // And it says WHY there is no prefilled data, so the dashboard can tell her
    // to type it in rather than showing an unexplained empty form.
    expect(r.body.passportData).toBeNull();
    expect(r.body.ocrSkipped).toBe("too_large");
    expect(r.body.ocrMaxBytes).toBe(OCR_MAX_BYTES);
  });

  it("a normal phone-sized passport is NOT skipped for SIZE — the cap must not eat the feature", async () => {
    const small = await pdfOf(2 * 1024 * 1024);
    const r = await post(new File([small as unknown as BlobPart], "reisepass.pdf", { type: "application/pdf" }), "id", "Reisepass");
    expect(r.status).toBe(200);
    // It tried. No provider is configured in this run, so it came back with
    // nothing — but never because of the size cap.
    expect(r.body.ocrSkipped).not.toBe("too_large");
    expect(stored).toHaveLength(1);
  });

  it("a big NON-passport upload is unaffected — the cap is an OCR cap, not a size cap", async () => {
    const big = await pdfOf(20 * 1024 * 1024);
    const r = await post(new File([big as unknown as BlobPart], "diplom.pdf", { type: "application/pdf" }), "diploma", "Diplom");
    expect(r.status).toBe(200);
    expect(stored).toHaveLength(1);
    expect(stored[0].bytes).toBe(big.length);
  });
});

describe("J — nothing read means nothing read, and it says so", () => {
  it("answers ocrSkipped:'unreadable' instead of an unexplained empty form", async () => {
    const small = await pdfOf(1024 * 512);
    const r = await post(new File([small as unknown as BlobPart], "reisepass.pdf", { type: "application/pdf" }), "id", "Reisepass");

    // The upload still succeeded and the file is still stored — that is the
    // invariant the whole OCR block hangs off.
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(stored).toHaveLength(1);

    // And the reason travels to the client, so it can say "please type it in".
    expect(r.body.passportData).toBeNull();
    expect(r.body.ocrSkipped).toBe("unreadable");
  });

  it("a non-passport upload gets no OCR verdict at all", async () => {
    const small = await pdfOf(1024 * 512);
    const r = await post(new File([small as unknown as BlobPart], "diplom.pdf", { type: "application/pdf" }), "diploma", "Diplom");
    expect(r.status).toBe(200);
    expect(r.body.ocrSkipped).toBeUndefined();
  });
});

describe("I — an iPhone HEIC photo gets its own answer, not 'PDF only'", () => {
  /** ISO-BMFF header an iPhone writes: [len]["ftyp"]["heic"][minor]["mif1"] */
  function heicBytes(): Uint8Array {
    const out = new Uint8Array(4096);
    out.set([0, 0, 0, 0x18], 0);
    out.set([...Buffer.from("ftypheic")], 4);
    out.set([0, 0, 0, 0, ...Buffer.from("mif1")], 12); // minor version, then a compatible brand
    return out;
  }

  it("refuses image/heic with HEIC_UNSUPPORTED, not the generic type error", async () => {
    const r = await post(new File([heicBytes() as unknown as BlobPart], "IMG_4821.HEIC", { type: "image/heic" }), "id", "Reisepass");
    expect(r.status).toBe(415);
    expect(r.body.code).toBe(HEIC_CODE);
    expect(String(r.body.error)).toMatch(/HEIC/i);
    expect(String(r.body.error)).not.toMatch(/PDF/i);
    expect(stored).toHaveLength(0); // nothing undecodable gets filed as a passport
  });

  it("catches a Files-app pick with no usable mime type, by its name", async () => {
    const r = await post(new File([heicBytes() as unknown as BlobPart], "IMG_4821.HEIC", { type: "application/octet-stream" }), "id", "Reisepass");
    expect(r.status).toBe(415);
    expect(r.body.code).toBe(HEIC_CODE);
  });

  it("catches HEIC bytes mislabelled as a JPEG — the case a mime-only gate misses", async () => {
    const r = await post(new File([heicBytes() as unknown as BlobPart], "passport.jpg", { type: "image/jpeg" }), "id", "Reisepass");
    expect(r.status).toBe(415);
    expect(r.body.code).toBe(HEIC_CODE);
  });

  it("applies to every box, not just the passport", async () => {
    const r = await post(new File([heicBytes() as unknown as BlobPart], "diplome.heic", { type: "image/heic" }), "diploma", "Diplom");
    expect(r.status).toBe(415);
    expect(r.body.code).toBe(HEIC_CODE);
  });

  it("a real JPEG still uploads — the HEIC gate must not close the photo path", async () => {
    const jpeg = new Uint8Array(2048);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    const r = await post(new File([jpeg as unknown as BlobPart], "passport.jpg", { type: "image/jpeg" }), "id", "Reisepass");
    expect(r.status).toBe(200);
    expect(stored).toHaveLength(1);
  });
});
