import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { parseBackupKey, encryptBackup, decryptBackup } from "@/lib/authBackupCrypto";
import * as script from "../d1/decrypt-auth-backup.mjs";

/**
 * The login backup is only worth anything if the file the Worker seals is one the
 * founder's laptop can open, with his key and no other. The Worker side
 * (lib/authBackupCrypto.ts) and the laptop side (d1/decrypt-auth-backup.mjs) are
 * separate code, so the round trip is proven ACROSS them, and every way it must
 * fail is checked to fail.
 */

const enc = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const newKey = () => crypto.randomBytes(32).toString("base64");
function keyBytes(raw: string) {
  const k = parseBackupKey(raw);
  if (k.state !== "ok") throw new Error("test key rejected");
  return k.key;
}

describe("AES-256-GCM login backup", () => {
  const PAYLOAD = JSON.stringify({ users: [{ id: "u1", email: "a@example.test", encrypted_password: "$2a$10$abc" }] });

  it("what the Worker seals, the laptop script opens (and the Worker side too)", async () => {
    const raw = newKey();
    const sealed = await encryptBackup(enc(PAYLOAD), keyBytes(raw));
    expect(await script.decryptAuthBackup(sealed, raw)).toBe(PAYLOAD);
    expect(new TextDecoder().decode(await decryptBackup(sealed, keyBytes(raw)))).toBe(PAYLOAD);
    expect(Buffer.from(sealed).toString("latin1")).not.toContain("example.test");
  });

  it("a wrong key fails on both sides", async () => {
    const sealed = await encryptBackup(enc(PAYLOAD), keyBytes(newKey()));
    const other = newKey();
    await expect(script.decryptAuthBackup(sealed, other)).rejects.toThrow(/wrong AUTH_BACKUP_KEY/);
    await expect(decryptBackup(sealed, keyBytes(other))).rejects.toThrow(/wrong key/);
  });

  it("a flipped byte anywhere — header, IV, body or tag — fails", async () => {
    const raw = newKey();
    const sealed = await encryptBackup(enc(PAYLOAD), keyBytes(raw));
    for (const at of [9, 15, 30, sealed.length - 1]) {
      const bad = sealed.slice();
      bad[at] ^= 1;
      await expect(script.decryptAuthBackup(bad, raw), `byte ${at}`).rejects.toThrow();
    }
    const badMagic = sealed.slice();
    badMagic[0] ^= 1;
    await expect(script.decryptAuthBackup(badMagic, raw)).rejects.toThrow(/not an auth backup/);
    await expect(script.decryptAuthBackup(new Uint8Array(10), raw)).rejects.toThrow(/not an auth backup/);
  });

  it("a fresh IV every time: the same export never seals to the same bytes", async () => {
    const k = keyBytes(newKey());
    const a = await encryptBackup(enc(PAYLOAD), k);
    const b = await encryptBackup(enc(PAYLOAD), k);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("keys: exactly 32 random bytes in standard base64, on both sides alike", () => {
    const good = newKey();
    expect(parseBackupKey(good).state).toBe("ok");
    expect(script.parseBackupKey(good)).toBeInstanceOf(Uint8Array);
    expect(parseBackupKey(`  ${good}\n`).state).toBe("ok");
    for (const absent of [undefined, "", "   "]) {
      expect(parseBackupKey(absent).state).toBe("absent");
      expect(script.parseBackupKey(absent)).toBe("absent");
    }
    for (const bad of [
      "correct horse battery staple",
      crypto.randomBytes(32).toString("hex"),
      crypto.randomBytes(31).toString("base64"),
      crypto.randomBytes(33).toString("base64"),
      crypto.randomBytes(32).toString("base64url"),
    ]) {
      expect(parseBackupKey(bad).state, bad).toBe("malformed");
      expect(script.parseBackupKey(bad), bad).toBe("malformed");
    }
  });

  it("the script refuses a missing or malformed key before touching the file", async () => {
    await expect(script.decryptAuthBackup(new Uint8Array(64), undefined)).rejects.toThrow(/not set/);
    await expect(script.decryptAuthBackup(new Uint8Array(64), "short")).rejects.toThrow(/malformed/);
  });
});

describe("decrypt-auth-backup.mjs output location", () => {
  const repo = process.cwd();

  it("refuses to write the clear-text accounts inside the repository", () => {
    expect(script.outputRefusal(path.join(repo, "auth.json"), repo)).toMatch(/inside the repository/);
    expect(script.outputRefusal(path.join(repo, "d1", "auth.json"), repo)).toMatch(/inside the repository/);
  });

  it("refuses any other git checkout, a folder that does not exist, and an existing file", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "bv-auth-backup-"));
    try {
      fs.mkdirSync(path.join(base, "checkout", ".git"), { recursive: true });
      fs.mkdirSync(path.join(base, "checkout", "sub"), { recursive: true });
      expect(script.outputRefusal(path.join(base, "checkout", "sub", "auth.json"), repo)).toMatch(/git checkout/);
      expect(script.outputRefusal(path.join(base, "nope", "auth.json"), repo)).toMatch(/does not exist/);

      // Outside every checkout it is allowed — unless the temp folder itself sits in one on this machine.
      let tmpInGit = false;
      for (let d = fs.realpathSync.native(base); ; d = path.dirname(d)) {
        if (fs.existsSync(path.join(d, ".git"))) tmpInGit = true;
        if (path.dirname(d) === d) break;
      }
      if (!tmpInGit) {
        expect(script.outputRefusal(path.join(base, "auth.json"), repo)).toBeNull();
        fs.writeFileSync(path.join(base, "auth.json"), "x");
        expect(script.outputRefusal(path.join(base, "auth.json"), repo)).toMatch(/already exists/);
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
