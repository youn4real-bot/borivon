import { describe, it, expect, vi, beforeAll } from "vitest";
import { PDFDocument } from "pdf-lib";

/**
 * The per-box PDF page cap, driven through the REAL upload route.
 *
 * Reported 2026-09-19 by the founder as "I try to upload any document and it's
 * not working". Production (Cloudflare Observability) showed two
 * POST /api/portal/upload answering 413 with a content-length of 1,782,875
 * bytes — an order of magnitude under both size gates, and a 2,049,905-byte
 * upload had succeeded minutes earlier, so no size gate could have fired. The
 * page cap did. The admin panel logged the status to the console and showed
 * nothing, so it read as "uploading is broken".
 *
 * The cap is a CANDIDATE guardrail (don't dump a 40-page scan into the passport
 * box). Staff uploading for a candidate are doing data entry on a document they
 * can see, and the size cap still bounds them — so admin uploads skip it. These
 * tests pin both halves: the exemption, and the guardrail that must survive it.
 */

const ADMIN = "admin@borivon.test";
const CAND  = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/rateLimit", () => ({ enforceUserRateLimit: async () => ({ ok: true }) }));
vi.mock("@/lib/scheduleMirror", () => ({ scheduleCandidateMirror: () => {} }));
vi.mock("@/lib/admin-auth", () => ({ canActOnCandidate: async () => true }));
vi.mock("@/lib/r2", () => ({
  r2Configured: () => true,
  r2Put: async () => {},
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
  };
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => res({ data: [], error: null });
  return chain;
}
const fakeDb = {
  from: () => table(),
  auth: {
    admin: { getUserById: async () => ({ data: { user: { email: "cand@x.test", user_metadata: {} } } }) },
    getUser: async () => ({ data: { user: { email: ADMIN, id: "admin-id" } }, error: null }),
  },
  storage: { from: () => ({ upload: async () => ({ error: null }) }) },
};
vi.mock("@/lib/supabase", () => ({
  getServiceSupabase: () => fakeDb,
  getAnonVerifyClient: () => fakeDb,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeDb }));

// The route signs for NextRequest; the test hands it a plain Request, which is
// all the code under test actually touches (formData, headers, url).
let POST: (r: never) => Promise<Response>;
beforeAll(async () => {
  process.env.ADMIN_EMAIL = ADMIN;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub";
  ({ POST } = await import("@/app/api/portal/upload/route"));
});

async function pdfOf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595, 842]);
  return d.save();
}

async function post(fileKey: string, label: string, bytes: Uint8Array, asAdmin: boolean) {
  const fd = new FormData();
  fd.append("file", new File([bytes as unknown as BlobPart], "scan.pdf", { type: "application/pdf" }));
  fd.append("fileKey", fileKey);
  fd.append("fileType", label);
  if (asAdmin) fd.append("forUserId", CAND);
  const res = await POST(new Request("https://www.borivon.com/api/portal/upload", {
    method: "POST", headers: { authorization: "Bearer stub-jwt" }, body: fd,
  }) as never);
  let body: Record<string, unknown> = {};
  try { body = await res.clone().json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

describe("PDF page cap — admin uploads are exempt", () => {
  it("a 3-page scan into a cap-2 box goes through for an admin", async () => {
    // The exact shape that answered 413 in production on 2026-09-19.
    expect((await post("abitur_transcript", "Abitur Notenübersicht", await pdfOf(3), true)).status).toBe(200);
  });

  it("a long transcript past its cap of 10 goes through for an admin", async () => {
    expect((await post("transcript_de", "Notenübersicht (DE)", await pdfOf(11), true)).status).toBe(200);
  });

  it("no page count at all bounds an admin — the size cap is the backstop", async () => {
    expect((await post("id", "Reisepass", await pdfOf(40), true)).status).toBe(200);
  });
});

describe("PDF page cap — the candidate guardrail must survive the exemption", () => {
  it("a candidate is still refused past the cap, with a decodable reason", async () => {
    const r = await post("abitur_transcript", "Abitur Notenübersicht", await pdfOf(3), false);
    expect(r.status).toBe(413);
    // The dashboard localises on this code, so it is part of the contract.
    expect(r.body.code).toBe("PDF_TOO_MANY_PAGES");
    expect(r.body.pages).toBe(3);
    expect(r.body.limit).toBe(2);
  });

  it("a candidate within the cap is accepted", async () => {
    expect((await post("transcript_de", "Notenübersicht (DE)", await pdfOf(2), false)).status).toBe(200);
  });
});
