import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ListedObject, ObjectStore } from "../lib/storage/objectStore";

/**
 * The live proof for the storage client production RUNS: lib/supabase.ts
 * getServiceSupabase() with STORAGE_BACKEND="r2" (composeStorage → the lazily
 * loaded lib/storage/serviceStorage.ts → the R2 adapter + the Supabase mirror),
 * against the real R2 bucket — not withR2Storage(), which tests/r2StorageParity
 * drives with its own overrides.
 *
 * Skipped unless RUN_R2_STORAGE_PARITY=1:
 *   RUN_R2_STORAGE_PARITY=1 npx vitest run tests/r2StorageComposeLive.test.ts
 *
 * Safety:
 *   • R2 writes land ONLY under _prep-test/storage/: the store handed to the
 *     adapter prefixes every key it is given, and refuses one it did not expect.
 *     Everything is deleted afterwards and the prefix is asserted empty.
 *   • Supabase is never written to: global fetch is a recording fake for every
 *     non-GET/HEAD to *.supabase.co (the mirror's uploads and removes land in
 *     the recording and are answered with a fake success); GET/HEAD go through,
 *     for the read-only comparisons against live Supabase.
 *
 * Prints sizes, statuses and hash prefixes only — never a real object's path.
 */
const ENABLED = process.env.RUN_R2_STORAGE_PARITY === "1";
const TEST_PREFIX = "_prep-test/storage";
const SITE = "https://www.borivon.com/api/storage/v1";

function loadEnv() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
}

const sha = (b: ArrayBuffer | Uint8Array) => crypto.createHash("sha256").update(new Uint8Array(b)).digest("hex");
const errShape = (e: unknown) => {
  if (!e) return null;
  const x = e as { name?: string; message?: string; status?: number; statusCode?: string };
  return { name: x.name, message: x.message, status: x.status, statusCode: x.statusCode };
};

/** The real R2 store, every key moved under _prep-test/storage/. */
function testPrefixed(inner: ObjectStore): ObjectStore {
  const k = (key: string) => {
    if (!key.startsWith("supabase/")) throw new Error(`unexpected key outside supabase/: ${key.slice(0, 40)}`);
    return `${TEST_PREFIX}/${key}`;
  };
  const back = (o: ListedObject): ListedObject => ({ ...o, key: o.key.slice(TEST_PREFIX.length + 1) });
  return {
    get: (key) => inner.get(k(key)),
    head: (key) => inner.head(k(key)),
    put: (key, body, type) => inner.put(k(key), body, type),
    delete: (key) => inner.delete(k(key)),
    list: async (prefix) => (await inner.list(k(prefix))).map(back),
  };
}

describe.skipIf(!ENABLED)("the production storage client (lib/supabase.ts, STORAGE_BACKEND=r2) against live R2", () => {
  const realFetch = globalThis.fetch;
  const mirrored: string[] = [];
  const supabaseWritesLeaked: string[] = [];
  let raw: ObjectStore;
  let db: SupabaseClient;
  let live: SupabaseClient;
  let signRoute: typeof import("../app/api/storage/v1/object/sign/[bucket]/[...path]/route");
  let publicRoute: typeof import("../app/api/storage/v1/object/public/[bucket]/[...path]/route");
  let supabaseUrl: string;

  beforeAll(async () => {
    loadEnv();
    supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    expect(supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN).toBeTruthy();

    vi.resetModules();
    vi.stubEnv("STORAGE_BACKEND", "r2");
    vi.stubEnv("DATA_BACKEND", "supabase");
    vi.stubEnv("MAINTENANCE_WRITES", "0");
    vi.stubEnv("SHADOW_D1_RATE", "0");
    vi.stubEnv("STORAGE_SUPABASE_MIRROR", ""); // the mirror ON, as in production — its writes land in the recording below
    vi.stubEnv("PUBLIC_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");

    // The recording fake for Supabase: GET/HEAD pass (read-only), anything else is
    // recorded — a storage write is the mirror and gets a fake success, any other
    // write is a leak and fails the suite.
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET" || method === "HEAD") return realFetch(input as RequestInfo, init);
      // The R2 store has its own fetch (realFetch); a write reaching this one is only ever the mirror.
      const m = /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/([^/]+)(?:\/(.*))?$/.exec(url.split("?")[0]);
      if (!m) { supabaseWritesLeaked.push(`${method} ${url.replace(supabaseUrl, "")}`); throw new Error("refused: a write that is not the storage mirror"); }
      if (method === "DELETE") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { prefixes?: string[] };
        mirrored.push(`remove ${m[1]} ${(body.prefixes ?? []).join("|")}`);
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      const bytes = init?.body instanceof Uint8Array || init?.body instanceof ArrayBuffer ? new Uint8Array(init.body as ArrayBuffer) : null;
      const headers = new Headers(init?.headers);
      mirrored.push(`upload ${m[1]}/${decodeURI(m[2] ?? "")} ${bytes ? `${bytes.length}B ${sha(bytes).slice(0, 10)}` : typeof init?.body} ${headers.get("content-type")} ${headers.get("cache-control")} upsert=${headers.get("x-upsert")}`);
      return new Response(JSON.stringify({ Id: "fake", Key: `${m[1]}/${m[2]}` }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);

    const os = await import("../lib/storage/objectStore");
    raw = os.restObjectStore({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID!, token: process.env.CLOUDFLARE_API_TOKEN!, bucket: process.env.R2_BUCKET || "borivon-files", fetchImpl: realFetch });
    os.setObjectStore(testPrefixed(raw));
    db = (await import("../lib/supabase")).getServiceSupabase();
    signRoute = await import("../app/api/storage/v1/object/sign/[bucket]/[...path]/route");
    publicRoute = await import("../app/api/storage/v1/object/public/[bucket]/[...path]/route");

    // A plain read-only client on live Supabase for the shape comparisons: refuses any write.
    live = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
      global: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const method = (init?.method ?? "GET").toUpperCase();
          if (method !== "GET" && method !== "HEAD") throw new Error(`read-only client refused ${method}`);
          return realFetch(input as RequestInfo, init);
        }) as typeof fetch,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (raw) for (const o of await raw.list(`${TEST_PREFIX}/`)) await raw.delete(o.key);
    if (raw) expect(await raw.list(`${TEST_PREFIX}/`)).toEqual([]);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    const os = await import("../lib/storage/objectStore");
    os.setObjectStore(null);
    expect(supabaseWritesLeaked).toEqual([]);
  }, 120_000);

  it("is the swapped client: URLs on our domain, nothing to Supabase but the recorded mirror", () => {
    expect(db.storage.from("profile-photos").getPublicUrl("u-dbg.jpg").data.publicUrl).toBe(`${SITE}/object/public/profile-photos/u-dbg.jpg`);
  });

  const NAMES = [
    "dbg/Prüfung Ärzte's 📄 (1).pdf",
    "dbg/ä ö ü ß + & = , ; @ $ ! ~ * [x] {y}.pdf",
    "dbg/日本語/nested/deep/fichier élève.pdf",
  ];

  it("odd names (umlaut, space, apostrophe, emoji, +&=,;@$!~*[]{}, nested): upload, exact R2 key, download, exists, list, sign + serve, remove — mirrored with the same path", async () => {
    const docs = db.storage.from("sign-documents");
    for (const name of NAMES) {
      const bytes = new Uint8Array(crypto.randomBytes(1500));
      const up = await docs.upload(name, bytes, { contentType: "application/pdf", upsert: false });
      expect(up.error, name).toBeNull();
      expect(up.data?.path).toBe(name);
      expect(up.data?.fullPath).toBe(`sign-documents/${name}`);
      // The exact key, not an encoded or truncated one.
      expect((await raw.head(`${TEST_PREFIX}/supabase/sign-documents/${name}`))?.size, name).toBe(1500);

      const dl = await docs.download(name);
      expect(dl.error, name).toBeNull();
      expect(sha(await dl.data!.arrayBuffer())).toBe(sha(bytes));
      expect((await docs.exists(name)).data).toBe(true);

      const signed = await docs.createSignedUrl(name, 120);
      expect(signed.error, name).toBeNull();
      const res = await signRoute.GET(new Request(signed.data!.signedUrl));
      expect(res.status, name).toBe(200);
      expect(res.headers.get("access-control-allow-origin"), name).toBe("*"); // pdf.js on the apex
      expect(sha(await res.arrayBuffer()), name).toBe(sha(bytes));
      const many = await docs.createSignedUrls([name], 120);
      expect(many.data?.[0].error).toBeNull();
      expect((await signRoute.GET(new Request(many.data![0].signedUrl!))).status).toBe(200);
    }
    const listed = await docs.list("dbg");
    expect(listed.error).toBeNull();
    // Supabase's order: lower-cased code points — "p" < "ä" < "日".
    expect(listed.data?.map((r) => [r.name, r.id === null ? "folder" : r.metadata?.size])).toEqual([
      ["Prüfung Ärzte's 📄 (1).pdf", 1500],
      ["ä ö ü ß + & = , ; @ $ ! ~ * [x] {y}.pdf", 1500],
      ["日本語", "folder"],
    ]);
    const nested = await docs.list("dbg/日本語/nested/deep");
    expect(nested.data?.map((r) => r.name)).toEqual(["fichier élève.pdf"]);

    const rm = await docs.remove(NAMES);
    expect(rm.error).toBeNull();
    expect(rm.data?.map((r) => r.name).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) expect((await docs.exists(name)).data, name).toBe(false);
    for (const name of NAMES) expect(mirrored.some((m) => m.startsWith(`upload sign-documents/${name} 1500B`)), name).toBe(true);
    expect(mirrored).toContain(`remove sign-documents ${NAMES.join("|")}`);
  }, 300_000);

  it("zero-byte objects: raw and Blob upload, download, list, signed serve — an empty file stays an empty file", async () => {
    const docs = db.storage.from("sign-documents");
    expect((await docs.upload("dbg/empty.pdf", new Uint8Array(0), { contentType: "application/pdf", upsert: true })).error).toBeNull();
    expect((await docs.upload("dbg/empty-blob.pdf", new Blob([], { type: "application/pdf" }), { upsert: true })).error).toBeNull();
    for (const p of ["dbg/empty.pdf", "dbg/empty-blob.pdf"]) {
      const dl = await docs.download(p);
      expect(dl.error, p).toBeNull();
      expect(dl.data!.size, p).toBe(0);
      expect(dl.data!.type, p).toBe("application/pdf");
      const s = await docs.createSignedUrl(p, 60);
      const res = await signRoute.GET(new Request(s.data!.signedUrl));
      expect(res.status, p).toBe(200);
      expect((await res.arrayBuffer()).byteLength, p).toBe(0);
    }
    const listed = await docs.list("dbg", { search: "empty" });
    expect(listed.data?.map((r) => [r.name, r.metadata?.size, r.metadata?.mimetype])).toEqual([
      ["empty-blob.pdf", 0, "application/pdf"],
      ["empty.pdf", 0, "application/pdf"],
    ]);
    expect((await docs.remove(["dbg/empty.pdf", "dbg/empty-blob.pdf"])).data).toHaveLength(2);
  }, 120_000);

  it("a 21 MB PDF, raw and as a Blob (multipart): stored whole, downloaded and served byte-identical", async () => {
    const docs = db.storage.from("sign-documents");
    const big = new Uint8Array(crypto.randomBytes(21 * 1024 * 1024));
    let t = Date.now();
    expect((await docs.upload("dbg/big.pdf", big, { contentType: "application/pdf", upsert: true })).error).toBeNull();
    const upRaw = Date.now() - t;
    t = Date.now();
    expect((await docs.upload("dbg/big-blob.pdf", new Blob([big], { type: "application/pdf" }), { upsert: true })).error).toBeNull();
    const upBlob = Date.now() - t;
    for (const p of ["dbg/big.pdf", "dbg/big-blob.pdf"]) {
      expect((await raw.head(`${TEST_PREFIX}/supabase/sign-documents/${p}`))?.size, p).toBe(big.length);
      const dl = await docs.download(p);
      expect(sha(await dl.data!.arrayBuffer()), p).toBe(sha(big));
      const s = await docs.createSignedUrl(p, 60);
      const res = await signRoute.GET(new Request(s.data!.signedUrl));
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(sha(await res.arrayBuffer()), p).toBe(sha(big));
    }
    console.log(`[r2-compose] 21 MB upload: raw ${upRaw} ms, multipart ${upBlob} ms; mirror got ${mirrored.filter((m) => m.includes("/dbg/big")).length} uploads`);
    expect(mirrored.filter((m) => m.startsWith("upload sign-documents/dbg/big.pdf ") && m.includes(`${big.length}B`))).toHaveLength(1);
    expect((await docs.remove(["dbg/big.pdf", "dbg/big-blob.pdf"])).data).toHaveLength(2);
  }, 300_000);

  it("content types: PDF and JPEG render inline, HEIC is an inert download; the public buckets refuse HEIC and oversize like Supabase", async () => {
    const docs = db.storage.from("sign-documents");
    const cases: [string, string, string, string | null][] = [
      ["dbg/t.pdf", "application/pdf", "application/pdf", null],
      ["dbg/t.jpg", "image/jpeg", "image/jpeg", null],
      ["dbg/t.heic", "image/heic", "application/octet-stream", 'attachment; filename="t.heic"'],
    ];
    for (const [p, type, served, disposition] of cases) {
      expect((await docs.upload(p, new Uint8Array(crypto.randomBytes(64)), { contentType: type, upsert: true })).error).toBeNull();
      expect((await docs.download(p)).data!.type, p).toBe(type);
      const res = await signRoute.GET(new Request((await docs.createSignedUrl(p, 60)).data!.signedUrl));
      expect([res.headers.get("content-type"), res.headers.get("content-disposition")], p).toEqual([served, disposition]);
    }
    expect((await docs.remove(cases.map((c) => c[0]))).data).toHaveLength(3);
    const heic = await db.storage.from("profile-photos").upload("u-dbg.heic", new Uint8Array(64), { contentType: "image/heic", upsert: true });
    expect(heic.error?.statusCode).toBe("415");
    const huge = await db.storage.from("feed-photos").upload("p-dbg.jpg", new Uint8Array(5 * 1024 * 1024 + 1), { contentType: "image/jpeg", upsert: true });
    expect(huge.error?.statusCode).toBe("413");
    expect(mirrored.some((m) => m.includes("u-dbg.heic") || m.includes("p-dbg.jpg"))).toBe(false);
  }, 120_000);

  it("signed URLs: expire on time, HEAD answers without a body, Range and If-None-Match get the whole object (no 206/304)", async () => {
    const docs = db.storage.from("sign-documents");
    const bytes = new Uint8Array(crypto.randomBytes(4000));
    expect((await docs.upload("dbg/exp.pdf", bytes, { contentType: "application/pdf", upsert: true })).error).toBeNull();
    const short = (await docs.createSignedUrl("dbg/exp.pdf", 1)).data!.signedUrl;
    const long = (await docs.createSignedUrl("dbg/exp.pdf", 600)).data!.signedUrl;

    const head = await signRoute.HEAD(new Request(long, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    const ranged = await signRoute.GET(new Request(long, { headers: { Range: "bytes=0-99" } }));
    expect(ranged.status).toBe(200);
    expect((await ranged.arrayBuffer()).byteLength).toBe(4000);
    const etag = ranged.headers.get("etag");
    expect(etag).toBeTruthy();
    expect((await signRoute.GET(new Request(long, { headers: { "If-None-Match": etag! } }))).status).toBe(200);

    await new Promise((r) => setTimeout(r, 2100));
    const expired = await signRoute.GET(new Request(short));
    expect([expired.status, (await expired.json()).message]).toEqual([400, "jwt expired"]);
    expect((await signRoute.GET(new Request(long))).status).toBe(200);
    expect((await docs.remove(["dbg/exp.pdf"])).data).toHaveLength(1);
  }, 120_000);

  it("a profile photo the way the photo routes store it: upload, getPublicUrl?t=, served a year-immutable image/jpeg", async () => {
    const photos = db.storage.from("profile-photos");
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...crypto.randomBytes(800)]);
    expect((await photos.upload("u-dbg.jpg", jpg, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" })).error).toBeNull();
    const stored = `${photos.getPublicUrl("u-dbg.jpg").data.publicUrl}?t=${Date.now()}`;
    expect(stored.startsWith(`${SITE}/object/public/profile-photos/u-dbg.jpg?t=`)).toBe(true);
    const res = await publicRoute.GET(new Request(stored));
    expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]).toEqual([200, "image/jpeg", "public, max-age=31536000, immutable"]);
    // The apex borivon.com fetches these www URLs cross-origin (admin photo download).
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(sha(await res.arrayBuffer())).toBe(sha(jpg));
    expect(mirrored.filter((m) => m.startsWith("upload profile-photos/u-dbg.jpg "))).toEqual([`upload profile-photos/u-dbg.jpg 804B ${sha(jpg).slice(0, 10)} image/jpeg max-age=31536000 upsert=true`]);
    expect((await photos.remove(["u-dbg.jpg", "u-dbg.png", "u-dbg.webp"])).data).toHaveLength(1);
    expect(mirrored).toContain("remove profile-photos u-dbg.jpg|u-dbg.png|u-dbg.webp");
  }, 120_000);

  it("read-only shapes vs live Supabase for missing objects with odd names: download error, exists, public GET", async () => {
    for (const name of ["__dbg-storage__/missing Ärzte's 📄.pdf", "__dbg-storage__/plain-missing.pdf"]) {
      const [a, c] = await Promise.all([live.storage.from("sign-documents").download(name), db.storage.from("sign-documents").download(name)]);
      console.log(`[r2-compose] missing download ${name.includes("Ä") ? "(odd name)" : "(plain)"}: live ${JSON.stringify(errShape(a.error))} / r2 ${JSON.stringify(errShape(c.error))}`);
      if (!name.includes("Ä")) expect(errShape(c.error)).toEqual(errShape(a.error));
      const [ea, ec] = await Promise.all([live.storage.from("sign-documents").exists(name), db.storage.from("sign-documents").exists(name)]);
      expect([ea.data, ec.data]).toEqual([false, false]);
    }
  }, 60_000);
});
