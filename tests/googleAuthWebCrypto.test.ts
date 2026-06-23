import { describe, it, expect } from "vitest";
import { buildGoogleJwtAssertion } from "../lib/googleAuthWebCrypto";

// Proves the Cloudflare-migration de-risk: minting a Google service-account JWT with
// WebCrypto (crypto.subtle RS256) — the exact signing that the googleapis JWT client does
// in a way that breaks on Workers — works here, runtime-agnostically. We generate a real
// RSA keypair, have the module sign an assertion, then VERIFY the signature with the public
// key and decode the claims. No network, no real key → deterministic.

const te = new TextEncoder();
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function b64urlToJson(s: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}
function abToPem(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

async function genKeypair() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  return { pem: abToPem(pkcs8), publicKey: kp.publicKey };
}

describe("buildGoogleJwtAssertion — WebCrypto RS256 service-account JWT (Workers-safe)", () => {
  const NOW = 1_750_000_000; // fixed for determinism

  it("produces a 3-part JWT whose signature verifies and whose claims are correct (DWD)", async () => {
    const { pem, publicKey } = await genKeypair();
    const assertion = await buildGoogleJwtAssertion({
      key: { client_email: "bot@borivon.iam.gserviceaccount.com", private_key: pem },
      subject: "youness@borivon.com",
      scopes: ["https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/calendar"],
      now: NOW,
    });
    const parts = assertion.split(".");
    expect(parts.length).toBe(3);

    // Header + claims decode correctly.
    const header = b64urlToJson(parts[0]);
    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");
    const claims = b64urlToJson(parts[1]);
    expect(claims.iss).toBe("bot@borivon.iam.gserviceaccount.com");
    expect(claims.sub).toBe("youness@borivon.com"); // impersonated user
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar");
    expect(claims.iat).toBe(NOW);
    expect(claims.exp).toBe(NOW + 3600);

    // The signature actually verifies against the public key over "header.claims".
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      b64urlToBytes(parts[2]) as BufferSource,
      te.encode(`${parts[0]}.${parts[1]}`) as BufferSource,
    );
    expect(ok).toBe(true);
  });

  it("a tampered payload fails verification (the signature is real, not cosmetic)", async () => {
    const { pem, publicKey } = await genKeypair();
    const assertion = await buildGoogleJwtAssertion({
      key: { client_email: "bot@x.iam.gserviceaccount.com", private_key: pem },
      subject: "a@b.com",
      scopes: ["https://www.googleapis.com/auth/drive"],
      now: NOW,
    });
    const [h, , sig] = assertion.split(".");
    // Forge a different claims segment, keep the original signature → must NOT verify.
    const forged = h + "." + assertion.split(".")[1].slice(0, -2) + "XX";
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      b64urlToBytes(sig) as BufferSource,
      te.encode(forged) as BufferSource,
    );
    expect(ok).toBe(false);
  });
});
