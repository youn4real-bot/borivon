import { describe, it, expect, afterEach, vi } from "vitest";
import crypto from "node:crypto";

// storageToken signs with the download-token key; read lazily, so setting it here is enough.
process.env.DL_TOKEN_SECRET = "test-storage-secret-mirror-cccccccccccccccccccccc";

import { createClient } from "@supabase/supabase-js";
import { ilikePrefix, serveMediaRequest, type StorageMirror, type SupabaseRedirects } from "../lib/storage/r2StorageFetch";
import { withR2Storage, supabaseMirrorEnabled, r2MediaRoutesEnabled } from "../lib/storage/withR2Storage";
import { supabaseRedirects } from "../lib/storage/supabaseRedirects";
import { signStorageToken } from "../lib/storage/storageToken";
import type { ObjectStore } from "../lib/storage/objectStore";

/**
 * The transition around the storage flip (lib/storage/*):
 *   • the mirror — while Supabase Storage lives, every upload and remove that
 *     succeeds on R2 is repeated there, so a delete really deletes (a cleared
 *     photo is not left downloadable at its supabase.co URL) and a rollback
 *     finds every file written meanwhile;
 *   • rollback serving — with STORAGE_BACKEND "supabase" the routes send the
 *     browser to Supabase, never to R2's possibly-stale copy;
 *   • list search — a wildcard-heavy search cannot burn CPU.
 */

const BASE = "https://app.test/api/storage/v1";
const text = (s: string) => new TextEncoder().encode(s);

function memoryStore() {
  const map = new Map<string, { body: Uint8Array; contentType: string }>();
  const touched: string[] = [];
  const md5 = (b: Uint8Array) => crypto.createHash("md5").update(b).digest("hex");
  const head = (k: string) => { const e = map.get(k); return e ? { size: e.body.length, contentType: e.contentType, uploaded: new Date("2026-09-01T00:00:00Z"), etag: md5(e.body) } : null; };
  const store: ObjectStore = {
    async get(k) { touched.push(k); const e = map.get(k); return e ? { ...head(k)!, body: new Uint8Array(e.body) } : null; },
    async head(k) { touched.push(k); return head(k); },
    async put(k, body, contentType) { touched.push(k); map.set(k, { body: new Uint8Array(body), contentType }); },
    async delete(k) { touched.push(k); map.delete(k); },
    async list(prefix) { touched.push(prefix); return [...map.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, ...head(key)! })); },
  };
  return { store, map, touched };
}

function recorder(behaviour: { fail?: unknown; hang?: boolean } = {}) {
  const calls: { op: string; bucket: string; paths: string[]; bytes?: string; contentType?: string; cacheControl?: string | null }[] = [];
  const act = async () => {
    if (behaviour.hang) await new Promise(() => {});
    if (behaviour.fail) throw behaviour.fail;
  };
  const mirror: StorageMirror = {
    async upload(bucket, path, bytes, contentType, cacheControl) {
      calls.push({ op: "upload", bucket, paths: [path], bytes: crypto.createHash("sha256").update(bytes).digest("hex"), contentType, cacheControl });
      await act();
    },
    async remove(bucket, paths) {
      calls.push({ op: "remove", bucket, paths: [...paths] });
      await act();
    },
  };
  return { mirror, calls };
}

const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STORAGE_BACKEND;
  delete process.env.STORAGE_SUPABASE_MIRROR;
  delete process.env.STORAGE_MEDIA_ROUTES;
});

describe("the Supabase mirror — while Supabase Storage lives, R2 writes are repeated there", () => {
  it("a successful upload is repeated with the same bytes, type and cache-control", async () => {
    const { store } = memoryStore();
    const rec = recorder();
    const db = withR2Storage(createClient("https://proj.supabase.co", "k"), { force: true, store, baseUrl: BASE, mirror: rec.mirror });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect((await db.storage.from("feed-photos").upload("post-1.jpg", jpg, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" })).error).toBeNull();
    const pdf = text("%PDF-1.7 blob");
    expect((await db.storage.from("sign-documents").upload("c/req.pdf", new Blob([pdf], { type: "application/pdf" }))).error).toBeNull();
    expect(rec.calls).toEqual([
      { op: "upload", bucket: "feed-photos", paths: ["post-1.jpg"], bytes: sha(jpg), contentType: "image/jpeg", cacheControl: "31536000" },
      // storage-js's own default cacheControl travels in the multipart form.
      { op: "upload", bucket: "sign-documents", paths: ["c/req.pdf"], bytes: sha(pdf), contentType: "application/pdf", cacheControl: "3600" },
    ]);
  });

  it("an upload refused on R2 — duplicate, too big, wrong type, frozen, R2 down — never reaches Supabase", async () => {
    const { store, map } = memoryStore();
    const rec = recorder();
    const db = withR2Storage(createClient("https://proj.supabase.co", "k"), { force: true, store, baseUrl: BASE, mirror: rec.mirror });
    map.set("supabase/sign-documents/a.pdf", { body: text("one"), contentType: "application/pdf" });
    expect((await db.storage.from("sign-documents").upload("a.pdf", text("two"), { contentType: "application/pdf", upsert: false })).error?.statusCode).toBe("409");
    expect((await db.storage.from("profile-photos").upload("u.jpg", new Uint8Array(2 * 1024 * 1024 + 1), { contentType: "image/jpeg", upsert: true })).error?.statusCode).toBe("413");
    expect((await db.storage.from("profile-photos").upload("u.html", text("<b>"), { contentType: "text/html", upsert: true })).error?.statusCode).toBe("415");

    const frozen = withR2Storage(createClient("https://proj.supabase.co", "k"), {
      force: true, store, baseUrl: BASE, mirror: rec.mirror,
      wrap: () => (async () => new Response(JSON.stringify({ statusCode: "503", error: "Service Unavailable", message: "writes are paused" }), { status: 503 })) as unknown as typeof fetch,
    });
    expect((await frozen.storage.from("sign-documents").upload("b.pdf", text("x"), { contentType: "application/pdf" })).error?.message).toBe("writes are paused");

    const broken: ObjectStore = { ...store, async put() { throw new Error("R2 put failed: HTTP 500"); } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = withR2Storage(createClient("https://proj.supabase.co", "k"), { force: true, store: broken, baseUrl: BASE, mirror: rec.mirror });
    expect((await down.storage.from("sign-documents").upload("c.pdf", text("x"), { contentType: "application/pdf" })).error?.statusCode).toBe("500");

    expect(rec.calls).toEqual([]);
  });

  it("remove is repeated for EVERY path named — also ones R2 never had — and nothing else", async () => {
    const { store, map } = memoryStore();
    const rec = recorder();
    const db = withR2Storage(createClient("https://proj.supabase.co", "k"), { force: true, store, baseUrl: BASE, mirror: rec.mirror });
    map.set("supabase/profile-photos/u1.png", { body: text("png"), contentType: "image/png" });
    const { data, error } = await db.storage.from("profile-photos").remove(["u1.jpg", "u1.png", "u1.webp", "../../candidates/u1/passport.pdf", "u1.png"]);
    expect(error).toBeNull();
    expect(data!.map((r) => r.name)).toEqual(["u1.png"]);
    // A photo uploaded before the flip that R2 lost, or one in Supabase only, is gone on both sides now.
    // A path that climbs out of the bucket is refused on both sides (LAW #33: exactly the named keys).
    expect(rec.calls).toEqual([{ op: "remove", bucket: "profile-photos", paths: ["u1.jpg", "u1.png", "u1.webp"] }]);
  });

  it("a failed or hanging mirror never fails the call — it is logged as a MIRROR MISS with its paths", async () => {
    const { store, map } = memoryStore();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.join(" ")); });

    const failing = recorder({ fail: { message: "Bucket not found" } });
    const db = withR2Storage(createClient("https://proj.supabase.co", "k"), { force: true, store, baseUrl: BASE, mirror: failing.mirror });
    expect((await db.storage.from("sign-documents").upload("c/x.pdf", text("%PDF"), { contentType: "application/pdf" })).error).toBeNull();
    expect(map.has("supabase/sign-documents/c/x.pdf")).toBe(true);

    const hanging = recorder({ hang: true });
    const slow = withR2Storage(createClient("https://proj.supabase.co", "k"), { force: true, store, baseUrl: BASE, mirror: hanging.mirror, mirrorTimeoutMs: 30 });
    const started = Date.now();
    const rm = await slow.storage.from("sign-documents").remove(["c/x.pdf"]);
    expect(rm.error).toBeNull();
    expect(rm.data).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(2000);

    expect(errors).toEqual([
      "[r2-storage] MIRROR MISS upload sign-documents: c/x.pdf — Bucket not found",
      "[r2-storage] MIRROR MISS remove sign-documents: c/x.pdf — timed out after 30 ms",
    ]);
  });

  it("switched on by the flag alone, the mirror goes through the ORIGINAL Supabase storage client", async () => {
    const { store } = memoryStore();
    process.env.STORAGE_BACKEND = "r2";
    const client = createClient("https://proj.supabase.co", "k");
    const original = client.storage;
    const upload = vi.fn(async () => ({ data: { path: "x" }, error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    vi.spyOn(original, "from").mockReturnValue({ upload, remove } as never);
    const net = vi.spyOn(globalThis, "fetch");

    withR2Storage(client, { store, baseUrl: BASE });
    expect(client.storage).not.toBe(original);
    const bytes = text("%PDF-mirror");
    expect((await client.storage.from("slot-templates").upload("slot-templates/s.pdf", bytes, { contentType: "application/pdf", upsert: true })).error).toBeNull();
    expect((await client.storage.from("slot-templates").remove(["slot-templates/s.pdf"])).error).toBeNull();

    expect(original.from).toHaveBeenCalledWith("slot-templates");
    expect(upload).toHaveBeenCalledWith("slot-templates/s.pdf", bytes, { contentType: "application/pdf", upsert: true, cacheControl: "3600" });
    expect(remove).toHaveBeenCalledWith(["slot-templates/s.pdf"]);
    expect(net).not.toHaveBeenCalled();
  });

  it("a Supabase error from the original client counts as a miss, not a failed upload", async () => {
    const { store } = memoryStore();
    process.env.STORAGE_BACKEND = "r2";
    const client = createClient("https://proj.supabase.co", "k");
    vi.spyOn(client.storage, "from").mockReturnValue({ upload: async () => ({ data: null, error: { message: "The object exceeded the maximum allowed size" } }) } as never);
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a.join(" ")); });
    withR2Storage(client, { store, baseUrl: BASE });
    expect((await client.storage.from("sign-documents").upload("big.pdf", text("%PDF"), { contentType: "application/pdf" })).error).toBeNull();
    expect(errors).toEqual(["[r2-storage] MIRROR MISS upload sign-documents: big.pdf — The object exceeded the maximum allowed size"]);
  });

  it("STORAGE_SUPABASE_MIRROR=off stops it; tests forcing R2 never mirror unless handed one", async () => {
    expect(supabaseMirrorEnabled({})).toBe(true);
    expect(supabaseMirrorEnabled({ STORAGE_SUPABASE_MIRROR: "OFF" })).toBe(true);
    expect(supabaseMirrorEnabled({ STORAGE_SUPABASE_MIRROR: "off" })).toBe(false);

    for (const setup of [() => { process.env.STORAGE_BACKEND = "r2"; process.env.STORAGE_SUPABASE_MIRROR = "off"; return {}; }, () => ({ force: true })]) {
      const { store } = memoryStore();
      const extra = setup();
      const client = createClient("https://proj.supabase.co", "k");
      const upload = vi.fn();
      vi.spyOn(client.storage, "from").mockReturnValue({ upload, remove: vi.fn() } as never);
      withR2Storage(client, { store, baseUrl: BASE, ...extra });
      expect((await client.storage.from("sign-documents").upload("a.pdf", text("%PDF"), { contentType: "application/pdf" })).error).toBeNull();
      expect(upload).not.toHaveBeenCalled();
      vi.restoreAllMocks();
      delete process.env.STORAGE_BACKEND;
      delete process.env.STORAGE_SUPABASE_MIRROR;
    }
  });
});

describe("rollback serving — STORAGE_BACKEND \"supabase\" sends the browser to Supabase, never R2's copy", () => {
  const redirects = (signed: string | null = "https://proj.supabase.co/storage/v1/object/sign/x?token=sb") => {
    const signedUrl = vi.fn(async () => signed);
    const r: SupabaseRedirects = { publicUrl: (b, p) => `https://proj.supabase.co/storage/v1/object/public/${b}/${p}`, signedUrl };
    return { r, signedUrl };
  };
  const untouchable: ObjectStore = {
    get: async () => { throw new Error("R2 read during rollback"); },
    head: async () => { throw new Error("R2 read during rollback"); },
    put: async () => { throw new Error("R2 write during rollback"); },
    delete: async () => { throw new Error("R2 write during rollback"); },
    list: async () => { throw new Error("R2 read during rollback"); },
  };

  it("the rollback value keeps the routes up; only that exact spelling", () => {
    expect(r2MediaRoutesEnabled({ STORAGE_BACKEND: "supabase" })).toBe(true);
    expect(r2MediaRoutesEnabled({ STORAGE_BACKEND: "Supabase" })).toBe(false);
    expect(r2MediaRoutesEnabled({ STORAGE_BACKEND: "" })).toBe(false);
  });

  it("a stored public photo URL redirects to the same object on Supabase, keeping its query", async () => {
    const { r } = redirects();
    const res = await serveMediaRequest(new Request(`${BASE}/object/public/profile-photos/u1.jpg?t=1757000000000`), "public", { store: untouchable, rollback: r });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://proj.supabase.co/storage/v1/object/public/profile-photos/u1.jpg?t=1757000000000");
  });

  it("private buckets and traversal are refused before any redirect", async () => {
    const { r } = redirects();
    for (const u of [`${BASE}/object/public/sign-documents/c/req.pdf`, `${BASE}/object/public/profile-photos/..%2F..%2Fsign-documents%2Fx.pdf`, `${BASE}/object/public/profile-photos/%2e%2e/x.jpg`]) {
      const res = await serveMediaRequest(new Request(u), "public", { store: untouchable, rollback: r });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("a signed URL is still checked against OUR token, then sent to a one-minute Supabase signed URL", async () => {
    const { r, signedUrl } = redirects();
    const token = signStorageToken("sign-documents", "c/req 1.pdf", 3600);
    const ok = await serveMediaRequest(new Request(`${BASE}/object/sign/sign-documents/c/req%201.pdf?token=${token}&download=`), "sign", { store: untouchable, rollback: r });
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("https://proj.supabase.co/storage/v1/object/sign/x?token=sb");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(signedUrl).toHaveBeenCalledWith("sign-documents", "c/req 1.pdf", 60, "");

    signedUrl.mockClear();
    for (const u of [`${BASE}/object/sign/sign-documents/c/other.pdf?token=${token}`, `${BASE}/object/sign/sign-documents/c/req%201.pdf?token=forged`, `${BASE}/object/sign/sign-documents/c/req%201.pdf`]) {
      const res = await serveMediaRequest(new Request(u), "sign", { store: untouchable, rollback: r });
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
    }
    expect(signedUrl).not.toHaveBeenCalled();

    const gone = await serveMediaRequest(new Request(`${BASE}/object/sign/sign-documents/c/req%201.pdf?token=${token}`), "sign", { store: untouchable, rollback: redirects(null).r });
    expect(gone.status).toBe(400);
    expect(await gone.json()).toMatchObject({ message: "Object not found", statusCode: "404" });
  });

  it("supabaseRedirects builds its URLs with the real storage-js client", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({ signedURL: "/object/sign/sign-documents/c/req.pdf?token=sb-jwt" });
    }) as typeof fetch;
    const r = supabaseRedirects(createClient("https://proj.supabase.co", "k", { global: { fetch: fake } }).storage);
    expect(r.publicUrl("feed-photos", "p.jpg")).toBe("https://proj.supabase.co/storage/v1/object/public/feed-photos/p.jpg");
    expect(await r.signedUrl("sign-documents", "c/req.pdf", 60, null)).toBe("https://proj.supabase.co/storage/v1/object/sign/sign-documents/c/req.pdf?token=sb-jwt");
    expect(await r.signedUrl("sign-documents", "c/req.pdf", 60, "")).toBe("https://proj.supabase.co/storage/v1/object/sign/sign-documents/c/req.pdf?token=sb-jwt&download=");
    expect(seen[0]).toEqual({ url: "https://proj.supabase.co/storage/v1/object/sign/sign-documents/c/req.pdf", body: { expiresIn: 60 } });
  });
});

describe("list search — Postgres ILIKE prefix, in linear time", () => {
  it("wildcards, one-character matches, escapes and case", () => {
    expect(ilikePrefix("Alpha.pdf", "al")).toBe(true);
    expect(ilikePrefix("alpine.pdf", "ALP_")).toBe(true);
    expect(ilikePrefix("beta.pdf", "%ta")).toBe(true);
    expect(ilikePrefix("beta.pdf", "a.b")).toBe(false);
    expect(ilikePrefix("a%b.pdf", "a\\%b")).toBe(true);
    expect(ilikePrefix("axb.pdf", "a\\%b")).toBe(false);
    expect(ilikePrefix("a_b", "a\\_")).toBe(true);
    expect(ilikePrefix("ab", "a\\_")).toBe(false);
    expect(ilikePrefix("11111111-1111-4111-8111-111111111111.pdf", "11111111-1111-4111-8111-111111111111.pdf")).toBe(true);
    expect(ilikePrefix("archive", "11111111-1111-4111-8111-111111111111.pdf")).toBe(false);
    expect(ilikePrefix("x", "")).toBe(true);
    expect(ilikePrefix("", "%")).toBe(true);
    expect(ilikePrefix("", "_")).toBe(false);
    // One _ is one character, also beyond the BMP.
    expect(ilikePrefix("\u{1F600}b", "_b")).toBe(true);
  });

  it("a search full of % answers at once (the RegExp took 5.5 s at seven)", async () => {
    const { store, map } = memoryStore();
    for (let i = 0; i < 20; i++) map.set(`supabase/slot-templates/slot-templates/${crypto.randomUUID()}.pdf`, { body: text("x"), contentType: "application/pdf" });
    const db = withR2Storage(createClient("https://proj.supabase.co", "k"), { force: true, store, baseUrl: BASE });
    const started = Date.now();
    for (const search of ["%%%%%%!", "%%%%%%%!", `${"%".repeat(40)}!`, `${"%_".repeat(40)}!`]) {
      const { data, error } = await db.storage.from("slot-templates").list("slot-templates", { search });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
