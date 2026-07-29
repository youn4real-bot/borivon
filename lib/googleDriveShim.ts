/**
 * Cloudflare-Workers REST shim for Google Drive.
 *
 * THIS IS WHY THE DRIVE MIRROR WAS DEAD. When we moved off Vercel, Gmail and
 * Calendar were ported to plain fetch (lib/googleRestShim.ts) because googleapis
 * reaches node:http through gaxios and that path does not work on workerd.
 * Drive was the one client left on the SDK. Every Drive caller catches and logs,
 * so a sync reported success while copying nothing: not a single document has
 * reached Drive since 2026-06-13, the day of the migration.
 *
 * Same contract as the other shims — each method mirrors the googleapis
 * signature (one options object), returns `{ data }`, and THROWS on a non-2xx,
 * so `lib/driveMirror.ts` and every other caller work unchanged.
 */
import { mintGoogleAccessToken, type GoogleSaKey } from "@/lib/googleAuthWebCrypto";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/**
 * `subject` is optional because not every Drive caller impersonates a Workspace
 * user. The legacy candidate-document tree is owned by the standalone service
 * account in GOOGLE_SERVICE_ACCOUNT_EMAIL and lives in its own shared folder, so
 * those callers must self-auth (no `sub` claim) — impersonating the founder would
 * act as a different identity that has no access to that folder.
 */
export type DriveShimOpts = { key: GoogleSaKey; subject?: string; scopes: string[] };

async function authedFetch(opts: DriveShimOpts, url: string, init?: RequestInit): Promise<Response> {
  const token = await mintGoogleAccessToken({ key: opts.key, subject: opts.subject, scopes: opts.scopes });
  if (!token) throw new Error("google_token_mint_failed");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    // Read as TEXT. The old SDK path surfaced Google's gzip bytes verbatim into
    // the error message, which is how this failure stayed unreadable for weeks.
    const body = await res.text().catch(() => "");
    throw new Error(`drive_rest ${res.status} ${url.replace(/\?.*$/, "")} ${body.slice(0, 300)}`);
  }
  return res;
}

async function jget(opts: DriveShimOpts, url: string): Promise<unknown> {
  return (await authedFetch(opts, url)).json();
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) sp.append(k, String(item));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

/**
 * Normalise every body shape a caller hands to `media.body` into bytes.
 *
 * The call sites pass a Node `Readable` (Readable.from(r2Object.body)) because
 * that is what googleapis wanted. fetch needs a concrete body and the multipart
 * envelope needs the length, so we buffer. These are passports, diplomas and
 * CVs — single-digit MB — so buffering is safe. A resumable upload would be the
 * answer if that ever stops being true.
 */
async function toBytes(body: unknown): Promise<Uint8Array> {
  if (body == null) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  const asyncIt = (body as Record<symbol, unknown>)[Symbol.asyncIterator];
  if (typeof asyncIt === "function") {
    const chunks: Uint8Array[] = [];
    for await (const c of body as AsyncIterable<unknown>) {
      chunks.push(c instanceof Uint8Array ? c : new TextEncoder().encode(String(c)));
    }
    return concatBytes(chunks);
  }
  throw new Error("drive_shim: unsupported media body type");
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** Deterministic boundary seed — Math.random is avoided so runs are reproducible. */
function seed(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** metadata + binary in one request, per Drive's `uploadType=multipart` contract. */
function multipartBody(metadata: unknown, mimeType: string, media: Uint8Array):
  { body: Uint8Array; contentType: string } {
  const meta = JSON.stringify(metadata ?? {});
  const boundary = `borivon${seed(meta + media.length)}x`;
  const te = new TextEncoder();
  return {
    contentType: `multipart/related; boundary=${boundary}`,
    body: concatBytes([
      te.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
      te.encode(meta),
      te.encode(`\r\n--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
      media,
      te.encode(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

type Media = { mimeType?: string; body?: unknown };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Drive REST client mimicking the googleapis `drive({version:'v3'})` surface used. */
export function makeDriveRestClient(opts: DriveShimOpts) {
  const fileUrl = (id: string, params: Record<string, unknown> = {}) =>
    `${DRIVE_BASE}/files/${enc(id)}${qs(params)}`;

  return {
    about: {
      get: async (p: { fields?: string } = {}) =>
        ({ data: await jget(opts, `${DRIVE_BASE}/about${qs({ fields: p.fields ?? "user" })}`) as any }),
    },

    permissions: {
      create: async (p: { fileId: string; requestBody: any; supportsAllDrives?: boolean; sendNotificationEmail?: boolean; fields?: string }) =>
        ({ data: await (await authedFetch(opts,
          `${DRIVE_BASE}/files/${enc(p.fileId)}/permissions${qs({
            supportsAllDrives: p.supportsAllDrives,
            sendNotificationEmail: p.sendNotificationEmail,
            fields: p.fields,
          })}`,
          { method: "POST", body: JSON.stringify(p.requestBody) })).json() as any }),
    },

    files: {
      list: async (p: {
        q?: string; fields?: string; pageSize?: number; pageToken?: string; orderBy?: string;
        spaces?: string; corpora?: string; driveId?: string;
        supportsAllDrives?: boolean; includeItemsFromAllDrives?: boolean;
      } = {}) =>
        ({ data: await jget(opts, `${DRIVE_BASE}/files${qs({
          q: p.q, fields: p.fields, pageSize: p.pageSize, pageToken: p.pageToken, orderBy: p.orderBy,
          spaces: p.spaces, corpora: p.corpora, driveId: p.driveId,
          supportsAllDrives: p.supportsAllDrives, includeItemsFromAllDrives: p.includeItemsFromAllDrives,
        })}`) as any }),

      /**
       * Two shapes, exactly like googleapis: metadata (default), and `alt:"media"`
       * for the bytes. The second argument (`{responseType:"stream"}`) is accepted
       * and ignored — with `alt:"media"` the caller gets `data` as a web
       * ReadableStream, which is what the Response/pipe paths want on Workers.
       */
      get: async (p: { fileId: string; fields?: string; alt?: string; supportsAllDrives?: boolean }, _extra?: unknown) => {
        const res = await authedFetch(opts, fileUrl(p.fileId, {
          fields: p.fields, alt: p.alt, supportsAllDrives: p.supportsAllDrives,
        }));
        if (p.alt === "media") {
          return { data: res.body as any, headers: Object.fromEntries(res.headers) as any };
        }
        return { data: await res.json() as any };
      },

      create: async (p: { requestBody?: any; media?: Media; fields?: string; supportsAllDrives?: boolean }) => {
        const params = { fields: p.fields, supportsAllDrives: p.supportsAllDrives };
        if (!p.media?.body) {
          return { data: await (await authedFetch(opts, `${DRIVE_BASE}/files${qs(params)}`,
            { method: "POST", body: JSON.stringify(p.requestBody ?? {}) })).json() as any };
        }
        const mp = multipartBody(p.requestBody ?? {}, p.media.mimeType ?? "application/octet-stream", await toBytes(p.media.body));
        return { data: await (await authedFetch(opts, `${DRIVE_UPLOAD}${qs({ ...params, uploadType: "multipart" })}`,
          { method: "POST", body: mp.body as unknown as BodyInit, headers: { "content-type": mp.contentType } })).json() as any };
      },

      update: async (p: {
        fileId: string; requestBody?: any; media?: Media;
        addParents?: string; removeParents?: string; fields?: string; supportsAllDrives?: boolean;
      }) => {
        const params = {
          fields: p.fields, supportsAllDrives: p.supportsAllDrives,
          addParents: p.addParents, removeParents: p.removeParents,
        };
        if (!p.media?.body) {
          return { data: await (await authedFetch(opts, fileUrl(p.fileId, params),
            { method: "PATCH", body: JSON.stringify(p.requestBody ?? {}) })).json() as any };
        }
        const mp = multipartBody(p.requestBody ?? {}, p.media.mimeType ?? "application/octet-stream", await toBytes(p.media.body));
        return { data: await (await authedFetch(opts, `${DRIVE_UPLOAD}/${enc(p.fileId)}${qs({ ...params, uploadType: "multipart" })}`,
          { method: "PATCH", body: mp.body as unknown as BodyInit, headers: { "content-type": mp.contentType } })).json() as any };
      },

      copy: async (p: { fileId: string; requestBody?: any; fields?: string; supportsAllDrives?: boolean }) =>
        ({ data: await (await authedFetch(opts,
          `${DRIVE_BASE}/files/${enc(p.fileId)}/copy${qs({ fields: p.fields, supportsAllDrives: p.supportsAllDrives })}`,
          { method: "POST", body: JSON.stringify(p.requestBody ?? {}) })).json() as any }),

      /**
       * Present, but always throws. LAW #33: a candidate document is never
       * deleted or trashed — it moves to an archive folder. Keeping the method
       * here means a stray call fails loudly in our own code instead of quietly
       * succeeding against Google.
       */
      delete: async (_p: { fileId: string }): Promise<never> => {
        throw new Error("drive_shim: files.delete is forbidden (LAW #33 — archive, never delete)");
      },
    },
  };
}
