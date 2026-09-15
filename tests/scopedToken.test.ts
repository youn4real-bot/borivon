import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";

// Both implementations read the key at call time; fix it before anything signs.
process.env.DL_TOKEN_SECRET = "test-scoped-web-secret-eeeeeeeeeeeeeeeeeeeeeeee";

import { signScopedToken, verifyScopedToken, signDlToken, verifyDlToken } from "../lib/dlToken";
import { signScopedTokenWeb, verifyScopedTokenWeb } from "../lib/scopedToken";
import { stableObjectId } from "../lib/storage/r2StorageFetch";

/**
 * The R2 storage path moved from Node's `crypto` to Web Crypto so it can be
 * loaded through lib/supabase.ts without breaking the edge build. Everything it
 * produces must stay byte-identical: a signed URL minted by one isolate is
 * checked by another (and during a deploy, by the other version), and object
 * ids are what storage-js callers see across uploads and lists. The Node
 * formulas here are the ones main shipped (lib/dlToken.ts, r2StorageFetch at e85edfe).
 */

const nodeObjectId = (bucket: string, path: string) => {
  const h = crypto.createHash("sha256").update(`${bucket}/${path}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

// The shapes real object paths take, plus the ones where a UTF-8 encoder could differ.
const INPUTS: [string, string][] = [
  ["sign-documents", "cand-1/req 1-signed.pdf"],
  ["slot-templates", "slot-templates/11111111-1111-4111-8111-111111111111.pdf"],
  ["slot-templates", "slot-templates/archive/11111111-1111-4111-8111-111111111111_2026-09-01T10-00-00-000Z.pdf"],
  ["profile-photos", "0b7d4f0e-2c1a-4c5e-9d7a-3f1e2b4c5d6e.webp"],
  ["sign-documents", "doc-cache/1ZRGa_-xY0"],
  ["sign-documents", "c/Müller Straße ß.pdf"],
  ["feed-photos", "\u{1F600}/x y+z%20.jpg"],
  ["sign-documents", "lone\uD800surrogate.pdf"],
  ["sign-documents", `long/${"a".repeat(70_000)}.pdf`],
];

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("storage object ids: Web Crypto sha256 = Node's", () => {
  it("every input gives the id main's Node code gave", async () => {
    for (const [bucket, path] of INPUTS) expect(await stableObjectId(bucket, path), path.slice(0, 40)).toBe(nodeObjectId(bucket, path));
  });
});

describe("scoped tokens: the Web Crypto twin signs and checks the same bytes", () => {
  const freeze = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T01:40:00.456Z"));
  };

  it("the same claims in the same second give the identical string", async () => {
    freeze();
    for (const [bucket, path] of INPUTS) {
      const claims = { p: "storage", o: `${bucket}/${path}` };
      expect(await signScopedTokenWeb(claims, 3600)).toBe(signScopedToken(claims, 3600));
    }
    expect(await signScopedTokenWeb({ u: "user-abc" }, 180)).toBe(signDlToken("user-abc", 180));
    // Odd TTLs go through the same floor/min(1) on both sides.
    expect(await signScopedTokenWeb({ p: "storage", o: "b/x" }, 0.4)).toBe(signScopedToken({ p: "storage", o: "b/x" }, 0.4));
  });

  it("each side accepts the other's tokens with the same claims", async () => {
    for (const [bucket, path] of INPUTS) {
      const claims = { p: "storage", o: `${bucket}/${path}` };
      const web = await signScopedTokenWeb(claims, 60);
      const node = signScopedToken(claims, 60);
      expect(verifyScopedToken(web)).toEqual(await verifyScopedTokenWeb(web));
      expect(await verifyScopedTokenWeb(node)).toEqual(verifyScopedToken(node));
      expect(await verifyScopedTokenWeb(node)).toMatchObject({ ok: true, claims });
    }
    expect(verifyDlToken(await signScopedTokenWeb({ u: "u1" }, 60))).toEqual({ userId: "u1" });
  });

  it("refuses exactly what the Node version refuses, for the same reason", async () => {
    const good = signScopedToken({ p: "storage", o: "sign-documents/a.pdf" }, 60);
    const [payload, sig] = good.split(".");
    const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const signed = (json: string) => {
      const p = b64url(Buffer.from(json));
      return `${p}.${b64url(crypto.createHmac("sha256", process.env.DL_TOKEN_SECRET!).update(p).digest())}`;
    };
    const cases: (string | null | undefined)[] = [
      null, undefined, "", "no-dot", ".sig", "payload.", `${payload}.`, `.${sig}`,
      `${payload.slice(0, -2)}AA.${sig}`, `${payload}.${sig.slice(0, -2)}zz`, `${payload}.${sig}x`, `${payload}.${sig.slice(1)}`,
      `${payload}.${sig}=`, `${payload}.é${sig.slice(1)}`, `${payload}=.${sig}`,
      signed("null"), signed("[]"), signed('{"e":"soon"}'), signed("not json"), signed('{"p":"storage"}'),
    ];
    for (const t of cases) expect(await verifyScopedTokenWeb(t), String(t)).toEqual(verifyScopedToken(t));

    const short = signScopedToken({ p: "storage", o: "b/x" }, 1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5_000);
    expect(verifyScopedToken(short)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyScopedTokenWeb(short)).toEqual({ ok: false, reason: "expired" });
  });

  it("a different key, or none at all, fails on both sides", async () => {
    const tok = await signScopedTokenWeb({ p: "storage", o: "b/x" }, 60);
    vi.stubEnv("DL_TOKEN_SECRET", "a-totally-different-secret-value-xxxxxxxxxxxx");
    expect(await verifyScopedTokenWeb(tok)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyScopedToken(tok)).toEqual({ ok: false, reason: "invalid" });

    vi.stubEnv("DL_TOKEN_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "");
    expect(() => signScopedToken({ u: "x" }, 60)).toThrow("no signing secret");
    await expect(signScopedTokenWeb({ u: "x" }, 60)).rejects.toThrow("no signing secret");
    expect(await verifyScopedTokenWeb(tok)).toEqual({ ok: false, reason: "invalid" });
  });
});
