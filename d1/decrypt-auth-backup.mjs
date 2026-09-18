/**
 * Open one daily login backup (lib/supabaseFreePlanSafety.ts writes them to R2
 * as backups/auth-users/<YYYY-MM-DD>.json.enc).
 *
 *   npx wrangler r2 object get borivon-files/backups/auth-users/<date>.json.enc --file <outside-repo>\auth.enc --remote
 *   node d1/decrypt-auth-backup.mjs <outside-repo>\auth.enc <outside-repo>\auth.json
 *
 * The key is AUTH_BACKUP_KEY from the environment ($env:AUTH_BACKUP_KEY="…" for one
 * shell), else from .env.local at the repo root — a fallback for a key already sitting
 * there, not a place to put one: npm run cf:build compiles .env.local INTO the Worker
 * bundle, and a baked value outlives `wrangler secret delete`. Prints counts only.
 *
 * The output holds every candidate's email and password hash in the clear, so it
 * refuses to write inside any git checkout (this repo, its worktrees, any other):
 * one `git add .` would put it in history for good. It also never overwrites an
 * existing file.
 *
 * Same file layout as lib/authBackupCrypto.ts:
 *   "BVAUTHB1" | 12-byte IV | AES-256-GCM ciphertext + tag, header as additional data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./guards.mjs";

const MAGIC = "BVAUTHB1";
const IV_BYTES = 12;

/** "absent" | "malformed" | Uint8Array(32) — the same rule as lib/authBackupCrypto.ts. */
export function parseBackupKey(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return "absent";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(v)) return "malformed";
  const key = new Uint8Array(Buffer.from(v, "base64"));
  return key.length === 32 ? key : "malformed";
}

/** Plaintext JSON text. Throws on a wrong key, a damaged file or a file that is not a backup. */
export async function decryptAuthBackup(fileBytes, rawKey) {
  const key = parseBackupKey(rawKey);
  if (key === "absent") throw new Error("AUTH_BACKUP_KEY is not set");
  if (key === "malformed") throw new Error("AUTH_BACKUP_KEY is malformed (it must be 32 random bytes, base64)");
  const file = new Uint8Array(fileBytes);
  const magic = new TextEncoder().encode(MAGIC);
  if (file.length < magic.length + IV_BYTES + 16 || magic.some((b, i) => file[i] !== b)) throw new Error("not an auth backup file");
  const k = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: file.slice(magic.length, magic.length + IV_BYTES), additionalData: magic, tagLength: 128 },
      k,
      file.slice(magic.length + IV_BYTES),
    );
  } catch {
    throw new Error("cannot decrypt: wrong AUTH_BACKUP_KEY or a damaged file");
  }
  return new TextDecoder().decode(plain);
}

function inside(dir, p) {
  const rel = path.relative(dir, p);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Why the output may not go to `target`, or null when it may. */
export function outputRefusal(target, repoRoot) {
  const abs = path.resolve(target);
  const parent = path.dirname(abs);
  let real;
  try { real = fs.realpathSync.native(parent); } catch { return `the output folder ${parent} does not exist`; }
  let realRoot = path.resolve(repoRoot);
  try { realRoot = fs.realpathSync.native(realRoot); } catch { /* compare the plain path */ }
  if (inside(path.resolve(repoRoot), abs) || inside(realRoot, real)) return `${abs} is inside the repository`;
  // Resolved through junctions/symlinks, then every ancestor: a checkout anywhere above counts.
  for (let d = real; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return `${abs} is inside the git checkout ${d}`;
    if (path.dirname(d) === d) break;
  }
  if (fs.existsSync(abs)) return `${abs} already exists`;
  return null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("usage: node d1/decrypt-auth-backup.mjs <backup.json.enc> <output.json outside any git checkout>");
    process.exit(2);
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const refusal = outputRefusal(output, repoRoot);
  if (refusal) { console.error(`refusing: ${refusal}`); process.exit(2); }

  let raw = process.env.AUTH_BACKUP_KEY;
  if (!raw) { try { raw = readEnvFile(repoRoot).AUTH_BACKUP_KEY; } catch { /* reported below */ } }

  let text;
  try {
    text = await decryptAuthBackup(fs.readFileSync(input), raw);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const doc = JSON.parse(text);
  fs.writeFileSync(output, text, { flag: "wx", mode: 0o600 });
  const users = Array.isArray(doc.users) ? doc.users : [];
  const identities = users.reduce((n, u) => n + (Array.isArray(u.identities) ? u.identities.length : 0), 0);
  console.log(`decrypted: ${users.length} account(s), ${identities} identit(ies), exported ${doc.exported_at}, ${Buffer.byteLength(text)} bytes -> ${path.resolve(output)}`);
  console.log("it holds password hashes in the clear: delete it when you are done");
}
