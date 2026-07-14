/**
 * Google Drive MIRROR of candidate documents (SERVER ONLY, Node runtime).
 *
 * R2 stays the source of truth; this copies a candidate's PDFs into a folder in
 * the FOUNDER's Google Drive ("Borivon Candidates / <name>") so he can SHARE the
 * folder with someone without re-uploading. On-demand, per candidate.
 *
 * It only PLACES files in the founder's own Drive (via the domain-wide-delegation
 * driveClient that impersonates him — so the files are his). It deliberately does
 * NOT touch sharing permissions; the founder shares the folder himself from Drive.
 *
 * Fail-safe: typed error if Workspace/Drive isn't connected; never throws.
 * NOTE (Cloudflare): driveClient() is a real googleapis client (Node) — runs on
 * Vercel today; a Workers REST shim would be a later cutover task.
 */
import { driveClient } from "@/lib/googleWorkspace";
import { r2GetObject } from "@/lib/r2";
import { Readable } from "node:stream";

const ROOT_FOLDER = "Borivon Candidates";

export type MirrorDoc = { r2_key: string | null; file_name: string | null; file_type: string | null };
export type MirrorResult =
  | { ok: true; folderUrl: string; uploaded: number; skipped: number }
  | { ok: false; error: "workspace_not_connected" | "mirror_failed"; hint?: string };

// Drive query values are single-quoted → escape any apostrophe in a name.
const esc = (s: string) => s.replace(/'/g, "\\'");

type Drive = NonNullable<ReturnType<typeof driveClient>>;

async function findOrCreateFolder(drive: Drive, name: string, parentId?: string): Promise<string> {
  const parent = parentId ? `'${parentId}' in parents` : "'root' in parents";
  const q = `name='${esc(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and ${parent}`;
  const res = await drive.files.list({ q, fields: "files(id)", pageSize: 1, spaces: "drive" });
  const found = res.data.files?.[0]?.id;
  if (found) return found;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined },
    fields: "id",
  });
  return created.data.id as string;
}

/** Copy every doc's bytes (from R2) into the founder's Drive folder for `candidateName`. */
export async function mirrorCandidateToDrive(docs: MirrorDoc[], candidateName: string): Promise<MirrorResult> {
  const drive = driveClient();
  if (!drive) return { ok: false, error: "workspace_not_connected", hint: "Connect Google Workspace (the Drive scope) — the same one Gmail uses." };
  try {
    const rootId = await findOrCreateFolder(drive, ROOT_FOLDER);
    const folderId = await findOrCreateFolder(drive, candidateName || "Candidate", rootId);
    let uploaded = 0;
    let skipped = 0;
    for (const d of docs) {
      if (!d.r2_key) { skipped++; continue; }
      const obj = await r2GetObject(d.r2_key);
      if (!obj) { skipped++; continue; }
      const name = d.file_name || `${d.file_type || "document"}.pdf`;
      const mimeType = obj.contentType || "application/pdf";
      // Replace an existing same-name file so re-runs keep the folder current (no dupes).
      const existing = await drive.files.list({
        q: `name='${esc(name)}' and '${folderId}' in parents and trashed=false`,
        fields: "files(id)", pageSize: 1,
      });
      const media = { mimeType, body: Readable.from(obj.body) };
      const existingId = existing.data.files?.[0]?.id;
      if (existingId) {
        await drive.files.update({ fileId: existingId, media });
      } else {
        await drive.files.create({ requestBody: { name, parents: [folderId] }, media, fields: "id" });
      }
      uploaded++;
    }
    return { ok: true, folderUrl: `https://drive.google.com/drive/folders/${folderId}`, uploaded, skipped };
  } catch (e) {
    return { ok: false, error: "mirror_failed", hint: e instanceof Error ? e.message : String(e) };
  }
}
