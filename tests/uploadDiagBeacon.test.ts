import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

/**
 * The upload route, driven for the failure that never reaches it.
 *
 * On 2026-09-19 a candidate's passport upload died in the browser with
 * "Netzwerkfehler" and Cloudflare Observability had NO POST /api/portal/upload
 * in the surrounding hours. Nothing was logged because nothing arrived, so the
 * only evidence was a screenshot of a red sentence.
 *
 * Two halves are pinned here:
 *   1. the beacon — a tiny authenticated JSON POST to the SAME route, so the
 *      next failure is a line in the Worker log instead of a screenshot;
 *   2. that a real 12 MB passport photo goes through this route untouched, so
 *      "the server refused it" is ruled out as the cause by evidence, not by
 *      reasoning.
 */

const ADMIN = "admin@borivon.test";
const CAND_ID = "11111111-1111-4111-8111-111111111111";

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
    getUser: async () => ({ data: { user: { email: "cand@x.test", id: CAND_ID } }, error: null }),
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
  // No OCR credentials: the passport branch falls back and still answers 200.
  delete process.env.AZURE_DOC_INTEL_ENDPOINT;
  delete process.env.AZURE_DOC_INTEL_KEY;
  ({ POST } = await import("@/app/api/portal/upload/route"));
});

afterEach(() => { vi.restoreAllMocks(); });

function req(body: BodyInit | null, headers: Record<string, string>) {
  return POST(new Request("https://www.borivon.com/api/portal/upload", {
    method: "POST", headers, body,
  }) as never);
}

const DIAG = {
  slot: "id", attempt: 4, kind: "network", status: 0,
  bytes: 4_200_000, mime: "image/jpeg", ms: 31_400, sent: 1_048_576,
  online: true, net: "3g", hidden: false, final: true,
};

describe("client-failure beacon", () => {
  it("logs the failure the Worker never saw, and answers 204", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await req(JSON.stringify({ diag: DIAG }), {
      authorization: "Bearer stub-jwt", "content-type": "application/json",
    });
    expect(res.status).toBe(204);
    const line = warn.mock.calls.map(c => String(c[0])).find(l => l.includes("[upload][client-fail]"));
    expect(line).toBeTruthy();
    // Everything a debugger needs, on one greppable line, tied to a real user.
    expect(line).toContain(`user=${CAND_ID}`);
    expect(line).toContain("slot=id");
    expect(line).toContain("kind=network");
    expect(line).toContain("attempt=4");
    expect(line).toContain("final=true");
    expect(line).toContain("bytes=4200000");
  });

  it("requires the same Bearer token as a real upload — no new public surface", async () => {
    const res = await req(JSON.stringify({ diag: DIAG }), { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });

  it("rejects a JSON body that is not a diagnostic", async () => {
    const res = await req(JSON.stringify({ hello: "world" }), {
      authorization: "Bearer stub-jwt", "content-type": "application/json",
    });
    expect(res.status).toBe(400);
  });

  it("does not crash on a malformed JSON body", async () => {
    const res = await req("{not json", {
      authorization: "Bearer stub-jwt", "content-type": "application/json",
    });
    expect(res.status).toBe(400);
  });

  it("does not intercept a real multipart upload", async () => {
    // The beacon branch keys on Content-Type only; a multipart POST must still
    // travel the normal path, or this diagnostic would eat every upload.
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], "p.jpg", { type: "image/jpeg" }));
    fd.append("fileKey", "id");
    fd.append("fileType", "Reisepass");
    const res = await req(fd, { authorization: "Bearer stub-jwt" });
    expect(res.status).toBe(200);
  });
});

describe("a real passport photo against the real route", () => {
  /** A JPEG of `mb` megabytes: real SOI/APP0 magic so sniffMime accepts it. */
  function jpegOf(mb: number): File {
    const bytes = new Uint8Array(Math.round(mb * 1024 * 1024));
    bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00], 0);
    bytes[bytes.length - 2] = 0xff;
    bytes[bytes.length - 1] = 0xd9; // EOI
    return new File([bytes], "passport.jpg", { type: "image/jpeg" });
  }

  async function postPhoto(mb: number) {
    const fd = new FormData();
    fd.append("file", jpegOf(mb));
    fd.append("fileKey", "id");
    fd.append("fileType", "Reisepass");
    fd.append("firstName", "Amina");
    fd.append("lastName", "Bennani");
    return req(fd, { authorization: "Bearer stub-jwt" });
  }

  it("accepts a 12 MB camera photo of a passport", async () => {
    // Rules the server out: what she picked was well inside every gate here,
    // so the failure was on her side of the wire.
    expect((await postPhoto(12)).status).toBe(200);
  }, 60_000);

  it("accepts a 24 MB scan, just under the 25 MB ceiling", async () => {
    expect((await postPhoto(24)).status).toBe(200);
  }, 90_000);

  it("still refuses an oversized body before parsing it", async () => {
    // Pins the pre-parse guard: a Worker isolate must not buffer a 300 MB post.
    const res = await req("x", {
      authorization: "Bearer stub-jwt",
      "content-type": "multipart/form-data; boundary=zz",
      "content-length": String(300 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });
});
