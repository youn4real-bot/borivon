/**
 * AES-256-GCM for the daily login backup (lib/supabaseFreePlanSafety.ts).
 *
 * The backup holds every candidate's email and bcrypt password hash, and it sits
 * in the same R2 bucket as their documents. Anyone who can list that bucket must
 * still not be able to read it — so it is sealed with a key that lives only in
 * the Worker secret AUTH_BACKUP_KEY and the founder's password manager.
 *
 * Web Crypto only: the same code runs in workerd and in Node (the tests), with no
 * dependency to vet.
 *
 * File layout:  "BVAUTHB1" (8 ASCII bytes) | 12-byte random IV | ciphertext + 16-byte tag
 * The header is authenticated as additional data, so a file whose header was
 * altered fails exactly like a wrong key instead of decrypting under a guessed
 * format. d1/decrypt-auth-backup.mjs reads this layout; tests/authBackupCrypto.test.ts
 * proves a file written here is one that script opens.
 */

export const BACKUP_MAGIC = "BVAUTHB1";
const IV_BYTES = 12;

export type BackupKey =
  | { state: "absent" }
  | { state: "malformed" }
  | { state: "ok"; key: Uint8Array<ArrayBuffer> };

/**
 * AUTH_BACKUP_KEY must be exactly 32 random bytes in standard base64 (44
 * characters ending in "="), which is what `crypto.randomBytes(32).toString("base64")`
 * and `openssl rand -base64 32` print. Anything else is refused rather than
 * stretched or hashed into a key: a passphrase typed by hand would be the weakest
 * part of the backup, and a silently accepted typo would seal files nobody can
 * open.
 */
export function parseBackupKey(raw: string | undefined): BackupKey {
  const v = (raw ?? "").trim();
  if (!v) return { state: "absent" };
  if (!/^[A-Za-z0-9+/]{43}=$/.test(v)) return { state: "malformed" };
  const bin = atob(v);
  const key = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) key[i] = bin.charCodeAt(i);
  return key.length === 32 ? { state: "ok", key } : { state: "malformed" };
}

function header(): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(BACKUP_MAGIC) as Uint8Array<ArrayBuffer>;
}

export async function encryptBackup(plain: Uint8Array<ArrayBuffer>, key: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const magic = header();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const k = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: magic, tagLength: 128 }, k, plain));
  const out = new Uint8Array(magic.length + IV_BYTES + sealed.length);
  out.set(magic, 0);
  out.set(iv, magic.length);
  out.set(sealed, magic.length + IV_BYTES);
  return out;
}

/** Throws on a wrong key, a damaged file or a file that is not a backup. */
export async function decryptBackup(file: Uint8Array, key: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const magic = header();
  if (file.length < magic.length + IV_BYTES + 16 || magic.some((b, i) => file[i] !== b)) {
    throw new Error("not an auth backup file");
  }
  const iv = file.slice(magic.length, magic.length + IV_BYTES);
  const body = file.slice(magic.length + IV_BYTES);
  const k = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: magic, tagLength: 128 }, k, body));
  } catch {
    throw new Error("cannot decrypt: wrong key or damaged file");
  }
}
