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
import type { SupabaseClient } from "@supabase/supabase-js";

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

// ─────────────────────────────────────────────────────────────────────────────
// Calmaroi auto-share — approved docs → Drive, on approval / assignment.
// Folder tree the founder specified:
//   "Calmaroi X Borivon" / "<batch e.g. UKSH_KIEL_APRIL_2027>" / "<Candidate>" / <docs>
// ONLY for candidates assigned to a Calmaroi employer; ONLY approved docs; each
// doc mirrored once (skipped while its file_sha256 is unchanged — no wasted API).
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovedDoc = {
  id: string;
  file_name: string | null;
  file_type: string | null;
  r2_key: string | null;
  file_sha256: string | null;
  drive_mirror_id: string | null;
  drive_mirror_sha256: string | null;
  uploaded_at: string | null;
};

/**
 * Collapse re-uploads: a candidate often has several APPROVED rows with the SAME
 * file_name (old + new versions). They'd all map to one Drive file anyway, so
 * keep only the newest per file_name — avoids N wasteful R2 reads + Drive writes.
 * Pure (unit-tested).
 */
export function latestApprovedPerName(docs: ApprovedDoc[]): ApprovedDoc[] {
  const byName = new Map<string, ApprovedDoc>();
  for (const d of docs) {
    if (!d.r2_key) continue;
    const key = (d.file_name || d.file_type || d.id).toLowerCase();
    const cur = byName.get(key);
    const t = (x: ApprovedDoc) => (x.uploaded_at ? Date.parse(x.uploaded_at) : 0);
    if (!cur || t(d) >= t(cur)) byName.set(key, d);
  }
  return [...byName.values()];
}

/** Agency root folder name, e.g. "Calmaroi" → "Calmaroi X Borivon". Pure. */
export function agencyRootFolderName(orgName: string): string {
  return `${(orgName || "Agentur").trim()} X Borivon`;
}

/**
 * Resolve everything a batch sync needs (works for ANY agency/employer, not just
 * Calmaroi): the Drive root name ("<Agency> X Borivon", or the employer's name
 * when the batch has no agency org), the batch folder name, and the user_ids of
 * the candidates IN that batch (candidate_pipeline.batch_id — the exact set the
 * tracker shows under the batch). Returns null if the batch doesn't exist.
 */
export async function resolveBatchSyncTargets(
  db: SupabaseClient,
  batchId: string,
): Promise<{ agencyRootName: string; batchName: string; userIds: string[] } | null> {
  const { data: batch } = await db
    .from("employer_batches")
    .select("id,name,org_id,employer_id")
    .eq("id", batchId)
    .maybeSingle();
  const b = batch as { id: string; name: string | null; org_id: string | null; employer_id: string | null } | null;
  if (!b) return null;

  // Root = the agency (org) name; fall back to the employer name when the batch
  // has no agency org, so direct-employer batches still group cleanly.
  let rootBase = "";
  if (b.org_id) {
    const { data: org } = await db.from("organizations").select("name").eq("id", b.org_id).maybeSingle();
    rootBase = (org as { name?: string } | null)?.name?.trim() || "";
  }
  if (!rootBase && b.employer_id) {
    const { data: emp } = await db.from("employers").select("name").eq("id", b.employer_id).maybeSingle();
    rootBase = (emp as { name?: string } | null)?.name?.trim() || "";
  }

  // Candidates in the batch = candidate_pipeline rows pointing at this batch.
  const { data: pipe } = await db.from("candidate_pipeline").select("user_id").eq("batch_id", batchId);
  const userIds = [...new Set((pipe ?? []).map((r) => (r as { user_id: string }).user_id))];

  return { agencyRootName: agencyRootFolderName(rootBase), batchName: b.name || "Batch", userIds };
}

export type CandidateMirrorResult =
  | { ok: true; uploaded: number; unchanged: number }
  | { ok: false; error: "workspace_not_connected" | "mirror_failed"; hint?: string };

/**
 * Mirror ONE candidate's approved docs into <batchFolderId>/<Candidate name>/.
 * Idempotent + cheap: a doc whose file_sha256 already matches its recorded
 * drive_mirror_sha256 is skipped with ZERO Drive calls (the candidate folder is
 * only created when there's actually something to upload). Never throws.
 *
 * The caller (batch-drive-sync route) creates the shared agency + batch folders
 * ONCE and passes batchFolderId here, so those lookups aren't repeated per
 * candidate. `drive` is the DWD Drive client (impersonating the founder).
 */
export async function mirrorCandidateApprovedDocs(
  db: SupabaseClient,
  drive: Drive,
  userId: string,
  batchFolderId: string,
): Promise<CandidateMirrorResult> {
  try {
    // Approved docs with R2 bytes, newest-per-filename.
    const { data: rawDocs } = await db
      .from("documents")
      .select("id,file_name,file_type,r2_key,file_sha256,drive_mirror_id,drive_mirror_sha256,uploaded_at")
      .eq("user_id", userId)
      .eq("status", "approved")
      .is("superseded_at", null)
      .not("r2_key", "is", null);
    const docs = latestApprovedPerName((rawDocs ?? []) as ApprovedDoc[]);
    // Decide what's new BEFORE touching Drive → nothing new = zero Drive calls.
    const isMirrored = (d: ApprovedDoc) => !!(d.drive_mirror_id && d.file_sha256 && d.drive_mirror_sha256 === d.file_sha256);
    const toUpload = docs.filter((d) => !isMirrored(d));
    const unchanged = docs.length - toUpload.length;
    if (toUpload.length === 0) return { ok: true, uploaded: 0, unchanged };

    // Candidate display name — real name lives in auth metadata, profile is a fallback.
    let candidateName = "";
    try {
      const { data: au } = await db.auth.admin.getUserById(userId);
      candidateName = (au?.user?.user_metadata?.full_name as string | undefined)?.trim() || "";
    } catch { /* fall through */ }
    if (!candidateName) {
      const { data: prof } = await db.from("candidate_profiles").select("first_name,last_name").eq("user_id", userId).maybeSingle();
      const p = prof as { first_name?: string | null; last_name?: string | null } | null;
      candidateName = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
    }
    if (!candidateName) candidateName = `Kandidat ${userId.slice(0, 8)}`;

    const candFolderId = await findOrCreateFolder(drive, candidateName, batchFolderId);

    let uploaded = 0;
    for (const d of toUpload) {
      const obj = await r2GetObject(d.r2_key!);
      if (!obj) continue;
      const name = d.file_name || `${d.file_type || "document"}.pdf`;
      const media = { mimeType: obj.contentType || "application/pdf", body: Readable.from(obj.body) };
      let fileId = d.drive_mirror_id ?? null;
      // Trust the recorded id; else find a same-name file to update (no dupes); else create.
      if (!fileId) {
        const existing = await drive.files.list({
          q: `name='${esc(name)}' and '${candFolderId}' in parents and trashed=false`,
          fields: "files(id)", pageSize: 1,
        });
        fileId = existing.data.files?.[0]?.id ?? null;
      }
      if (fileId) {
        try { await drive.files.update({ fileId, media }); }
        catch { fileId = (await drive.files.create({ requestBody: { name, parents: [candFolderId] }, media, fields: "id" })).data.id as string; }
      } else {
        fileId = (await drive.files.create({ requestBody: { name, parents: [candFolderId] }, media, fields: "id" })).data.id as string;
      }
      await db.from("documents").update({ drive_mirror_id: fileId, drive_mirror_sha256: d.file_sha256 }).eq("id", d.id);
      uploaded++;
    }
    return { ok: true, uploaded, unchanged };
  } catch (e) {
    return { ok: false, error: "mirror_failed", hint: e instanceof Error ? e.message : String(e) };
  }
}

/** Create the shared "<Agency> X Borivon" / "<Batch>" folders once; returns the batch folder id. */
export async function ensureBatchFolder(drive: Drive, agencyRootName: string, batchName: string): Promise<string> {
  const rootId = await findOrCreateFolder(drive, agencyRootName);
  return findOrCreateFolder(drive, batchName, rootId);
}

/** The DWD Drive client, or null if Workspace/Drive isn't connected. */
export function getDriveOrNull(): Drive | null {
  return driveClient() ?? null;
}
