import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeDriveRestClient } from "../lib/googleDriveShim";
import { clearGoogleTokenCache } from "../lib/googleAuthWebCrypto";
import { Readable } from "node:stream";

/**
 * The Drive shim is the founder's red line: "An Calmaroi senden" copies a
 * candidate's dossier into the official Borivon Drive through these methods, and
 * every Drive caller catches + logs, so a broken shim reports success while
 * copying nothing — which is exactly what happened for the five months after the
 * Cloudflare migration, before lib/googleDriveShim.ts existed.
 *
 * So the contract gets pinned here at the HTTP boundary. Nothing real is
 * contacted: fetch is replaced, and the OAuth token endpoint is stubbed too, so
 * the assertions cover the whole path a caller takes — WebCrypto signing, token
 * exchange, URL + query building, request body, response shape — without a
 * network call or a real service-account key.
 */

const te = new TextEncoder();

function abToPem(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

async function genPem(): Promise<string> {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  return abToPem(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
}

type Call = { url: string; method: string; headers: Record<string, string>; body: Uint8Array };

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Records every request and answers Drive calls from a queue of canned replies. */
function stubFetch(replies: Array<{ status?: number; json?: unknown; text?: string; bytes?: Uint8Array }>) {
  const calls: Call[] = [];
  let i = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    let body: Uint8Array = new Uint8Array();
    const b = init?.body;
    if (typeof b === "string") body = te.encode(b);
    else if (ArrayBuffer.isView(b)) body = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    else if (b instanceof URLSearchParams) body = te.encode(b.toString());
    // The token exchange is recorded too, so a test can assert that auth happened
    // and that it happened ONCE — the replies queue only feeds Drive.
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), headers, body });
    if (url === TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "tok-123", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    const r = replies[i++] ?? { json: {} };
    if (r.bytes) return new Response(r.bytes.slice().buffer as ArrayBuffer, { status: r.status ?? 200 });
    if (r.text !== undefined) return new Response(r.text, { status: r.status ?? 200 });
    return new Response(JSON.stringify(r.json ?? {}), {
      status: r.status ?? 200, headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

let pem = "";
let restore: (() => void) | null = null;

/** A fresh client; `subject` set = the domain-wide-delegation identity the mirror uses. */
async function client() {
  if (!pem) pem = await genPem();
  return makeDriveRestClient({
    key: { client_email: "bot@borivon.iam.gserviceaccount.com", private_key: pem },
    subject: "founder@borivon.com",
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

beforeEach(() => { clearGoogleTokenCache(); });
afterEach(() => { restore?.(); restore = null; });

/** Query params of a recorded call, as a plain object. */
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("Drive REST shim — the calls lib/driveMirror.ts actually makes", () => {
  it("files.list sends q/fields/pageSize/pageToken and BOTH shared-drive flags, with a Bearer token", async () => {
    const s = stubFetch([{ json: { files: [{ id: "f1" }], nextPageToken: "p2" } }]);
    restore = s.restore;
    const drive = await client();

    const res = await drive.files.list({
      q: "'FOLDER' in parents and trashed=false",
      fields: "nextPageToken, files(id,name,appProperties)",
      pageSize: 200, pageToken: "p1",
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });

    // The token endpoint is hit first, then Drive — proving auth is not bypassed.
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0].url).toBe(TOKEN_URL);
    const c = s.calls[1];
    expect(c.method).toBe("GET");
    expect(c.url.startsWith("https://www.googleapis.com/drive/v3/files?")).toBe(true);
    expect(c.headers.authorization).toBe("Bearer tok-123");
    expect(params(c.url)).toEqual({
      q: "'FOLDER' in parents and trashed=false",
      fields: "nextPageToken, files(id,name,appProperties)",
      pageSize: "200", pageToken: "p1",
      supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    });
    // The caller pages on nextPageToken; dropping it would silently cap a
    // candidate's folder and leave retracted documents visible to the agency.
    expect(res.data.nextPageToken).toBe("p2");
    expect(res.data.files?.[0]?.id).toBe("f1");
  });

  it("files.list omits parameters the caller left undefined rather than sending 'undefined'", async () => {
    const s = stubFetch([{ json: { files: [] } }]);
    restore = s.restore;
    const drive = await client();
    await drive.files.list({ q: "name='x'", fields: "files(id)", pageSize: 1 });
    expect(params(s.calls[1].url)).toEqual({ q: "name='x'", fields: "files(id)", pageSize: "1" });
  });

  it("files.create without media posts metadata JSON to the plain files endpoint", async () => {
    const s = stubFetch([{ json: { id: "folder-1" } }]);
    restore = s.restore;
    const drive = await client();

    const out = await drive.files.create({
      requestBody: { name: "Vor Matching", mimeType: "application/vnd.google-apps.folder", parents: ["root-1"] },
      fields: "id", supportsAllDrives: true,
    });

    const c = s.calls[1];
    expect(c.method).toBe("POST");
    expect(c.url.startsWith("https://www.googleapis.com/drive/v3/files?")).toBe(true);
    expect(c.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(new TextDecoder().decode(c.body))).toEqual({
      name: "Vor Matching", mimeType: "application/vnd.google-apps.folder", parents: ["root-1"],
    });
    expect(out.data.id).toBe("folder-1");
  });

  it("files.create WITH media uploads multipart/related carrying the metadata and the exact bytes", async () => {
    const s = stubFetch([{ json: { id: "doc-1" } }]);
    restore = s.restore;
    const drive = await client();
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"

    await drive.files.create({
      requestBody: { name: "passport.pdf", parents: ["cand-1"], appProperties: { borivon_doc_id: "d1" } },
      media: { mimeType: "application/pdf", body: pdf },
      fields: "id", supportsAllDrives: true,
    });

    const c = s.calls[1];
    expect(c.method).toBe("POST");
    expect(c.url.startsWith("https://www.googleapis.com/upload/drive/v3/files?")).toBe(true);
    expect(params(c.url).uploadType).toBe("multipart");
    const ct = c.headers["content-type"];
    expect(ct.startsWith("multipart/related; boundary=")).toBe(true);
    const boundary = ct.split("boundary=")[1];

    const raw = new TextDecoder("latin1").decode(c.body);
    expect(raw.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(raw.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    expect(raw).toContain('"borivon_doc_id":"d1"'); // appProperties ride in the metadata part
    expect(raw).toContain("Content-Type: application/pdf");
    // The PDF bytes must survive byte-for-byte — a corrupted dossier is worse
    // than a missing one, because nobody checks a file that arrived.
    expect(raw).toContain("%PDF-1.7");
  });

  it("files.create buffers the Node Readable that lib/driveMirror.ts wraps R2 bodies in", async () => {
    const s = stubFetch([{ json: { id: "doc-2" } }]);
    restore = s.restore;
    const drive = await client();

    await drive.files.create({
      requestBody: { name: "cv.pdf", parents: ["cand-1"] },
      media: { mimeType: "application/pdf", body: Readable.from([new Uint8Array([1, 2]), new Uint8Array([3, 4])]) },
      fields: "id",
    });

    const raw = new TextDecoder("latin1").decode(s.calls[1].body);
    expect(raw).toContain("\x01\x02\x03\x04"); // both chunks, in order
  });

  it("files.update moves a file between folders with addParents/removeParents — LAW #33's archive step", async () => {
    const s = stubFetch([{ json: { id: "doc-1" } }]);
    restore = s.restore;
    const drive = await client();

    await drive.files.update({
      fileId: "doc-1", addParents: "archiv-1", removeParents: "vor-1", supportsAllDrives: true,
    });

    const c = s.calls[1];
    expect(c.method).toBe("PATCH");
    expect(c.url.startsWith("https://www.googleapis.com/drive/v3/files/doc-1?")).toBe(true);
    expect(params(c.url)).toEqual({ supportsAllDrives: "true", addParents: "archiv-1", removeParents: "vor-1" });
  });

  it("files.update WITH media patches the upload endpoint for that file id", async () => {
    const s = stubFetch([{ json: { id: "doc-1" } }]);
    restore = s.restore;
    const drive = await client();

    await drive.files.update({
      fileId: "doc-1", requestBody: { appProperties: { borivon_sha: "abc" } },
      media: { mimeType: "application/pdf", body: new Uint8Array([9]) }, supportsAllDrives: true,
    });

    const c = s.calls[1];
    expect(c.method).toBe("PATCH");
    expect(c.url.startsWith("https://www.googleapis.com/upload/drive/v3/files/doc-1?")).toBe(true);
    expect(params(c.url).uploadType).toBe("multipart");
    expect(new TextDecoder("latin1").decode(c.body)).toContain('"borivon_sha":"abc"');
  });

  it("files.get returns parsed metadata by default and the raw stream for alt=media", async () => {
    const s = stubFetch([
      { json: { parents: ["p1"], name: "x.pdf" } },
      { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) },
    ]);
    restore = s.restore;
    const drive = await client();

    const meta = await drive.files.get({ fileId: "doc-1", fields: "parents,name", supportsAllDrives: true });
    expect(meta.data.parents).toEqual(["p1"]);
    expect(params(s.calls[1].url)).toEqual({ fields: "parents,name", supportsAllDrives: "true" });

    // alt=media must NOT be JSON-parsed — the caller pipes these bytes straight
    // through to R2 / the browser.
    const media = await drive.files.get({ fileId: "doc-1", alt: "media", supportsAllDrives: true }, { responseType: "stream" });
    expect(params(s.calls[2].url).alt).toBe("media");
    const got = new Uint8Array(await new Response(media.data as ReadableStream).arrayBuffer());
    expect(Array.from(got)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("files.copy posts to /copy (the Sheets upgrade path)", async () => {
    const s = stubFetch([{ json: { id: "copy-1" } }]);
    restore = s.restore;
    const drive = await client();
    await drive.files.copy({ fileId: "src-1", requestBody: { name: "Sheet — Borivon (upgraded)" }, fields: "id", supportsAllDrives: true });
    const c = s.calls[1];
    expect(c.method).toBe("POST");
    expect(c.url.startsWith("https://www.googleapis.com/drive/v3/files/src-1/copy?")).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(c.body)).name).toBe("Sheet — Borivon (upgraded)");
  });

  it("permissions.create forwards sendNotificationEmail and supportsAllDrives", async () => {
    const s = stubFetch([{ json: { id: "perm-1" } }]);
    restore = s.restore;
    const drive = await client();
    await drive.permissions.create({
      fileId: "f1", requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true, sendNotificationEmail: false, fields: "id",
    });
    const c = s.calls[1];
    expect(c.method).toBe("POST");
    expect(c.url.startsWith("https://www.googleapis.com/drive/v3/files/f1/permissions?")).toBe(true);
    expect(params(c.url)).toEqual({ supportsAllDrives: "true", sendNotificationEmail: "false", fields: "id" });
    expect(JSON.parse(new TextDecoder().decode(c.body))).toEqual({ role: "reader", type: "anyone" });
  });

  it("about.get defaults to fields=user — the batch-drive-sync health probe", async () => {
    const s = stubFetch([{ json: { user: { emailAddress: "founder@borivon.com" } } }]);
    restore = s.restore;
    const drive = await client();
    const r = await drive.about.get({ fields: "user(emailAddress)" });
    expect(s.calls[1].url).toBe("https://www.googleapis.com/drive/v3/about?fields=user%28emailAddress%29");
    expect(r.data.user.emailAddress).toBe("founder@borivon.com");
  });

  it("files.delete always throws — LAW #33 forbids deleting a candidate document", async () => {
    const s = stubFetch([]);
    restore = s.restore;
    const drive = await client();
    await expect(drive.files.delete({ fileId: "doc-1" })).rejects.toThrow(/forbidden.*LAW #33/);
    // And it must fail BEFORE any request leaves — not after Google has acted.
    expect(s.calls).toHaveLength(0);
  });

  it("a non-2xx throws with the status and a READABLE body, not Google's raw bytes", async () => {
    const s = stubFetch([{ status: 404, text: '{"error":{"message":"File not found: doc-1."}}' }]);
    restore = s.restore;
    const drive = await client();
    await expect(drive.files.get({ fileId: "doc-1" })).rejects.toThrow(/drive_rest 404 .*File not found: doc-1/);
  });

  it("a failed token mint throws instead of calling Drive unauthenticated", async () => {
    const orig = globalThis.fetch;
    let driveHits = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url === TOKEN_URL) return new Response('{"error":"unauthorized_client"}', { status: 401 });
      driveHits++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    restore = () => { globalThis.fetch = orig; };

    const drive = await client();
    await expect(drive.files.list({ q: "x" })).rejects.toThrow("google_token_mint_failed");
    expect(driveHits).toBe(0);
  });

  it("reuses the cached token across calls — one mint, many Drive requests", async () => {
    const s = stubFetch([{ json: { files: [] } }, { json: { files: [] } }]);
    restore = s.restore;
    const drive = await client();
    await drive.files.list({ q: "a" });
    await drive.files.list({ q: "b" });
    // token, drive, drive — a second mint per request would triple the latency of
    // a sync that already makes one call per document.
    expect(s.calls.map((c) => c.url === TOKEN_URL)).toEqual([true, false, false]);
  });
});
