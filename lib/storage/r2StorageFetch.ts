/**
 * Supabase Storage, answered from R2.
 *
 * supabase-js turns every `db.storage.from(bucket).upload/download/remove/...`
 * into an HTTP request to <storage-url>/storage/v1/... and hands it to the
 * client's fetch. This is a fetch that answers those requests from the R2
 * bucket instead, under the key layout the copy already uses —
 * `supabase/<bucket>/<path>` (storage/copy-to-r2.mjs) — so the server files
 * that call db.storage keep working with no call site changed, the same way
 * lib/d1/bvFetch.ts serves tables. Anything that is not a storage URL goes to
 * `passthrough` untouched.
 *
 * Shapes follow @supabase/storage-js 2.104 and what the live project answers
 * (probed 2026-09-14). The one that bites: Supabase reports errors as HTTP 400
 * with the REAL status in the body — a missing object is
 *   400 {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}
 * storage-js copies that body into error.message / error.statusCode, and call
 * sites branch on those, so the adapter answers byte-compatible bodies.
 *
 * Deliberately NOT emulated (no call site uses them; they fail loudly with a
 * 501 instead of half-working): move, copy, info, signed UPLOAD urls, list-v2,
 * image transforms, bucket admin beyond createBucket.
 *
 * LAW #33: remove deletes exactly the paths it is given, inside that bucket's
 * own supabase/<bucket>/ namespace, exactly as Supabase's remove does — it adds
 * no archiving and drops none; the call sites decide. Candidate documents live
 * under candidates/<userId>/ in the same R2 bucket and are unreachable from
 * here: every key this module builds starts with the storage prefix.
 *
 * Off unless lib/storage/withR2Storage.ts is wired in and STORAGE_BACKEND=r2.
 */
import crypto from "crypto";
import { checkStorageToken, signStorageToken } from "@/lib/storage/storageToken";
import { defaultObjectStore, type ObjectHead, type ObjectStore, type StoredObject } from "@/lib/storage/objectStore";

export const STORAGE_KEY_PREFIX = "supabase";

/**
 * The only buckets whose objects are served without a token — the two Supabase
 * has marked public (checked live). sign-documents and slot-templates hold
 * contracts and candidate PDFs and must never appear here.
 */
export const PUBLIC_BUCKETS: ReadonlySet<string> = new Set(["profile-photos", "feed-photos"]);

/**
 * The per-bucket limits Supabase enforces today (file_size_limit /
 * allowed_mime_types, read from the live buckets). Supabase refuses an upload
 * outside them; without this the switch would silently start accepting, say, a
 * 40 MB or HTML "profile photo" that then gets served from our own domain.
 */
const BUCKET_RULES: Record<string, { maxBytes: number; mimeTypes: readonly string[] }> = {
  "profile-photos": { maxBytes: 2 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
  "feed-photos": { maxBytes: 5 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
};

/**
 * Supabase Storage, kept in step while it is still alive and still the rollback
 * target. Without it, the day R2 starts answering:
 *   • a cleared profile photo, a deleted feed post or a deleted account loses
 *     only its R2 copy — the Supabase copy stays publicly downloadable at its
 *     old supabase.co URL, and contracts stay in the sign-documents bucket;
 *   • a rollback serves Supabase's pre-switch state: every contract signed while
 *     R2 was active 404s, and every file deleted in that time comes back.
 * So every upload and remove that SUCCEEDS on R2 is repeated on Supabase.
 */
export type StorageMirror = {
  /** Always an upsert: afterwards Supabase holds exactly the bytes R2 holds. */
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string, cacheControl: string | null): Promise<void>;
  remove(bucket: string, paths: string[]): Promise<void>;
};

export type R2StorageOptions = {
  /** Where bytes live. Defaults to the runtime's R2 (lib/storage/objectStore.ts). */
  store?: ObjectStore | null;
  /** Non-storage requests go here (e.g. bvFetch). Defaults to the global fetch. */
  passthrough?: typeof fetch;
  /** Key prefix in R2. "supabase" in production; the live test writes under a throwaway one. */
  prefix?: string;
  /** Repeat successful writes on Supabase Storage (see StorageMirror). Null = R2 only. */
  mirror?: StorageMirror | null;
  /** How long a mirror call may hold up the response before it counts as missed. */
  mirrorTimeoutMs?: number;
};

type MirrorRun = (op: "upload" | "remove", bucket: string, paths: string[], work: (m: StorageMirror) => Promise<void>) => Promise<void>;

/**
 * Best effort, and awaited: R2 already holds the truth, so a mirror failure must
 * never fail the call — but a fire-and-forget promise can be cut off when a
 * Worker returns its response, which would drop mirrors silently. Awaiting with
 * a ceiling keeps them reliable without letting a slow Supabase hang an upload.
 * A miss is logged with its paths: storage/copy-back-to-supabase.mjs repairs it.
 */
function mirrorRunner(mirror: StorageMirror | null | undefined, timeoutMs: number): MirrorRun | null {
  if (!mirror) return null;
  return async (op, bucket, paths, work) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work(mirror),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs); }),
      ]);
    } catch (err) {
      const shown = paths.length > 5 ? `${paths.slice(0, 5).join(", ")} (+${paths.length - 5} more)` : paths.join(", ");
      const why = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : String(err);
      console.error(`[r2-storage] MIRROR MISS ${op} ${bucket}: ${shown} — ${why}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// ── responses ────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function storageError(statusCode: string, error: string, message: string, code: string): Response {
  const http = statusCode === "500" ? 500 : statusCode === "501" ? 501 : 400;
  return json({ statusCode, error, message, code }, http);
}

const notFound = () => storageError("404", "not_found", "Object not found", "NoSuchKey");
const bucketNotFound = () => storageError("404", "Bucket not found", "Bucket not found", "NoSuchBucket");
const invalidKey = () => storageError("400", "InvalidKey", "Invalid key", "InvalidKey");
const duplicate = () => storageError("409", "Duplicate", "The resource already exists", "ResourceAlreadyExists");
const badRequest = (message: string) => storageError("400", "Bad Request", message, "InvalidRequest");
const internal = () => storageError("500", "internal", "Internal Server Error", "InternalError");
const unreachable = () => storageError("500", "internal", "R2 storage is not reachable from this runtime", "InternalError");
const unsupported = (what: string) => storageError("501", "not_implemented", `${what} is not supported by the R2 storage adapter`, "NotImplemented");

// ── keys ─────────────────────────────────────────────────────────────────────

// Control characters and backslashes never occur in a key this app builds, and
// a backslash is exactly what some HTTP layers normalise into a separator.
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

/**
 * The R2 key for bucket + path, or null when the pair must be refused.
 * `.` / `..` segments are refused outright: R2 itself stores keys literally,
 * but the S3 path in lib/r2.ts goes through URL handling that may not, and a
 * "../../candidates/<id>/passport.pdf" must never get a chance to be read.
 */
export function objectKey(prefix: string, bucket: string, path: string): { key: string; path: string } | null {
  if (!bucket || bucket === "." || bucket === ".." || bucket.includes("/") || UNSAFE.test(bucket)) return null;
  const clean = path.replace(/^\/+/, "");
  if (!clean || UNSAFE.test(clean)) return null;
  if (clean.split("/").some((s) => s === "." || s === "..")) return null;
  return { key: `${prefix}/${bucket}/${clean}`, path: clean };
}

/** The same id every time for the same object — upsert keeps it, list and upload agree on it. */
function stableObjectId(bucket: string, path: string): string {
  const h = crypto.createHash("sha256").update(`${bucket}/${path}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function normPrefix(prefix: string | undefined): string {
  return (prefix ?? STORAGE_KEY_PREFIX).replace(/^\/+|\/+$/g, "");
}

// ── URL parsing ──────────────────────────────────────────────────────────────

const MARK = "/storage/v1/";

function decodeSegment(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * The part of a storage URL after /storage/v1/, split and decoded. The FIRST
 * occurrence wins, so a crafted object name containing "/storage/v1/" cannot
 * re-route a public request into a private one.
 */
export function parseStorageUrl(url: string): { rest: string[]; search: URLSearchParams } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const at = u.pathname.indexOf(MARK);
  if (at < 0) return null;
  return { rest: u.pathname.slice(at + MARK.length).split("/").map(decodeSegment), search: u.searchParams };
}

// ── the fetch ────────────────────────────────────────────────────────────────

export function makeR2StorageFetch(opts: R2StorageOptions = {}): typeof fetch {
  const passthrough = opts.passthrough ?? fetch;
  const prefix = normPrefix(opts.prefix);
  const mirror = mirrorRunner(opts.mirror, opts.mirrorTimeoutMs ?? 15_000);

  return async function r2StorageFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = parseStorageUrl(url);
    if (!route) return passthrough(input as RequestInfo, init);

    const request = input instanceof Request && !init ? input : new Request(url, init);
    // No R2 here: refuse rather than fall back to Supabase. Unlike a read-only
    // table query, a storage WRITE that silently lands in the old backend is a
    // file the new one will never have.
    const store = opts.store ?? (await defaultObjectStore());
    if (!store) return unreachable();
    try {
      return await dispatch(request, route, store, prefix, mirror);
    } catch (err) {
      console.error("[r2-storage]", request.method, route.rest.slice(0, 2).join("/"), err instanceof Error ? err.message : err);
      return internal();
    }
  } as typeof fetch;
}

async function dispatch(req: Request, route: { rest: string[]; search: URLSearchParams }, store: ObjectStore, prefix: string, mirror: MirrorRun | null): Promise<Response> {
  const method = req.method.toUpperCase();
  const [area, op, ...after] = route.rest;

  if (area === "bucket") {
    // createBucket: the call sites run it before every upload "in case". In R2
    // the prefix IS the bucket, so there is nothing to create — succeed the way
    // Supabase does for a new bucket.
    if (method === "POST" && op === undefined) {
      const body = await readJson(req);
      return json({ name: String(body.id ?? body.name ?? "") });
    }
    return unsupported(`${method} /bucket`);
  }
  if (area !== "object" || op === undefined) return unsupported(`${method} /${route.rest.join("/")}`.slice(0, 80));

  switch (op) {
    case "list":
      return method === "POST" && after.length === 1 ? list(req, after[0], store, prefix) : unsupported("this list request");
    case "sign":
      if (method === "POST" && after.length === 1) return signMany(req, after[0], store, prefix);
      if (method === "POST" && after.length >= 2) return signOne(req, after[0], after.slice(1).join("/"), store, prefix);
      if ((method === "GET" || method === "HEAD") && after.length >= 2) return serveSigned(method, after[0], after.slice(1).join("/"), route.search, store, prefix);
      return unsupported("this sign request");
    case "public":
      if ((method === "GET" || method === "HEAD") && after.length >= 2) return servePublic(method, after[0], after.slice(1).join("/"), route.search, store, prefix);
      return unsupported("this public request");
    case "authenticated":
      if ((method === "GET" || method === "HEAD") && after.length >= 2) return download(method, after[0], after.slice(1).join("/"), store, prefix);
      return unsupported("this authenticated request");
    case "move":
    case "copy":
    case "info":
    case "upload":
    case "list-v2":
      return unsupported(op);
  }

  // /object/<bucket>/<path…>
  const bucket = op;
  const path = after.join("/");
  if (method === "DELETE" && after.length === 0) return remove(req, bucket, store, prefix, mirror);
  if (method === "GET" || method === "HEAD") return download(method, bucket, path, store, prefix);
  if (method === "POST" || method === "PUT") return upload(req, method, bucket, path, store, prefix, mirror);
  return unsupported(`${method} /object`);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── operations ───────────────────────────────────────────────────────────────

function objectHeaders(h: ObjectHead): Headers {
  const headers = new Headers({ "content-type": h.contentType || "application/octet-stream", "cache-control": "no-cache" });
  if (h.etag) headers.set("etag", `"${h.etag}"`);
  if (h.uploaded) headers.set("last-modified", h.uploaded.toUTCString());
  return headers;
}

async function download(method: string, bucket: string, path: string, store: ObjectStore, prefix: string): Promise<Response> {
  const target = objectKey(prefix, bucket, path);
  if (!target) return invalidKey();
  if (method === "HEAD") {
    const h = await store.head(target.key);
    return h ? new Response(null, { status: 200, headers: objectHeaders(h) }) : new Response(null, { status: 400 });
  }
  const obj = await store.get(target.key);
  if (!obj) return notFound();
  return new Response(obj.body, { status: 200, headers: objectHeaders(obj) });
}

async function readUpload(req: Request): Promise<{ bytes: Uint8Array; contentType: string; cacheControl: string | null }> {
  const type = req.headers.get("content-type") ?? "";
  if (type.toLowerCase().startsWith("multipart/form-data")) {
    // storage-js sends a Blob/File as FormData: a cacheControl field plus the
    // file under an empty name. The part's own type is the object's mimetype.
    const form = await req.formData();
    const cc = form.get("cacheControl");
    const cacheControl = typeof cc === "string" && cc ? cc : null;
    for (const [, value] of form.entries()) {
      if (typeof value !== "string") {
        return { bytes: new Uint8Array(await value.arrayBuffer()), contentType: value.type || "application/octet-stream", cacheControl };
      }
    }
    return { bytes: new Uint8Array(), contentType: "application/octet-stream", cacheControl };
  }
  // Raw bodies carry it as a header: "cache-control: max-age=<seconds>".
  const maxAge = /max-age=(\d+)/.exec(req.headers.get("cache-control") ?? "");
  return { bytes: new Uint8Array(await req.arrayBuffer()), contentType: type || "application/octet-stream", cacheControl: maxAge ? maxAge[1] : null };
}

async function upload(req: Request, method: "POST" | "PUT", bucket: string, path: string, store: ObjectStore, prefix: string, mirror: MirrorRun | null): Promise<Response> {
  const target = objectKey(prefix, bucket, path);
  if (!target) return invalidKey();
  const { bytes, contentType, cacheControl } = await readUpload(req);

  const rule = BUCKET_RULES[bucket];
  if (rule) {
    if (bytes.length > rule.maxBytes) return storageError("413", "Payload too large", "The object exceeded the maximum allowed size", "EntityTooLarge");
    const mime = contentType.split(";")[0].trim().toLowerCase();
    if (!rule.mimeTypes.includes(mime)) return storageError("415", "invalid_mime_type", `mime type ${contentType} is not supported`, "InvalidMimeType");
  }

  // Supabase checks existence inside one database transaction; R2 has no
  // conditional create, so this is check-then-put. The two upsert:false call
  // sites write timestamped paths (slot-template archive, sign-request
  // originals), so two writers racing for the same name does not happen.
  const existing = await store.head(target.key);
  if (method === "PUT" && !existing) return notFound();
  if (method === "POST" && existing && req.headers.get("x-upsert") !== "true") return duplicate();

  await store.put(target.key, bytes, contentType);
  // Only after R2 accepted it: a refused upload (duplicate, size, type, freeze)
  // must not land in Supabase either.
  await mirror?.("upload", bucket, [target.path], (m) => m.upload(bucket, target.path, bytes, contentType, cacheControl));
  return json({ Id: stableObjectId(bucket, target.path), Key: `${bucket}/${target.path}` });
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function fileEntry(bucket: string, fullPath: string, name: string, h: ObjectHead) {
  const at = iso(h.uploaded);
  return {
    name,
    id: stableObjectId(bucket, fullPath),
    updated_at: at,
    created_at: at,
    last_accessed_at: at,
    metadata: {
      eTag: h.etag ? `"${h.etag}"` : null,
      size: h.size,
      mimetype: h.contentType ?? "application/octet-stream",
      cacheControl: "max-age=3600",
      lastModified: at,
      contentLength: h.size,
      httpStatusCode: 200,
    },
  };
}

/** Run `fn` over `items` a few at a time, keeping input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function remove(req: Request, bucket: string, store: ObjectStore, prefix: string, mirror: MirrorRun | null): Promise<Response> {
  const body = await readJson(req);
  const prefixes = Array.isArray(body.prefixes) ? body.prefixes.filter((p): p is string => typeof p === "string") : [];
  if (prefixes.length === 0) return badRequest("body/prefixes must NOT have fewer than 1 items");

  // Like Supabase: only objects that existed are reported; unknown or refused
  // paths are skipped silently rather than failing the whole batch.
  const unique = [...new Set(prefixes)];
  const removed = await mapLimit(unique, 8, async (p) => {
    const target = objectKey(prefix, bucket, p);
    if (!target) return null;
    const head = await store.head(target.key);
    if (!head) return null;
    await store.delete(target.key);
    return { bucket_id: bucket, ...fileEntry(bucket, target.path, target.path, head) };
  });

  // Every path the caller named (and the key rules allow), not only those R2
  // had: Supabase can hold one R2 never got, and "delete" must mean gone there
  // too. Exactly the caller's paths — the mirror adds no archiving and drops
  // none (LAW #33).
  const named = unique.map((p) => objectKey(prefix, bucket, p)?.path).filter((p): p is string => !!p);
  if (named.length) await mirror?.("remove", bucket, named, (m) => m.remove(bucket, named));
  return json(removed.filter((r) => r !== null));
}

const ANY = 0;
const ONE = 1;

/**
 * Postgres ILIKE `search%` — `%` any run, `_` any one character, backslash
 * escapes the next one (LIKE's default ESCAPE), case-insensitive.
 *
 * A matcher, not a RegExp: every `%` became a `.*`, and a search like
 * "%%%%%%%!" backtracks exponentially — measured 776 ms at six wildcards and
 * 5.5 s at seven, each extra % multiplying it — where Postgres answers at once.
 * This is the greedy wildcard walk: at most one backtrack point, so
 * O(name x search) whatever the input. Runs of % collapse to one.
 */
export function ilikePrefix(name: string, search: string): boolean {
  if (!search) return true;
  const pat: (string | typeof ANY | typeof ONE)[] = [];
  const chars = Array.from(search.toLowerCase());
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "\\" && i + 1 < chars.length) pat.push(chars[++i]);
    else if (c === "%") { if (pat[pat.length - 1] !== ANY) pat.push(ANY); }
    else if (c === "_") pat.push(ONE);
    else pat.push(c);
  }
  if (pat[pat.length - 1] !== ANY) pat.push(ANY); // the prefix match's trailing %
  const s = Array.from(name.toLowerCase());
  let i = 0;
  let p = 0;
  let star = -1;
  let resume = 0;
  while (i < s.length) {
    const t = pat[p];
    if (p < pat.length && t !== ANY && (t === ONE || t === s[i])) { i++; p++; }
    else if (p < pat.length && t === ANY) { star = p++; resume = i; }
    else if (star >= 0) { p = star + 1; i = ++resume; }
    else return false;
  }
  while (p < pat.length && pat[p] === ANY) p++;
  return p === pat.length;
}

type ListEntry = ReturnType<typeof fileEntry> | { name: string; id: null; updated_at: null; created_at: null; last_accessed_at: null; metadata: null };

const SORT_COLUMNS = ["name", "updated_at", "created_at", "last_accessed_at"] as const;

/** Code-point order (UTF-8 byte order). JS `<` compares UTF-16 units, which misplaces astral characters. */
function codePointCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x - y;
    if (x > 0xffff) i++;
  }
  return a.length - b.length;
}

/**
 * The order Supabase's list answers names in, measured on the live project
 * (all 10 folders, 560 names, ascending and descending): lower-cased names in
 * byte order, then the names' own bytes. Plain byte order put the doc-cache
 * folder's mixed-case Drive ids in a different sequence ("1ZRG…" before
 * "1znG…"), and ICU collation disagreed wherever "_" met a digit. Anyone paging
 * with limit/offset would otherwise get different pages from R2 than from Supabase.
 */
export function compareListNames(a: string, b: string): number {
  return codePointCompare(a.toLowerCase(), b.toLowerCase()) || codePointCompare(a, b);
}

async function list(req: Request, bucket: string, store: ObjectStore, prefix: string): Promise<Response> {
  const body = await readJson(req);
  if (!objectKey(prefix, bucket, "x")) return invalidKey();
  const limit = Number.isFinite(Number(body.limit)) ? Math.max(0, Math.floor(Number(body.limit))) : 100;
  const offset = Number.isFinite(Number(body.offset)) ? Math.max(0, Math.floor(Number(body.offset))) : 0;
  const search = typeof body.search === "string" ? body.search : "";
  const sortBy = (body.sortBy ?? {}) as { column?: unknown; order?: unknown };
  const column = SORT_COLUMNS.find((c) => c === sortBy.column) ?? "name";
  const desc = String(sortBy.order ?? "").toLowerCase() === "desc";

  // Supabase lists one folder level: "slot-templates" means "slot-templates/".
  let folder = typeof body.prefix === "string" ? body.prefix.replace(/^\/+/, "") : "";
  if (folder && !folder.endsWith("/")) folder += "/";
  if (folder && folder.split("/").slice(0, -1).some((s) => s === "." || s === ".." || UNSAFE.test(s))) return invalidKey();

  const base = `${prefix}/${bucket}/${folder}`;
  const entries = new Map<string, ListEntry>();
  for (const o of await store.list(base)) {
    const rel = o.key.slice(base.length);
    if (!rel) continue;
    const slash = rel.indexOf("/");
    const name = slash < 0 ? rel : rel.slice(0, slash);
    if (!ilikePrefix(name, search)) continue;
    if (slash < 0) entries.set(name, fileEntry(bucket, `${folder}${name}`, name, o));
    else if (!entries.has(name)) entries.set(name, { name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
  }

  // Folders and files interleave by name, and descending reverses the whole
  // comparison. NULLS LAST ascending and NULLS FIRST descending for a folder
  // row's null timestamps, as Postgres sorts them.
  const rows = [...entries.values()].sort((a, b) => {
    if (column === "name") return desc ? -compareListNames(a.name, b.name) : compareListNames(a.name, b.name);
    const x = a[column];
    const y = b[column];
    if (x === y) return compareListNames(a.name, b.name);
    if (x === null) return desc ? -1 : 1;
    if (y === null) return desc ? 1 : -1;
    const cmp = x < y ? -1 : 1;
    return desc ? -cmp : cmp;
  });
  return json(rows.slice(offset, offset + limit));
}

async function signOne(req: Request, bucket: string, path: string, store: ObjectStore, prefix: string): Promise<Response> {
  const body = await readJson(req);
  const expiresIn = Number(body.expiresIn);
  if (!Number.isFinite(expiresIn) || expiresIn < 1) return badRequest("body/expiresIn must be >= 1");
  const target = objectKey(prefix, bucket, path);
  if (!target) return invalidKey();
  if (!(await store.head(target.key))) return notFound();
  // storage-js prepends its base URL and encodeURI()s the result, so the path
  // goes back raw — pre-encoding it here would double-encode every space.
  return json({ signedURL: `/object/sign/${bucket}/${target.path}?token=${signStorageToken(bucket, target.path, expiresIn)}` });
}

async function signMany(req: Request, bucket: string, store: ObjectStore, prefix: string): Promise<Response> {
  const body = await readJson(req);
  const expiresIn = Number(body.expiresIn);
  if (!Number.isFinite(expiresIn) || expiresIn < 1) return badRequest("body/expiresIn must be >= 1");
  const paths = Array.isArray(body.paths) ? body.paths.filter((p): p is string => typeof p === "string") : [];
  const out = await mapLimit(paths, 8, async (p) => {
    const target = objectKey(prefix, bucket, p);
    const exists = target ? await store.head(target.key) : null;
    return target && exists
      ? { error: null, path: p, signedURL: `/object/sign/${bucket}/${target.path}?token=${signStorageToken(bucket, target.path, expiresIn)}` }
      : { error: "Either the object does not exist or you do not have access to it", path: p, signedURL: null };
  });
  return json(out);
}

// ── serving to a browser ─────────────────────────────────────────────────────

/**
 * Types a browser may render inline. These objects are served from OUR origin
 * (www.borivon.com), not supabase.co — an uploaded text/html or image/svg+xml
 * rendered inline here would run script with the portal's cookies. Anything
 * else is sent as an opaque download.
 */
export const INLINE_TYPES: ReadonlySet<string> = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

function browserResponse(method: string, obj: StoredObject, path: string, cacheControl: string, download: string | null): Response {
  const type = (obj.contentType ?? "").split(";")[0].trim().toLowerCase();
  const renderable = INLINE_TYPES.has(type);
  const headers = new Headers({
    "content-type": renderable ? type : "application/octet-stream",
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  if (!renderable || download !== null) {
    const name = ((download && download.trim()) || path.split("/").pop() || "file").replace(/[^\w.\-]+/g, "_").slice(0, 200);
    headers.set("content-disposition", `attachment; filename="${name}"`);
  }
  // Sandbox images viewed directly. Not PDFs: Chrome refuses to run its PDF
  // viewer inside a sandboxed document, which would blank the sign-request
  // preview iframe.
  if (type !== "application/pdf") headers.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  if (obj.etag) headers.set("etag", `"${obj.etag}"`);
  return new Response(method === "HEAD" ? null : obj.body, { status: 200, headers });
}

async function servePublic(method: string, bucket: string, path: string, search: URLSearchParams, store: ObjectStore, prefix: string): Promise<Response> {
  if (!PUBLIC_BUCKETS.has(bucket)) return bucketNotFound();
  const target = objectKey(prefix, bucket, path);
  if (!target) return invalidKey();
  const obj = await store.get(target.key);
  if (!obj) return notFound();
  // Every stored photo URL carries ?t=<upload time>, so a new photo is a new
  // URL and the bytes behind one URL never change: cache them for a year. A bare
  // URL (no ?t) may be replaced in place, so it keeps Supabase's default hour.
  const cache = search.has("t") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  return browserResponse(method, obj, target.path, cache, search.get("download"));
}

/** The object a signed request may open, or the refusal — token checked before anything is read. */
function signedTarget(bucket: string, path: string, search: URLSearchParams, prefix: string): { key: string; path: string } | Response {
  // Supabase validates the querystring before anything else (probed live).
  const token = search.get("token");
  if (token === null) return storageError("400", "Error", "querystring must have required property 'token'", "InvalidRequest");
  const target = objectKey(prefix, bucket, path);
  if (!target) return invalidKey();
  const check = checkStorageToken(token, bucket, target.path);
  if (check !== "ok") return storageError("400", "InvalidJWT", check === "expired" ? "jwt expired" : "invalid signature", "InvalidJWT");
  return target;
}

async function serveSigned(method: string, bucket: string, path: string, search: URLSearchParams, store: ObjectStore, prefix: string): Promise<Response> {
  const target = signedTarget(bucket, path, search, prefix);
  if (target instanceof Response) return target;
  const obj = await store.get(target.key);
  if (!obj) return notFound();
  // Contracts and candidate PDFs: never kept in a shared or disk cache.
  return browserResponse(method, obj, target.path, "private, no-store", search.get("download"));
}

/**
 * Where the routes send a browser after a rollback (STORAGE_BACKEND "supabase"),
 * built by lib/storage/supabaseRedirects.ts. Supabase is the truth again then:
 * answering from R2 would keep serving a photo cleared, or a contract replaced,
 * after the rollback.
 */
export type SupabaseRedirects = {
  publicUrl(bucket: string, path: string): string;
  /** A short-lived Supabase signed URL, or null when Supabase has no such object. */
  signedUrl(bucket: string, path: string, expiresIn: number, download: string | null): Promise<string | null>;
};

/** How long the Supabase signed URL a rollback redirect lands on stays valid. */
const ROLLBACK_SIGNED_TTL_SEC = 60;

function redirect(location: string, cacheControl: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": cacheControl } });
}

async function redirectToSupabase(kind: "public" | "sign", bucket: string, path: string, search: URLSearchParams, to: SupabaseRedirects): Promise<Response> {
  if (kind === "public") {
    // The same refusals as serving from R2: a private bucket or a climbing path never becomes a redirect.
    if (!PUBLIC_BUCKETS.has(bucket)) return bucketNotFound();
    const target = objectKey(STORAGE_KEY_PREFIX, bucket, path);
    if (!target) return invalidKey();
    const qs = search.toString();
    return redirect(`${to.publicUrl(bucket, target.path)}${qs ? `?${qs}` : ""}`, "public, max-age=300");
  }
  // Our token still decides who may open the object; Supabase's URL only carries the bytes.
  const target = signedTarget(bucket, path, search, STORAGE_KEY_PREFIX);
  if (target instanceof Response) return target;
  const url = await to.signedUrl(bucket, target.path, ROLLBACK_SIGNED_TTL_SEC, search.get("download"));
  return url ? redirect(url, "private, no-store") : notFound();
}

/**
 * Entry point for the two app routes that make getPublicUrl / createSignedUrl
 * URLs work without Supabase. `kind` pins the route to its one job: the public
 * route can never answer a signed or authenticated request, whatever the URL.
 * With `rollback`, R2 is never asked: the browser is sent to Supabase.
 */
export async function serveMediaRequest(
  req: Request,
  kind: "public" | "sign",
  opts: { store?: ObjectStore | null; prefix?: string; rollback?: SupabaseRedirects | null } = {},
): Promise<Response> {
  const method = req.method.toUpperCase();
  const route = parseStorageUrl(req.url);
  if (!route || (method !== "GET" && method !== "HEAD") || route.rest[0] !== "object" || route.rest[1] !== kind || route.rest.length < 4) {
    return notFound();
  }
  const bucket = route.rest[2];
  const path = route.rest.slice(3).join("/");
  if (opts.rollback) {
    try {
      return await redirectToSupabase(kind, bucket, path, route.search, opts.rollback);
    } catch (err) {
      console.error("[r2-storage] rollback redirect", kind, err instanceof Error ? err.message : err);
      return internal();
    }
  }
  const store = opts.store ?? (await defaultObjectStore());
  if (!store) return unreachable();
  const prefix = normPrefix(opts.prefix);
  try {
    return kind === "public"
      ? await servePublic(method, bucket, path, route.search, store, prefix)
      : await serveSigned(method, bucket, path, route.search, store, prefix);
  } catch (err) {
    console.error("[r2-storage] serve", kind, err instanceof Error ? err.message : err);
    return internal();
  }
}
