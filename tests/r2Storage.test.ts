import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";

// storageToken signs with the download-token key; fix it before anything imports it.
process.env.DL_TOKEN_SECRET = "test-storage-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb";

import { createClient } from "@supabase/supabase-js";
import { makeR2StorageFetch, objectKey, serveMediaRequest, PUBLIC_BUCKETS } from "../lib/storage/r2StorageFetch";
import { withR2Storage, r2StorageEnabled, r2MediaRoutesEnabled, r2StorageBaseUrl } from "../lib/storage/withR2Storage";
import { bindingObjectStore, restObjectStore, setObjectStore, type ObjectStore, type R2BindingLike } from "../lib/storage/objectStore";
import { signStorageToken, checkStorageToken } from "../lib/storage/storageToken";
import { signDlToken, verifyDlToken } from "../lib/dlToken";

/**
 * Supabase Storage answered from R2 (lib/storage/*). Every call here goes
 * through the REAL supabase-js / storage-js the portal uses, against an
 * in-memory object store, so a shape storage-js cannot parse — or a call site
 * branch that would take the wrong path — fails here instead of in production.
 * The live comparison against Supabase itself is tests/r2StorageParity.test.ts.
 */

const BASE = "https://app.test/api/storage/v1";

type Entry = { body: Uint8Array; contentType: string; uploaded: Date };

function memoryStore() {
  const map = new Map<string, Entry>();
  const touched: string[] = [];
  const etag = (b: Uint8Array) => crypto.createHash("md5").update(b).digest("hex");
  const store: ObjectStore = {
    async get(key) {
      touched.push(key);
      const e = map.get(key);
      if (!e) return null;
      const body = new Uint8Array(e.body);
      return { body, size: body.length, contentType: e.contentType, uploaded: e.uploaded, etag: etag(body) };
    },
    async head(key) {
      touched.push(key);
      const e = map.get(key);
      return e ? { size: e.body.length, contentType: e.contentType, uploaded: e.uploaded, etag: etag(e.body) } : null;
    },
    async put(key, body, contentType) {
      touched.push(key);
      map.set(key, { body: new Uint8Array(body), contentType, uploaded: new Date() });
    },
    async delete(key) {
      touched.push(key);
      map.delete(key);
    },
    async list(prefix) {
      touched.push(prefix);
      return [...map.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, e]) => ({ key, size: e.body.length, contentType: e.contentType, uploaded: e.uploaded, etag: etag(e.body) }));
    },
  };
  const seed = (key: string, bytes: string | Uint8Array, contentType: string, uploaded = new Date("2026-09-01T10:00:00Z")) =>
    map.set(key, { body: typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes, contentType, uploaded });
  return { store, map, touched, seed };
}

function r2Client(store: ObjectStore, extra: Parameters<typeof withR2Storage>[1] = {}) {
  return withR2Storage(createClient("https://proj.supabase.co", "service-key"), { force: true, store, baseUrl: BASE, ...extra });
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const text = (s: string) => new TextEncoder().encode(s);

// ── the switch ───────────────────────────────────────────────────────────────

describe("withR2Storage — off unless STORAGE_BACKEND is exactly r2", () => {
  it("leaves the client untouched when the flag is off", () => {
    const client = createClient("https://proj.supabase.co", "service-key");
    const before = client.storage;
    expect(withR2Storage(client, { baseUrl: BASE })).toBe(client);
    expect(client.storage).toBe(before);
    expect(client.storage.from("profile-photos").getPublicUrl("u.jpg").data.publicUrl)
      .toBe("https://proj.supabase.co/storage/v1/object/public/profile-photos/u.jpg");
  });

  it("only the exact value switches: a typo fails toward Supabase", () => {
    expect(r2StorageEnabled({ STORAGE_BACKEND: "r2" })).toBe(true);
    for (const v of ["R2", " r2", "r2 ", "true", "1", "", undefined]) expect(r2StorageEnabled({ STORAGE_BACKEND: v })).toBe(false);
  });

  it("the serving routes stay up for a rollback only when asked", () => {
    expect(r2MediaRoutesEnabled({})).toBe(false);
    expect(r2MediaRoutesEnabled({ STORAGE_BACKEND: "r2" })).toBe(true);
    expect(r2MediaRoutesEnabled({ STORAGE_MEDIA_ROUTES: "on" })).toBe(true);
    expect(r2MediaRoutesEnabled({ STORAGE_MEDIA_ROUTES: "yes" })).toBe(false);
  });

  it("builds URLs on the site's own base (the bot's PUBLIC_BASE_URL)", () => {
    expect(r2StorageBaseUrl({})).toBe("https://www.borivon.com/api/storage/v1");
    expect(r2StorageBaseUrl({ PUBLIC_BASE_URL: "https://preview.example/" })).toBe("https://preview.example/api/storage/v1");
  });

  it("getPublicUrl points at our route once on", () => {
    const { store } = memoryStore();
    const db = r2Client(store);
    expect(db.storage.from("profile-photos").getPublicUrl("u1.jpg").data.publicUrl).toBe(`${BASE}/object/public/profile-photos/u1.jpg`);
  });

  it("a storage request never reaches the network, and the wrap sees every one", async () => {
    const { store } = memoryStore();
    const net = vi.spyOn(globalThis, "fetch");
    const seen: string[] = [];
    const db = r2Client(store, {
      wrap: (next) => (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${String(input)}`);
        return next(input as RequestInfo, init);
      }) as typeof fetch,
    });
    await db.storage.createBucket("feed-photos", { public: true });
    await db.storage.from("feed-photos").upload("p.jpg", text("x"), { contentType: "image/jpeg" });
    await db.storage.from("feed-photos").download("p.jpg");
    expect(net).not.toHaveBeenCalled();
    expect(seen).toEqual([`POST ${BASE}/bucket`, `POST ${BASE}/object/feed-photos/p.jpg`, `GET ${BASE}/object/feed-photos/p.jpg`]);
    net.mockRestore();
  });

  it("a wrap can refuse a write before it reaches R2 (the maintenance freeze)", async () => {
    const { store, map } = memoryStore();
    const freeze = () => (async () => new Response(JSON.stringify({ statusCode: "503", error: "Service Unavailable", message: "writes are paused" }), { status: 503 })) as unknown as typeof fetch;
    const db = r2Client(store, { wrap: freeze });
    const { error } = await db.storage.from("sign-documents").upload("a.pdf", text("%PDF"), { contentType: "application/pdf" });
    expect(error?.message).toBe("writes are paused");
    expect(map.size).toBe(0);
  });
});

// ── operations, exactly as the call sites use them ──────────────────────────

describe("storage-js operations against R2", () => {
  let mem: ReturnType<typeof memoryStore>;
  let db: ReturnType<typeof r2Client>;
  beforeEach(() => {
    mem = memoryStore();
    db = r2Client(mem.store);
  });

  it("createBucket succeeds as a no-op (call sites run it before every upload)", async () => {
    const { data, error } = await db.storage.createBucket("profile-photos", { public: true, fileSizeLimit: 2097152 });
    expect(error).toBeNull();
    expect(data).toEqual({ name: "profile-photos" });
    expect(mem.map.size).toBe(0);
  });

  it("upload of raw bytes stores under supabase/<bucket>/<path> with its content type", async () => {
    const { data, error } = await db.storage.from("sign-documents").upload("cand-1/req-1.pdf", text("%PDF-1.7 a"), { contentType: "application/pdf", upsert: false });
    expect(error).toBeNull();
    expect(data).toMatchObject({ path: "cand-1/req-1.pdf", fullPath: "sign-documents/cand-1/req-1.pdf" });
    expect(data?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const stored = mem.map.get("supabase/sign-documents/cand-1/req-1.pdf");
    expect(stored?.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(stored?.body)).toBe("%PDF-1.7 a");
  });

  it("upload of a Blob (multipart) keeps the Blob's bytes and type", async () => {
    const blob = new Blob([text("%PDF-blob")], { type: "application/pdf" });
    const { error } = await db.storage.from("slot-templates").upload("slot-templates/s.pdf", blob);
    expect(error).toBeNull();
    const stored = mem.map.get("supabase/slot-templates/slot-templates/s.pdf");
    expect(stored?.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(stored?.body)).toBe("%PDF-blob");
  });

  it("upload without upsert refuses an existing object with Supabase's Duplicate error; upsert replaces it and keeps the id", async () => {
    const first = await db.storage.from("sign-documents").upload("a.pdf", text("one"), { contentType: "application/pdf" });
    const dup = await db.storage.from("sign-documents").upload("a.pdf", text("two"), { contentType: "application/pdf", upsert: false });
    expect(dup.data).toBeNull();
    expect(dup.error).toMatchObject({ message: "The resource already exists", statusCode: "409", status: 400 });
    // The slot-template ensureBucket regex and the photo routes' "already exist" check both key off this text.
    expect(/already exists|resource already/i.test(dup.error!.message)).toBe(true);
    expect(new TextDecoder().decode(mem.map.get("supabase/sign-documents/a.pdf")?.body)).toBe("one");

    const up = await db.storage.from("sign-documents").upload("a.pdf", text("two"), { contentType: "application/pdf", upsert: true });
    expect(up.error).toBeNull();
    expect(up.data?.id).toBe(first.data?.id);
    expect(new TextDecoder().decode(mem.map.get("supabase/sign-documents/a.pdf")?.body)).toBe("two");
  });

  it("download returns a Blob with the stored bytes and type", async () => {
    const pdf = crypto.randomBytes(4096);
    mem.seed("supabase/sign-documents/doc-cache/abc", new Uint8Array(pdf), "application/pdf");
    const { data, error } = await db.storage.from("sign-documents").download("doc-cache/abc");
    expect(error).toBeNull();
    expect(data).toBeInstanceOf(Blob);
    expect(data!.size).toBe(4096);
    expect(data!.type).toBe("application/pdf");
    expect(Buffer.from(await bytesOf(data!)).equals(pdf)).toBe(true);
  });

  it("download of a missing object answers Supabase's 'Object not found' (status 400, statusCode 404)", async () => {
    const { data, error } = await db.storage.from("sign-documents").download("nope.pdf");
    expect(data).toBeNull();
    expect(error).toMatchObject({ name: "StorageApiError", message: "Object not found", statusCode: "404", status: 400 });
  });

  it("exists() answers true / false through HEAD", async () => {
    mem.seed("supabase/feed-photos/p.jpg", "x", "image/jpeg");
    expect((await db.storage.from("feed-photos").exists("p.jpg")).data).toBe(true);
    expect((await db.storage.from("feed-photos").exists("q.jpg")).data).toBe(false);
  });

  it("remove deletes exactly the named objects and reports only those that existed", async () => {
    mem.seed("supabase/profile-photos/u1.png", "png", "image/png");
    mem.seed("supabase/profile-photos/u1.png-keep", "other", "image/png");
    mem.seed("candidates/u1/u1.png", "candidate doc", "image/png");
    const { data, error } = await db.storage.from("profile-photos").remove(["u1.jpg", "u1.png", "u1.webp"]);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ name: "u1.png", bucket_id: "profile-photos" });
    expect(mem.map.has("supabase/profile-photos/u1.png")).toBe(false);
    // LAW #33: nothing but the named key — not a sibling, never a candidate file.
    expect(mem.map.has("supabase/profile-photos/u1.png-keep")).toBe(true);
    expect(mem.map.has("candidates/u1/u1.png")).toBe(true);
    expect(mem.touched.every((k) => k.startsWith("supabase/profile-photos/"))).toBe(true);
  });

  it("remove of nothing that exists is an empty success, like Supabase", async () => {
    const { data, error } = await db.storage.from("feed-photos").remove(["x.jpg", "x.png"]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("list answers one folder level: files with metadata, folders with nulls, by name", async () => {
    const id1 = "11111111-1111-4111-8111-111111111111";
    const id2 = "22222222-2222-4222-8222-222222222222";
    mem.seed(`supabase/slot-templates/slot-templates/${id2}.pdf`, "b".repeat(20), "application/pdf");
    mem.seed(`supabase/slot-templates/slot-templates/${id1}.pdf`, "a".repeat(10), "application/pdf", new Date("2026-09-02T08:00:00Z"));
    mem.seed(`supabase/slot-templates/slot-templates/archive/${id1}_2026.pdf`, "old", "application/pdf");
    const { data, error } = await db.storage.from("slot-templates").list("slot-templates");
    expect(error).toBeNull();
    expect(data!.map((o) => o.name)).toEqual([`${id1}.pdf`, `${id2}.pdf`, "archive"]);
    expect(data![0]).toMatchObject({ updated_at: "2026-09-02T08:00:00.000Z", metadata: { size: 10, mimetype: "application/pdf" } });
    expect(data![0].id).toEqual(expect.any(String));
    expect(data![2]).toEqual({ name: "archive", id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
  });

  it("list with search is the slot-template existence check: exactly the one template, not its archive", async () => {
    const id1 = "11111111-1111-4111-8111-111111111111";
    mem.seed(`supabase/slot-templates/slot-templates/${id1}.pdf`, "a", "application/pdf");
    mem.seed(`supabase/slot-templates/slot-templates/archive/${id1}_2026.pdf`, "old", "application/pdf");
    mem.seed("supabase/slot-templates/slot-templates/33333333-3333-4333-8333-333333333333.pdf", "c", "application/pdf");
    const { data } = await db.storage.from("slot-templates").list("slot-templates", { limit: 100, search: `${id1}.pdf` });
    expect(data!.map((o) => o.name)).toEqual([`${id1}.pdf`]);
    const none = await db.storage.from("slot-templates").list("slot-templates", { limit: 1, search: "44444444-4444-4444-8444-444444444444.pdf" });
    expect(none.data).toEqual([]);
  });

  it("list search is Postgres ILIKE prefix: case-insensitive, % and _ are wildcards", async () => {
    for (const n of ["Alpha.pdf", "alpine.pdf", "beta.pdf"]) mem.seed(`supabase/sign-documents/f/${n}`, "x", "application/pdf");
    const names = async (search: string) => (await db.storage.from("sign-documents").list("f", { search })).data!.map((o) => o.name);
    expect(await names("al")).toEqual(["Alpha.pdf", "alpine.pdf"]);
    expect(await names("ALP_")).toEqual(["Alpha.pdf", "alpine.pdf"]);
    expect(await names("%ta")).toEqual(["beta.pdf"]);
    expect(await names("a.b")).toEqual([]);
  });

  it("list honours limit, offset and descending order", async () => {
    for (const n of ["a", "b", "c", "d"]) mem.seed(`supabase/feed-photos/${n}.jpg`, n, "image/jpeg");
    const { data } = await db.storage.from("feed-photos").list("", { limit: 2, offset: 1, sortBy: { column: "name", order: "desc" } });
    expect(data!.map((o) => o.name)).toEqual(["c.jpg", "b.jpg"]);
  });

  it("the public buckets' own limits still apply: size and type", async () => {
    const big = await db.storage.from("profile-photos").upload("u.jpg", new Uint8Array(2 * 1024 * 1024 + 1), { contentType: "image/jpeg", upsert: true });
    expect(big.error).toMatchObject({ statusCode: "413" });
    const html = await db.storage.from("profile-photos").upload("u.html", text("<script>"), { contentType: "text/html", upsert: true });
    expect(html.error).toMatchObject({ statusCode: "415" });
    const gifToFeed = await db.storage.from("feed-photos").upload("p.gif", text("GIF89a"), { contentType: "image/gif", upsert: true });
    expect(gifToFeed.error).toMatchObject({ statusCode: "415" });
    expect(mem.map.size).toBe(0);
  });

  it("a key that climbs out of its bucket is refused before R2 is asked", () => {
    expect(objectKey("supabase", "profile-photos", "../../candidates/u/passport.pdf")).toBeNull();
    expect(objectKey("supabase", "profile-photos", "a/./b")).toBeNull();
    expect(objectKey("supabase", "../candidates", "x")).toBeNull();
    expect(objectKey("supabase", "a/b", "x")).toBeNull();
    expect(objectKey("supabase", "profile-photos", "")).toBeNull();
    expect(objectKey("supabase", "profile-photos", "a\\..\\b")).toBeNull();
    expect(objectKey("supabase", "Borivon Bucket", "/x/y.pdf")).toEqual({ key: "supabase/Borivon Bucket/x/y.pdf", path: "x/y.pdf" });
  });

  it("answers 500 in storage-js's shape when R2 is not reachable, and never falls back to Supabase", async () => {
    const passthrough = vi.fn();
    const f = makeR2StorageFetch({ store: null, passthrough: passthrough as unknown as typeof fetch });
    setObjectStore(null);
    const res = await f(`${BASE}/object/sign-documents/a.pdf`);
    // Node test runs have no CLOUDFLARE_* / R2_* env, so the default store is null too.
    if (!process.env.CLOUDFLARE_API_TOKEN && !process.env.R2_ENDPOINT) {
      expect(res.status).toBe(500);
      expect(passthrough).not.toHaveBeenCalled();
    }
  });

  it("hands anything that is not a storage URL to the passthrough", async () => {
    const passthrough = vi.fn(async () => new Response("rest"));
    const f = makeR2StorageFetch({ store: mem.store, passthrough: passthrough as unknown as typeof fetch });
    const res = await f("https://proj.supabase.co/rest/v1/documents?select=id");
    expect(await res.text()).toBe("rest");
    expect(passthrough).toHaveBeenCalledTimes(1);
  });

  it("move / copy / signed upload URLs are refused loudly, not half-done", async () => {
    mem.seed("supabase/sign-documents/a.pdf", "x", "application/pdf");
    const mv = await db.storage.from("sign-documents").move("a.pdf", "b.pdf");
    expect(mv.error?.statusCode).toBe("501");
    expect(mem.map.has("supabase/sign-documents/a.pdf")).toBe(true);
  });
});

// ── serving to a browser ─────────────────────────────────────────────────────

describe("public URLs (profile-photos, feed-photos) from our own route", () => {
  let mem: ReturnType<typeof memoryStore>;
  beforeEach(() => { mem = memoryStore(); });

  it("the public set is exactly Supabase's two public buckets", () => {
    expect([...PUBLIC_BUCKETS].sort()).toEqual(["feed-photos", "profile-photos"]);
  });

  it("serves the photo a stored getPublicUrl?t=… points at, cached for a year", async () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    mem.seed("supabase/profile-photos/u1.jpg", jpg, "image/jpeg");
    const db = r2Client(mem.store);
    const url = `${db.storage.from("profile-photos").getPublicUrl("u1.jpg").data.publicUrl}?t=1757000000000`;
    const res = await serveMediaRequest(new Request(url), "public", { store: mem.store });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpg);
  });

  it("a bare URL (no ?t) may change in place, so it keeps an hour", async () => {
    mem.seed("supabase/feed-photos/p.png", "png", "image/png");
    const res = await serveMediaRequest(new Request(`${BASE}/object/public/feed-photos/p.png`), "public", { store: mem.store });
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("a private bucket is never served publicly — the store is not even asked", async () => {
    mem.seed("supabase/sign-documents/cand/req.pdf", "%PDF", "application/pdf");
    mem.seed("supabase/slot-templates/slot-templates/s.pdf", "%PDF", "application/pdf");
    for (const u of [`${BASE}/object/public/sign-documents/cand/req.pdf`, `${BASE}/object/public/slot-templates/slot-templates/s.pdf`, `${BASE}/object/public/Borivon%20Bucket/x`]) {
      const res = await serveMediaRequest(new Request(u), "public", { store: mem.store });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ statusCode: "404", message: "Bucket not found" });
    }
    expect(mem.touched).toEqual([]);
  });

  it("encoded traversal cannot reach a private object through the public route", async () => {
    mem.seed("supabase/sign-documents/x.pdf", "%PDF", "application/pdf");
    for (const u of [
      `${BASE}/object/public/profile-photos/..%2F..%2Fsign-documents%2Fx.pdf`,
      `${BASE}/object/public/profile-photos/%2e%2e/%2e%2e/sign-documents/x.pdf`,
      `${BASE}/object/public/profile-photos/../sign/sign-documents/x.pdf`,
    ]) {
      const res = await serveMediaRequest(new Request(u), "public", { store: mem.store });
      expect(res.status).not.toBe(200);
    }
    expect(mem.touched.some((k) => k.includes("sign-documents"))).toBe(false);
  });

  it("anything a browser could run is sent as an inert download", async () => {
    mem.seed("supabase/feed-photos/evil.html", "<script>alert(1)</script>", "text/html");
    mem.seed("supabase/feed-photos/evil.svg", "<svg onload=alert(1)>", "image/svg+xml");
    for (const name of ["evil.html", "evil.svg"]) {
      const res = await serveMediaRequest(new Request(`${BASE}/object/public/feed-photos/${name}`), "public", { store: mem.store });
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(res.headers.get("content-security-policy")).toMatch(/sandbox/);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("a public route never answers a signed request, and vice versa", async () => {
    mem.seed("supabase/profile-photos/u.jpg", "x", "image/jpeg");
    expect((await serveMediaRequest(new Request(`${BASE}/object/sign/profile-photos/u.jpg?token=x`), "public", { store: mem.store })).status).toBe(400);
    expect((await serveMediaRequest(new Request(`${BASE}/object/public/profile-photos/u.jpg`), "sign", { store: mem.store })).status).toBe(400);
    expect((await serveMediaRequest(new Request(`${BASE}/object/profile-photos/u.jpg`), "public", { store: mem.store })).status).toBe(400);
    expect((await serveMediaRequest(new Request(`${BASE}/object/public/profile-photos/u.jpg`, { method: "POST" }), "public", { store: mem.store })).status).toBe(400);
  });
});

describe("signed URLs (sign-documents, slot-templates) need a live token for that exact object", () => {
  let mem: ReturnType<typeof memoryStore>;
  let db: ReturnType<typeof r2Client>;
  const pdf = new Uint8Array(crypto.randomBytes(2048));
  beforeEach(() => {
    mem = memoryStore();
    db = r2Client(mem.store);
    mem.seed("supabase/sign-documents/cand-1/req 1-signed.pdf", pdf, "application/pdf");
    mem.seed("supabase/sign-documents/cand-2/req-2.pdf", "%PDF other candidate", "application/pdf");
  });
  afterEach(() => { vi.useRealTimers(); });

  it("createSignedUrl hands out { signedUrl } on our route, and the route serves it", async () => {
    const { data, error } = await db.storage.from("sign-documents").createSignedUrl("cand-1/req 1-signed.pdf", 3600);
    expect(error).toBeNull();
    expect(data!.signedUrl.startsWith(`${BASE}/object/sign/sign-documents/cand-1/req%201-signed.pdf?token=`)).toBe(true);
    const res = await serveMediaRequest(new Request(data!.signedUrl), "sign", { store: mem.store });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // Inline, and no sandbox CSP: Chrome will not run its PDF viewer in a sandboxed frame.
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  });

  it("download: true turns it into an attachment", async () => {
    const { data } = await db.storage.from("sign-documents").createSignedUrl("cand-1/req 1-signed.pdf", 60, { download: true });
    const res = await serveMediaRequest(new Request(data!.signedUrl), "sign", { store: mem.store });
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="req_1-signed.pdf"$/);
  });

  it("no token, a tampered token, or another object's token is refused without reading the object", async () => {
    const { data } = await db.storage.from("sign-documents").createSignedUrl("cand-1/req 1-signed.pdf", 3600);
    const good = new URL(data!.signedUrl).searchParams.get("token")!;
    const other = `${BASE}/object/sign/sign-documents/cand-2/req-2.pdf`;
    mem.touched.length = 0;
    const cases = [
      other,
      `${other}?token=`,
      `${other}?token=${good}`,
      `${BASE}/object/sign/sign-documents/cand-1/req%201-signed.pdf?token=${good.slice(0, -3)}abc`,
      `${BASE}/object/sign/slot-templates/cand-1/req%201-signed.pdf?token=${good}`,
    ];
    for (const u of cases) {
      const res = await serveMediaRequest(new Request(u), "sign", { store: mem.store });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "InvalidJWT" });
    }
    expect(mem.touched).toEqual([]);
  });

  it("an expired token is refused as 'jwt expired'", async () => {
    const { data } = await db.storage.from("sign-documents").createSignedUrl("cand-1/req 1-signed.pdf", 60);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61_000 + 1000);
    const res = await serveMediaRequest(new Request(data!.signedUrl), "sign", { store: mem.store });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: "jwt expired" });
  });

  it("createSignedUrl for a missing object is Supabase's 'Object not found'", async () => {
    const { data, error } = await db.storage.from("sign-documents").createSignedUrl("cand-1/missing.pdf", 3600);
    expect(data).toBeNull();
    expect(error).toMatchObject({ message: "Object not found", statusCode: "404" });
  });

  it("createSignedUrls answers per path", async () => {
    const { data, error } = await db.storage.from("sign-documents").createSignedUrls(["cand-2/req-2.pdf", "nope.pdf"], 60);
    expect(error).toBeNull();
    expect(data![0].signedUrl).toContain("/object/sign/sign-documents/cand-2/req-2.pdf?token=");
    expect(data![1]).toMatchObject({ path: "nope.pdf", signedUrl: null });
  });
});

describe("storage token vs download token — one key, never interchangeable", () => {
  it("a storage token is bound to its bucket + path", () => {
    const t = signStorageToken("sign-documents", "a/b.pdf", 60);
    expect(checkStorageToken(t, "sign-documents", "a/b.pdf")).toBe("ok");
    expect(checkStorageToken(t, "sign-documents", "a/c.pdf")).toBe("invalid");
    expect(checkStorageToken(t, "slot-templates", "a/b.pdf")).toBe("invalid");
  });

  it("a storage token is not a download token, and a download token opens no object", () => {
    const storage = signStorageToken("sign-documents", "u1", 60);
    expect(verifyDlToken(storage)).toBeNull();
    const dl = signDlToken("u1", 60);
    expect(checkStorageToken(dl, "sign-documents", "u1")).toBe("invalid");
    expect(verifyDlToken(dl)).toEqual({ userId: "u1" });
  });
});

// ── the app routes ───────────────────────────────────────────────────────────

describe("app routes: 404 until switched on", () => {
  const saved = { b: process.env.STORAGE_BACKEND, m: process.env.STORAGE_MEDIA_ROUTES };
  afterEach(() => {
    process.env.STORAGE_BACKEND = saved.b;
    process.env.STORAGE_MEDIA_ROUTES = saved.m;
    if (saved.b === undefined) delete process.env.STORAGE_BACKEND;
    if (saved.m === undefined) delete process.env.STORAGE_MEDIA_ROUTES;
    setObjectStore(null);
  });

  it("public + sign routes answer nothing while the flag is off, and serve from R2 once on", async () => {
    const pub = await import("../app/api/storage/v1/object/public/[bucket]/[...path]/route");
    const sign = await import("../app/api/storage/v1/object/sign/[bucket]/[...path]/route");
    const mem = memoryStore();
    mem.seed("supabase/profile-photos/u.webp", "RIFFwebp", "image/webp");
    mem.seed("supabase/slot-templates/slot-templates/s.pdf", "%PDF", "application/pdf");
    setObjectStore(mem.store);
    delete process.env.STORAGE_BACKEND;
    delete process.env.STORAGE_MEDIA_ROUTES;

    const pubUrl = `https://www.borivon.com/api/storage/v1/object/public/profile-photos/u.webp`;
    const signUrl = `https://www.borivon.com/api/storage/v1/object/sign/slot-templates/slot-templates/s.pdf?token=${signStorageToken("slot-templates", "slot-templates/s.pdf", 60)}`;
    expect((await pub.GET(new Request(pubUrl))).status).toBe(404);
    expect((await sign.GET(new Request(signUrl))).status).toBe(404);
    expect(mem.touched).toEqual([]);

    process.env.STORAGE_BACKEND = "r2";
    expect((await pub.GET(new Request(pubUrl))).status).toBe(200);
    const s = await sign.GET(new Request(signUrl));
    expect(s.status).toBe(200);
    expect(await s.text()).toBe("%PDF");
    expect((await pub.HEAD(new Request(pubUrl))).status).toBe(200);

    delete process.env.STORAGE_BACKEND;
    process.env.STORAGE_MEDIA_ROUTES = "on";
    expect((await pub.GET(new Request(pubUrl))).status).toBe(200);
  });
});

// ── the three ways to reach R2 ───────────────────────────────────────────────

describe("objectStore backends", () => {
  it("binding store: lists every page with httpMetadata", async () => {
    const calls: unknown[] = [];
    const binding = {
      async list(opts: { prefix?: string; cursor?: string; include?: string[] }) {
        calls.push(opts);
        return opts.cursor
          ? { objects: [{ key: "p/b", size: 2, httpMetadata: { contentType: "image/png" } }], truncated: false }
          : { objects: [{ key: "p/a", size: 1, etag: "e1", uploaded: new Date(0), httpMetadata: { contentType: "image/jpeg" } }], truncated: true, cursor: "c1" };
      },
      async get() { return null; },
      async head() { return null; },
      async put() { return {}; },
      async delete() {},
    } as unknown as R2BindingLike;
    const out = await bindingObjectStore(binding).list("p/");
    expect(out.map((o) => [o.key, o.contentType])).toEqual([["p/a", "image/jpeg"], ["p/b", "image/png"]]);
    expect(calls).toEqual([
      { prefix: "p/", cursor: undefined, include: ["httpMetadata"] },
      { prefix: "p/", cursor: "c1", include: ["httpMetadata"] },
    ]);
  });

  it("REST store: pages by cursor, head is an exact-key match, 404s are 'missing', 429 is retried", async () => {
    const seen: string[] = [];
    let throttled = false;
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      seen.push(`${init?.method ?? "GET"} ${u.pathname.replace(/^.*\/objects/, "")}${u.search}`);
      if (u.pathname.endsWith("/objects")) {
        if (!throttled) { throttled = true; return new Response("slow down", { status: 429 }); }
        const page2 = u.searchParams.get("cursor") === "k2";
        const result = page2
          ? [{ key: "supabase/b/x.pdf-signed", size: 9, http_metadata: { contentType: "application/pdf" } }]
          : [{ key: "supabase/b/x.pdf", size: 4, etag: "abc", last_modified: "2026-09-01T00:00:00Z", http_metadata: { contentType: "application/pdf" } }];
        return Response.json({ success: true, result, result_info: page2 ? {} : { cursor: "k2" } });
      }
      if (u.pathname.endsWith("/missing.pdf")) return new Response("{}", { status: 404 });
      if (init?.method === "DELETE") return new Response("{}", { status: 404 });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/pdf", etag: '"abc"' } });
    }) as typeof fetch;
    const store = restObjectStore({ accountId: "acc", token: "t", bucket: "borivon-files", fetchImpl: fake });

    const listed = await store.list("supabase/b/");
    expect(listed.map((o) => o.key)).toEqual(["supabase/b/x.pdf", "supabase/b/x.pdf-signed"]);
    expect(await store.head("supabase/b/x.pdf")).toMatchObject({ size: 4, contentType: "application/pdf", etag: "abc" });
    expect(await store.head("supabase/b/x.pd")).toBeNull();
    expect(await store.get("supabase/b/missing.pdf")).toBeNull();
    const got = await store.get("supabase/b/with space.pdf");
    expect(got).toMatchObject({ size: 3, contentType: "application/pdf", etag: "abc" });
    await expect(store.delete("supabase/b/gone.pdf")).resolves.toBeUndefined();
    expect(seen.some((s) => s.includes("/supabase/b/with%20space.pdf"))).toBe(true);
    expect(seen.filter((s) => s.startsWith("GET ?")).length).toBeGreaterThanOrEqual(3);
  });
});
