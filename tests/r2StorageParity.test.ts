import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ObjectStore } from "../lib/storage/objectStore";
import { INLINE_TYPES } from "../lib/storage/r2StorageFetch";

/**
 * The live proof for "files from R2 instead of Supabase Storage": the SAME
 * storage-js call against live Supabase and against the R2 adapter, on the real
 * objects storage/copy-to-r2.mjs copied, demanding identical bytes (sha256) and
 * identical response shapes.
 *
 * Skipped unless RUN_R2_STORAGE_PARITY=1, so `npm test` stays offline:
 *   RUN_R2_STORAGE_PARITY=1 npx vitest run tests/r2StorageParity.test.ts
 *
 * Supabase side is READ-ONLY: listBuckets, list, download, exists, createSignedUrl
 * (mints a URL, writes nothing), and GETs of public / signed URLs, plus two
 * selects of stored photo URLs. The R2 side reads the real `supabase/` copy and
 * WRITES only under _prep-test/storage/, removing everything it wrote.
 *
 * Prints counts and hash prefixes only — never a path or a file's content.
 */
const ENABLED = process.env.RUN_R2_STORAGE_PARITY === "1";
const TEST_PREFIX = "_prep-test/storage";
const SITE_STORAGE = "https://www.borivon.com/api/storage/v1";
const PUBLIC = ["profile-photos", "feed-photos"];

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

type Row = { name: string; id: string | null; metadata: { size?: number; mimetype?: string } | null };
type Folder = { bucket: string; prefix: string };
type FileRef = { bucket: string; path: string; size: number };

describe.skipIf(!ENABLED)("R2 storage adapter answers like Supabase Storage (live)", () => {
  let url: string;
  let key: string;
  let live: SupabaseClient;
  let copy: SupabaseClient;
  let scratch: SupabaseClient;
  let store: ObjectStore;
  let serveMediaRequest: typeof import("../lib/storage/r2StorageFetch").serveMediaRequest;
  let publicRoute: typeof import("../app/api/storage/v1/object/public/[bucket]/[...path]/route");
  let signRoute: typeof import("../app/api/storage/v1/object/sign/[bucket]/[...path]/route");
  const savedBackend = process.env.STORAGE_BACKEND;

  const buckets: { id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null }[] = [];
  const files: FileRef[] = [];
  const stats = { folders: 0, listRows: 0, staleLive: 0, staleCopy: 0, downloads: 0, signed: 0, publicUrls: 0, storedUrls: 0, storedMissing: 0 };

  beforeAll(async () => {
    loadEnv();
    url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    expect(url && key && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN).toBeTruthy();
    // Exercise the runtime's own store selection (Node + CLOUDFLARE_* → the R2 REST API),
    // the same one the routes pick up below.
    const os = await import("../lib/storage/objectStore");
    const picked = await os.defaultObjectStore();
    expect(picked).not.toBeNull();
    store = picked!;
    ({ serveMediaRequest } = await import("../lib/storage/r2StorageFetch"));
    const { withR2Storage } = await import("../lib/storage/withR2Storage");
    publicRoute = await import("../app/api/storage/v1/object/public/[bucket]/[...path]/route");
    signRoute = await import("../app/api/storage/v1/object/sign/[bucket]/[...path]/route");
    process.env.STORAGE_BACKEND = "r2"; // the routes answer only when switched on

    live = createClient(url, key);
    copy = withR2Storage(createClient(url, key), { force: true, store, baseUrl: SITE_STORAGE });
    scratch = withR2Storage(createClient(url, key), { force: true, store, baseUrl: SITE_STORAGE, prefix: TEST_PREFIX });
  });

  afterAll(async () => {
    if (savedBackend === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = savedBackend;
    if (store) for (const o of await store.list(`${TEST_PREFIX}/`)) await store.delete(o.key);
  });

  it("bucket rules the adapter enforces are the live ones", async () => {
    const { data, error } = await live.storage.listBuckets();
    expect(error).toBeNull();
    buckets.push(...(data as typeof buckets));
    const { PUBLIC_BUCKETS } = await import("../lib/storage/r2StorageFetch");
    expect(buckets.filter((b) => b.public).map((b) => b.id).sort()).toEqual([...PUBLIC_BUCKETS].sort());
    // Upload limits: a probe upload just over each live limit / of a disallowed type is refused on the R2 side.
    for (const b of buckets.filter((x) => x.file_size_limit || x.allowed_mime_types)) {
      const okType = b.allowed_mime_types?.[0] ?? "application/octet-stream";
      if (b.file_size_limit) {
        const over = await scratch.storage.from(b.id).upload("limit-probe.bin", new Uint8Array(b.file_size_limit + 1), { contentType: okType, upsert: true });
        expect(over.error?.statusCode, `${b.id} size limit`).toBe("413");
        const under = await scratch.storage.from(b.id).upload("limit-probe.bin", new Uint8Array(16), { contentType: okType, upsert: true });
        expect(under.error, `${b.id} under the limit`).toBeNull();
      }
      if (b.allowed_mime_types) {
        const bad = await scratch.storage.from(b.id).upload("type-probe.bin", new Uint8Array(4), { contentType: "text/html", upsert: true });
        expect(bad.error?.statusCode, `${b.id} type`).toBe("415");
      }
    }
    await scratch.storage.from("profile-photos").remove(["limit-probe.bin"]);
    await scratch.storage.from("feed-photos").remove(["limit-probe.bin"]);
  }, 120_000);

  it("list: every folder of every bucket answers the same rows, in the same order", async () => {
    const norm = (rows: Row[]) => rows.map((r) => (r.id === null ? { name: r.name, folder: true } : { name: r.name, size: r.metadata?.size, mimetype: r.metadata?.mimetype }));
    const listAll = async (db: SupabaseClient, f: Folder) => {
      const out: Row[] = [];
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await db.storage.from(f.bucket).list(f.prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
        expect(error, `list error (${f.bucket})`).toBeNull();
        out.push(...((data ?? []) as Row[]));
        if (!data || data.length < 100) return out;
      }
    };
    const queue: Folder[] = buckets.map((b) => ({ bucket: b.id, prefix: "" }));
    while (queue.length) {
      const f = queue.shift()!;
      const [a, b] = await Promise.all([listAll(live, f), listAll(copy, f)]);
      stats.folders++;
      stats.listRows += a.length;
      // An object added to / removed from Supabase after the copy ran is the copy being
      // stale, not the adapter being wrong: count it, compare the rest exactly.
      const inB = new Set(b.map((r) => r.name));
      const inA = new Set(a.map((r) => r.name));
      stats.staleLive += a.filter((r) => !inB.has(r.name)).length;
      stats.staleCopy += b.filter((r) => !inA.has(r.name)).length;
      expect(norm(b.filter((r) => inA.has(r.name))), `folder rows (${f.bucket})`).toEqual(norm(a.filter((r) => inB.has(r.name))));
      for (const r of a) {
        if (!inB.has(r.name)) continue;
        const path = `${f.prefix ? `${f.prefix}/` : ""}${r.name}`;
        if (r.id === null) queue.push({ bucket: f.bucket, prefix: path });
        else files.push({ bucket: f.bucket, path, size: r.metadata?.size ?? 0 });
      }
    }
    console.log(`[r2-parity] list: ${buckets.length} buckets, ${stats.folders} folders, ${stats.listRows} rows, ${files.length} files; stale copy: ${stats.staleLive} only-in-Supabase, ${stats.staleCopy} only-in-R2`);
    expect(files.length).toBeGreaterThan(0);
  }, 600_000);

  it("list with search (the slot-template existence + ETag check) finds the same template", async () => {
    const templates = files.filter((f) => f.bucket === "slot-templates" && /^slot-templates\/[^/]+\.pdf$/.test(f.path)).slice(0, 5);
    for (const t of templates) {
      const name = t.path.split("/")[1];
      const [a, b] = await Promise.all([
        live.storage.from("slot-templates").list("slot-templates", { limit: 1, search: name }),
        copy.storage.from("slot-templates").list("slot-templates", { limit: 1, search: name }),
      ]);
      expect(b.data?.map((r) => [r.name, r.metadata?.size])).toEqual(a.data?.map((r) => [r.name, r.metadata?.size]));
    }
    const missing = "00000000-0000-4000-8000-000000000000.pdf";
    const [a, b] = await Promise.all([
      live.storage.from("slot-templates").list("slot-templates", { limit: 1, search: missing }),
      copy.storage.from("slot-templates").list("slot-templates", { limit: 1, search: missing }),
    ]);
    expect(b.data).toEqual(a.data);
  }, 120_000);

  /** Up to `n` files per bucket, spread across the listing, capped in size. */
  const sample = (bucket: string, n: number) => {
    const pool = files.filter((f) => f.bucket === bucket && f.size <= 8 * 1024 * 1024);
    if (pool.length <= n) return pool;
    return Array.from({ length: n }, (_, i) => pool[Math.floor((i * pool.length) / n)]);
  };

  it("download: same bytes (sha256), same size, same type — every bucket", async () => {
    for (const b of buckets) {
      for (const f of sample(b.id, 8)) {
        const [a, c] = await Promise.all([live.storage.from(f.bucket).download(f.path), copy.storage.from(f.bucket).download(f.path)]);
        expect(a.error).toBeNull();
        expect(c.error).toBeNull();
        const [ab, cb] = await Promise.all([a.data!.arrayBuffer(), c.data!.arrayBuffer()]);
        expect(sha(cb), `bytes (${f.bucket})`).toBe(sha(ab));
        expect(c.data!.size).toBe(a.data!.size);
        expect(c.data!.type, `type (${f.bucket})`).toBe(a.data!.type);
        stats.downloads++;
      }
      const missing = "__r2-parity__/does-not-exist.pdf";
      const [a, c] = await Promise.all([live.storage.from(b.id).download(missing), copy.storage.from(b.id).download(missing)]);
      expect(c.data).toBeNull();
      expect(errShape(c.error), `missing download error (${b.id})`).toEqual(errShape(a.error));
      const [ea, ec] = await Promise.all([live.storage.from(b.id).exists(missing), copy.storage.from(b.id).exists(missing)]);
      expect(ec.data).toBe(ea.data);
    }
    const f = files[0];
    const [ea, ec] = await Promise.all([live.storage.from(f.bucket).exists(f.path), copy.storage.from(f.bucket).exists(f.path)]);
    expect([ea.data, ec.data]).toEqual([true, true]);
    console.log(`[r2-parity] download: ${stats.downloads} objects byte-identical`);
  }, 600_000);

  it("createSignedUrl: our URL, served by our route, gives the bytes Supabase's signed URL gives", async () => {
    for (const b of buckets.filter((x) => !x.public)) {
      for (const f of sample(b.id, 3)) {
        const [a, c] = await Promise.all([live.storage.from(f.bucket).createSignedUrl(f.path, 120), copy.storage.from(f.bucket).createSignedUrl(f.path, 120)]);
        expect(a.error).toBeNull();
        expect(c.error).toBeNull();
        expect(Object.keys(c.data!)).toEqual(Object.keys(a.data!));
        expect(c.data!.signedUrl.startsWith(`${SITE_STORAGE}/object/sign/`)).toBe(true);
        const [ra, rc] = await Promise.all([fetch(a.data!.signedUrl), signRoute.GET(new Request(c.data!.signedUrl))]);
        expect(rc.status).toBe(ra.status);
        // Same type for anything a browser renders; anything else is deliberately an
        // inert download on our origin (Supabase served it from supabase.co, where a
        // script in it could not reach the portal).
        const liveType = (ra.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        expect(rc.headers.get("content-type"), `signed type (${f.bucket})`).toBe(INLINE_TYPES.has(liveType) ? liveType : "application/octet-stream");
        expect(sha(await rc.arrayBuffer()), `signed bytes (${f.bucket})`).toBe(sha(await ra.arrayBuffer()));
        stats.signed++;

        // Refusals, in Supabase's own words (status + code; the JWT library's message differs).
        const bareLive = `${url}/storage/v1/object/sign/${f.bucket}/${f.path}`;
        const bareOurs = `${SITE_STORAGE}/object/sign/${f.bucket}/${f.path}`;
        const [na, nc] = await Promise.all([fetch(encodeURI(bareLive)), signRoute.GET(new Request(encodeURI(bareOurs)))]);
        expect([nc.status, await nc.json()]).toEqual([na.status, await na.json()]);
        const [ba, bc] = await Promise.all([fetch(`${encodeURI(bareLive)}?token=bad`), signRoute.GET(new Request(`${encodeURI(bareOurs)}?token=bad`))]);
        const [bja, bjc] = [await ba.json(), await bc.json()];
        expect([bc.status, bjc.statusCode, bjc.error, bjc.code]).toEqual([ba.status, bja.statusCode, bja.error, bja.code]);
        // Private objects are not public, on either side.
        const [pa, pc] = await Promise.all([fetch(encodeURI(`${url}/storage/v1/object/public/${f.bucket}/${f.path}`)), publicRoute.GET(new Request(encodeURI(`${SITE_STORAGE}/object/public/${f.bucket}/${f.path}`)))]);
        expect([pc.status, await pc.json()]).toEqual([pa.status, await pa.json()]);
      }
      const missing = "__r2-parity__/does-not-exist.pdf";
      const [a, c] = await Promise.all([live.storage.from(b.id).createSignedUrl(missing, 60), copy.storage.from(b.id).createSignedUrl(missing, 60)]);
      expect(errShape(c.error), `missing sign error (${b.id})`).toEqual(errShape(a.error));
    }
    console.log(`[r2-parity] signed URLs: ${stats.signed} served byte-identical; refusals match`);
  }, 600_000);

  it("getPublicUrl: our route serves the bytes Supabase's public URL serves", async () => {
    for (const bucket of PUBLIC) {
      for (const f of sample(bucket, 5)) {
        const a = live.storage.from(bucket).getPublicUrl(f.path).data.publicUrl;
        const c = copy.storage.from(bucket).getPublicUrl(f.path).data.publicUrl;
        expect(c).toBe(a.replace(`${url}/storage/v1`, SITE_STORAGE));
        const t = `?t=${Date.now()}`;
        const [ra, rc] = await Promise.all([fetch(a + t), publicRoute.GET(new Request(c + t))]);
        expect(rc.status).toBe(200);
        expect(ra.status).toBe(200);
        expect(rc.headers.get("content-type")).toBe(ra.headers.get("content-type"));
        expect(sha(await rc.arrayBuffer()), `public bytes (${bucket})`).toBe(sha(await ra.arrayBuffer()));
        stats.publicUrls++;
      }
      const miss = `${bucket}/__r2-parity__.jpg`;
      const [ma, mc] = await Promise.all([fetch(`${url}/storage/v1/object/public/${miss}`), publicRoute.GET(new Request(`${SITE_STORAGE}/object/public/${miss}`))]);
      expect([mc.status, await mc.json()]).toEqual([ma.status, await ma.json()]);
    }
    console.log(`[r2-parity] public URLs: ${stats.publicUrls} served byte-identical`);
  }, 300_000);

  it("stored photo URLs (candidate_profiles.profile_photo, feed_posts.image_url) all resolve in R2 after a prefix swap", async () => {
    const [p, fp] = await Promise.all([
      live.from("candidate_profiles").select("profile_photo").not("profile_photo", "is", null),
      live.from("feed_posts").select("image_url").not("image_url", "is", null),
    ]);
    expect(p.error).toBeNull();
    expect(fp.error).toBeNull();
    const urls = [
      ...((p.data ?? []) as { profile_photo: string }[]).map((r) => r.profile_photo),
      ...((fp.data ?? []) as { image_url: string }[]).map((r) => r.image_url),
    ];
    const livePrefix = `${url}/storage/v1/object/public/`;
    const kinds = { supabaseStorage: 0, ownRoute: 0, dataUrl: 0, other: 0 };
    const have = new Set(files.map((f) => `${f.bucket}/${f.path}`));
    let fetched = 0;
    for (const u of urls) {
      if (u.startsWith(livePrefix)) {
        kinds.supabaseStorage++;
        const rel = decodeURI(u.slice(livePrefix.length).split("?")[0]);
        if (!have.has(rel)) { stats.storedMissing++; continue; }
        stats.storedUrls++;
        if (fetched < 3) {
          const ours = u.replace(`${url}/storage/v1`, SITE_STORAGE);
          const [ra, rc] = await Promise.all([fetch(u), publicRoute.GET(new Request(ours))]);
          expect(rc.status).toBe(ra.status);
          expect(sha(await rc.arrayBuffer())).toBe(sha(await ra.arrayBuffer()));
          fetched++;
        }
      } else if (u.startsWith(SITE_STORAGE)) kinds.ownRoute++;
      else if (u.startsWith("data:")) kinds.dataUrl++;
      else kinds.other++;
    }
    console.log(`[r2-parity] stored URLs: ${JSON.stringify(kinds)}; ${stats.storedUrls} present in R2, ${stats.storedMissing} not in the copy; ${fetched} fetched byte-identical via the swapped URL`);
    expect(stats.storedMissing, "stored photo URLs whose object is not in R2 — re-run storage/copy-to-r2.mjs").toBe(0);
  }, 300_000);

  it("writes on the R2 side (under _prep-test/storage/): upload, duplicate, upsert, list, sign, public, remove — then nothing left", async () => {
    const pdfA = new Uint8Array(crypto.randomBytes(3000));
    const pdfB = new Uint8Array(crypto.randomBytes(3100));
    const docs = scratch.storage.from("sign-documents");

    expect((await scratch.storage.createBucket("sign-documents", { public: false })).error).toBeNull();

    const up = await docs.upload("cand-x/req-x.pdf", pdfA, { contentType: "application/pdf", upsert: false });
    expect(up.error).toBeNull();
    expect(up.data).toMatchObject({ path: "cand-x/req-x.pdf", fullPath: "sign-documents/cand-x/req-x.pdf" });
    expect((await store.head(`${TEST_PREFIX}/sign-documents/cand-x/req-x.pdf`))?.size).toBe(3000);
    expect(await store.head("supabase/sign-documents/cand-x/req-x.pdf")).toBeNull();

    const dup = await docs.upload("cand-x/req-x.pdf", pdfB, { contentType: "application/pdf", upsert: false });
    expect(errShape(dup.error)).toEqual({ name: "StorageApiError", message: "The resource already exists", status: 400, statusCode: "409" });

    const ups = await docs.upload("cand-x/req-x.pdf", pdfB, { contentType: "application/pdf", upsert: true });
    expect(ups.error).toBeNull();
    expect(ups.data?.id).toBe(up.data?.id);
    const dl = await docs.download("cand-x/req-x.pdf");
    expect(sha(await dl.data!.arrayBuffer())).toBe(sha(pdfB));
    expect(dl.data!.type).toBe("application/pdf");

    const blob = await docs.upload("cand-x/blob.pdf", new Blob([pdfA], { type: "application/pdf" }), { upsert: true });
    expect(blob.error).toBeNull();

    const listed = await docs.list("cand-x");
    expect(listed.data?.map((r) => [r.name, r.metadata?.size, r.metadata?.mimetype])).toEqual([
      ["blob.pdf", 3000, "application/pdf"],
      ["req-x.pdf", 3100, "application/pdf"],
    ]);

    const signed = await docs.createSignedUrl("cand-x/req-x.pdf", 120);
    expect(signed.error).toBeNull();
    const served = await serveMediaRequest(new Request(signed.data!.signedUrl), "sign", { store, prefix: TEST_PREFIX });
    expect(served.status).toBe(200);
    expect(sha(await served.arrayBuffer())).toBe(sha(pdfB));

    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...crypto.randomBytes(500)]);
    expect((await scratch.storage.from("profile-photos").upload("u-x.jpg", jpg, { contentType: "image/jpeg", upsert: true, cacheControl: "31536000" })).error).toBeNull();
    const pub = scratch.storage.from("profile-photos").getPublicUrl("u-x.jpg").data.publicUrl;
    const pubRes = await serveMediaRequest(new Request(`${pub}?t=1`), "public", { store, prefix: TEST_PREFIX });
    expect(pubRes.status).toBe(200);
    expect(pubRes.headers.get("content-type")).toBe("image/jpeg");
    expect(sha(await pubRes.arrayBuffer())).toBe(sha(jpg));

    const rm = await docs.remove(["cand-x/req-x.pdf", "cand-x/blob.pdf", "cand-x/never-existed.pdf"]);
    expect(rm.error).toBeNull();
    expect(rm.data?.map((r) => r.name).sort()).toEqual(["cand-x/blob.pdf", "cand-x/req-x.pdf"]);
    expect(errShape((await docs.download("cand-x/req-x.pdf")).error)).toEqual({ name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" });
    const photoRm = await scratch.storage.from("profile-photos").remove(["u-x.jpg", "u-x.png", "u-x.webp"]);
    expect(photoRm.data).toHaveLength(1);

    for (const o of await store.list(`${TEST_PREFIX}/`)) await store.delete(o.key);
    expect(await store.list(`${TEST_PREFIX}/`)).toEqual([]);
    console.log("[r2-parity] R2 writes under _prep-test/storage/: all operations behaved; prefix empty afterwards");
  }, 300_000);
});
