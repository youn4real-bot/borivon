import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { r2StorageBaseUrl } from "@/lib/storage/withR2Storage";
import type { ObjectStore } from "@/lib/storage/objectStore";

/**
 * STORAGE_BACKEND through the REAL lib/supabase.ts service client — the wiring,
 * not the adapter (tests/r2Storage.test.ts covers the adapter's shapes).
 *   • unset (and any typo): the storage client is Supabase's, untouched;
 *   • "r2": every storage-js operation the app's call sites use lands in the
 *     object store, never on the network, and getPublicUrl() stays synchronous
 *     on our own /api/storage/v1 URL;
 *   • "r2" + MAINTENANCE_WRITES="1": uploads and removes are refused before R2;
 *   • no loader (edge): refused, never a silent write to Supabase;
 *   • the loaded path never imports Node's crypto (it broke the edge build once).
 *
 * The call sites (grep `.storage` in app/ and lib/) use: createBucket; upload of
 * a Buffer, Uint8Array or ArrayBuffer with upsert true/false and cacheControl;
 * download; remove; list with limit + search; createSignedUrl; getPublicUrl.
 * createSignedUrls is covered too.
 */

const SB = "https://p.supabase.co";
const OURS = "https://www.borivon.com/api/storage/v1";

function network() {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${url.replace(SB, "")}`);
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, f };
}

function memoryStore() {
  const map = new Map<string, { body: Uint8Array; contentType: string }>();
  const touched: string[] = [];
  const head = (k: string) => {
    const e = map.get(k);
    return e ? { size: e.body.length, contentType: e.contentType, uploaded: new Date("2026-09-01T10:00:00Z"), etag: null } : null;
  };
  const store: ObjectStore = {
    async get(k) { touched.push(k); const e = map.get(k); return e ? { ...head(k)!, body: new Uint8Array(e.body) } : null; },
    async head(k) { touched.push(k); return head(k); },
    async put(k, body, contentType) { touched.push(k); map.set(k, { body: new Uint8Array(body), contentType }); },
    async delete(k) { touched.push(k); map.delete(k); },
    async list(prefix) { touched.push(prefix); return [...map.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, ...head(key)! })); },
  };
  const seed = (key: string, text: string, contentType: string) => map.set(key, { body: new TextEncoder().encode(text), contentType });
  return { store, map, touched, seed };
}

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SB);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
  vi.stubEnv("DL_TOKEN_SECRET", "test-storage-switch-secret-ffffffffffffffffffff");
  vi.stubEnv("PUBLIC_BASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const net = network();
  vi.stubGlobal("fetch", net.f);
  const mem = memoryStore();
  // The same module instance the lazily loaded adapter will import after the reset.
  const objectStore = await import("@/lib/storage/objectStore");
  objectStore.setObjectStore(mem.store);
  const mod = await import("@/lib/supabase");
  const { serveMediaRequest } = await import("@/lib/storage/r2StorageFetch");
  return { ...mod, net, mem, serveMediaRequest, reset: () => objectStore.setObjectStore(null) };
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const text = (s: string) => new TextEncoder().encode(s);
const PDF = "%PDF-1.7 switch";

describe("lib/supabase.ts storage: STORAGE_BACKEND unset (or a typo) is today's client", () => {
  it("the service client's storage talks to Supabase and the object store is never asked", async () => {
    for (const value of [undefined, "R2", "r2 ", "supabase", ""]) {
      const s = await load(value === undefined ? {} : { STORAGE_BACKEND: value });
      try {
        const db = s.getServiceSupabase();
        expect(db.storage.from("profile-photos").getPublicUrl("u.jpg").data.publicUrl, String(value)).toBe(`${SB}/storage/v1/object/public/profile-photos/u.jpg`);
        await db.storage.from("sign-documents").upload("c/a.pdf", text(PDF), { contentType: "application/pdf", upsert: true });
        await db.storage.from("sign-documents").download("c/a.pdf");
        expect(s.net.calls, String(value)).toEqual(["POST /storage/v1/object/sign-documents/c/a.pdf", "GET /storage/v1/object/sign-documents/c/a.pdf"]);
        expect(s.mem.touched, String(value)).toEqual([]);
      } finally { s.reset(); }
    }
  });
});

describe("lib/supabase.ts storage: STORAGE_BACKEND=\"r2\"", () => {
  it("every operation the call sites use is answered by the object store, none by the network", async () => {
    const s = await load({ STORAGE_BACKEND: "r2", STORAGE_SUPABASE_MIRROR: "off" });
    try {
      const db = s.getServiceSupabase();

      // Synchronous, before any storage module has been loaded: the photo routes store this value.
      const pub = db.storage.from("profile-photos").getPublicUrl("u1.jpg");
      expect(pub).not.toBeInstanceOf(Promise);
      expect(pub.data.publicUrl).toBe(`${OURS}/object/public/profile-photos/u1.jpg`);

      expect((await db.storage.createBucket("profile-photos", { public: true, fileSizeLimit: 2097152 })).error).toBeNull();

      // Buffer (profile photo), cacheControl, upsert true.
      const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      expect((await db.storage.from("profile-photos").upload("u1.jpg", jpg, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" })).error).toBeNull();
      expect(s.mem.map.get("supabase/profile-photos/u1.jpg")?.contentType).toBe("image/jpeg");

      // ArrayBuffer with upsert false (slot-template archive), then a Uint8Array duplicate refused.
      const first = await db.storage.from("sign-documents").upload("c/req.pdf", text(PDF).buffer, { contentType: "application/pdf", upsert: false });
      expect(first.error).toBeNull();
      expect(first.data?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const dup = await db.storage.from("sign-documents").upload("c/req.pdf", text("other"), { contentType: "application/pdf", upsert: false });
      expect(dup.error?.message).toMatch(/already exists/);

      const dl = await db.storage.from("sign-documents").download("c/req.pdf");
      expect(dl.error).toBeNull();
      expect(new TextDecoder().decode(await dl.data!.arrayBuffer())).toBe(PDF);

      const listed = await db.storage.from("sign-documents").list("c", { limit: 100, search: "req.pdf" });
      expect(listed.error).toBeNull();
      expect(listed.data!.map((o) => o.name)).toEqual(["req.pdf"]);
      expect(listed.data![0].id).toBe(first.data?.id);

      const signed = await db.storage.from("sign-documents").createSignedUrl("c/req.pdf", 3600);
      expect(signed.error).toBeNull();
      expect(signed.data!.signedUrl.startsWith(`${OURS}/object/sign/sign-documents/c/req.pdf?token=`)).toBe(true);
      // The token it carries opens the object through the route's own handler.
      const served = await s.serveMediaRequest(new Request(signed.data!.signedUrl), "sign", { store: s.mem.store });
      expect(served.status).toBe(200);
      expect(await served.text()).toBe(PDF);

      const many = await db.storage.from("sign-documents").createSignedUrls(["c/req.pdf", "c/missing.pdf"], 60);
      expect(many.error).toBeNull();
      expect(many.data![0].signedUrl).toContain(`${OURS}/object/sign/sign-documents/c/req.pdf?token=`);
      expect(many.data![1]).toMatchObject({ path: "c/missing.pdf", signedUrl: null });

      const rm = await db.storage.from("profile-photos").remove(["u1.jpg", "u1.png", "u1.webp"]);
      expect(rm.error).toBeNull();
      expect(rm.data!.map((r) => r.name)).toEqual(["u1.jpg"]);
      expect(s.mem.map.has("supabase/profile-photos/u1.jpg")).toBe(false);

      expect(s.net.calls).toEqual([]);
      // Tables still go through the service client's own fetch: only storage moved.
      await db.from("notifications").select("id");
      expect(s.net.calls).toEqual(["GET /rest/v1/notifications?select=id"]);
    } finally { s.reset(); }
  });

  it("with the mirror at its default, uploads and removes that succeeded on R2 are repeated on Supabase", async () => {
    const s = await load({ STORAGE_BACKEND: "r2" });
    try {
      const db = s.getServiceSupabase();
      const jpg = new Uint8Array([0xff, 0xd8, 0xff, 1]);
      expect((await db.storage.from("feed-photos").upload("post-1.jpg", jpg, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" })).error).toBeNull();
      expect((await db.storage.from("feed-photos").remove(["post-1.jpg"])).error).toBeNull();
      expect(s.mem.map.size).toBe(0);
      expect(s.net.calls).toEqual(["POST /storage/v1/object/feed-photos/post-1.jpg", "DELETE /storage/v1/object/feed-photos"]);
    } finally { s.reset(); }
  });

  it("builds URLs on the same base withR2Storage.ts does, whatever the base vars say", async () => {
    for (const env of [
      { PUBLIC_BASE_URL: "", NEXT_PUBLIC_BASE_URL: "" },
      { PUBLIC_BASE_URL: "https://preview.example/", NEXT_PUBLIC_BASE_URL: "" },
      { PUBLIC_BASE_URL: "", NEXT_PUBLIC_BASE_URL: "https://staging.example" },
      { PUBLIC_BASE_URL: "https://a.example", NEXT_PUBLIC_BASE_URL: "https://b.example" },
    ]) {
      const s = await load({ STORAGE_BACKEND: "r2", ...env });
      try {
        expect(s.getServiceSupabase().storage.from("feed-photos").getPublicUrl("p.jpg").data.publicUrl)
          .toBe(`${r2StorageBaseUrl(env)}/object/public/feed-photos/p.jpg`);
      } finally { s.reset(); }
    }
  });
});

describe("lib/supabase.ts storage: STORAGE_BACKEND=\"r2\" during the write freeze", () => {
  it("an upload or remove is refused before R2 (and before the mirror); reads keep answering", async () => {
    const s = await load({ STORAGE_BACKEND: "r2", MAINTENANCE_WRITES: "1" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      s.mem.seed("supabase/sign-documents/c/old.pdf", PDF, "application/pdf");
      const db = s.getServiceSupabase();

      const up = await db.storage.from("sign-documents").upload("c/new.pdf", text(PDF), { contentType: "application/pdf", upsert: true });
      expect(up.data).toBeNull();
      expect(up.error).toMatchObject({ statusCode: "503", message: "writes are paused for maintenance (MAINTENANCE_WRITES)" });
      const rm = await db.storage.from("sign-documents").remove(["c/old.pdf"]);
      expect(rm.error).toMatchObject({ statusCode: "503" });
      expect([...s.mem.map.keys()]).toEqual(["supabase/sign-documents/c/old.pdf"]);

      expect((await db.storage.from("sign-documents").download("c/old.pdf")).error).toBeNull();
      expect((await db.storage.from("sign-documents").list("c", { limit: 1, search: "old.pdf" })).data!.map((o) => o.name)).toEqual(["old.pdf"]);
      expect((await db.storage.from("sign-documents").createSignedUrl("c/old.pdf", 60)).error).toBeNull();

      expect(s.net.calls).toEqual([]);
    } finally { s.reset(); }
  });
});

describe("lib/supabase.ts storage: where the loader is compiled out", () => {
  it("on the edge runtime the swapped client refuses — nothing written to R2 or Supabase", async () => {
    const s = await load({ STORAGE_BACKEND: "r2", NEXT_RUNTIME: "edge" });
    try {
      const db = s.getServiceSupabase();
      expect(db.storage.from("profile-photos").getPublicUrl("u.jpg").data.publicUrl).toBe(`${OURS}/object/public/profile-photos/u.jpg`);
      const up = await db.storage.from("sign-documents").upload("c/a.pdf", text(PDF), { contentType: "application/pdf", upsert: true });
      expect(up.error).toMatchObject({ statusCode: "500", message: "R2 storage is not reachable from this runtime" });
      expect(s.mem.touched).toEqual([]);
      expect(s.net.calls).toEqual([]);
    } finally { s.reset(); }
  });

  it("lib/supabase.ts reaches lib/storage only through the window- and NEXT_RUNTIME-guarded loader", () => {
    const src = fs.readFileSync("lib/supabase.ts", "utf8");
    const dynamic = [...src.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]).sort();
    expect(dynamic).toEqual(["@/lib/d1/serviceFetch", "@/lib/storage/serviceStorage"]);
    expect(src).toMatch(/typeof window !== "undefined" \? null\s*: process\.env\.NEXT_RUNTIME === "edge" \? null\s*: \(\) => import\("@\/lib\/storage\/serviceStorage"\)/);
  });

  it("nothing the storage loader pulls in imports Node's crypto", () => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(file, "utf8");
      const specs = [
        ...[...src.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]),
        ...[...src.matchAll(/import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]),
      ];
      for (const spec of specs) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^(node:)?crypto$/);
        if (!spec.startsWith("@/")) continue;
        const base = spec.slice(2);
        const hit = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((f) => fs.existsSync(f));
        if (hit) walk(hit);
      }
    };
    walk("lib/storage/serviceStorage.ts");
    expect(seen.has("lib/storage/r2StorageFetch.ts")).toBe(true);
    expect(seen.has("lib/storage/storageToken.ts")).toBe(true);
    expect(seen.has("lib/scopedToken.ts")).toBe(true);
    expect(seen.has("lib/d1/serviceFetch.ts")).toBe(true);
  });
});
