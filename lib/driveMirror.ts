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

export type CalmaroiSyncResult =
  | { ok: true; skipped_reason?: "unassigned" | "not_calmaroi"; folderUrl?: string; uploaded?: number; unchanged?: number }
  | { ok: false; error: "workspace_not_connected" | "mirror_failed"; hint?: string };

/**
 * Mirror ONE candidate's approved docs into the Calmaroi Drive tree, if (and only
 * if) they're assigned to a Calmaroi employer. Idempotent + cheap: skips any doc
 * whose file_sha256 already equals its recorded drive_mirror_sha256. Fail-safe —
 * returns a typed result, never throws (callers fire it best-effort so a Drive
 * hiccup never blocks a doc approval or an assignment).
 */
export async function syncCalmaroiCandidateToDrive(
  db: SupabaseClient,
  userId: string,
): Promise<CalmaroiSyncResult> {
  try {
    // 1. Calmaroi org (resolved by name so we never hardcode the UUID).
    const { data: orgs } = await db.from("organizations").select("id,name").ilike("name", "calmaroi");
    const calmaroi = (orgs ?? [])[0] as { id: string; name: string } | undefined;
    if (!calmaroi) return { ok: true, skipped_reason: "not_calmaroi" };

    // 2. Candidate → employer → is it a Calmaroi employer?
    const { data: prof } = await db
      .from("candidate_profiles")
      .select("employer_id,first_name,last_name")
      .eq("user_id", userId)
      .maybeSingle();
    const employerId = (prof as { employer_id?: string | null } | null)?.employer_id ?? null;
    if (!employerId) return { ok: true, skipped_reason: "unassigned" };
    const { data: emp } = await db
      .from("employers")
      .select("id,name,agency_id")
      .eq("id", employerId)
      .maybeSingle();
    const employer = emp as { id: string; name: string | null; agency_id: string | null } | null;
    if (!employer || employer.agency_id !== calmaroi.id) return { ok: true, skipped_reason: "not_calmaroi" };

    // 3. Batch folder = the employer's batch name (e.g. UKSH_KIEL_APRIL_2027),
    //    newest first; fall back to the employer name if no batch exists yet.
    const { data: batches } = await db
      .from("employer_batches")
      .select("name,created_at")
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(1);
    const batchName = ((batches ?? [])[0] as { name?: string } | undefined)?.name
      || employer.name
      || "Batch";

    // 4. Candidate display name — real name lives in auth metadata, profile is a fallback.
    let candidateName = "";
    try {
      const { data: au } = await db.auth.admin.getUserById(userId);
      candidateName = (au?.user?.user_metadata?.full_name as string | undefined)?.trim() || "";
    } catch { /* fall through to profile name */ }
    if (!candidateName) {
      const p = prof as { first_name?: string | null; last_name?: string | null } | null;
      candidateName = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
    }
    if (!candidateName) candidateName = `Kandidat ${userId.slice(0, 8)}`;

    // 5. Approved docs with R2 bytes, newest-per-filename.
    const { data: rawDocs } = await db
      .from("documents")
      .select("id,file_name,file_type,r2_key,file_sha256,drive_mirror_id,drive_mirror_sha256,uploaded_at")
      .eq("user_id", userId)
      .eq("status", "approved")
      .is("superseded_at", null)
      .not("r2_key", "is", null);
    const docs = latestApprovedPerName((rawDocs ?? []) as ApprovedDoc[]);
    // Work out what actually needs uploading BEFORE touching Drive — a doc whose
    // file_sha256 already matches its recorded drive_mirror_sha256 is done. If
    // nothing's new, return WITHOUT a single Drive call, so re-runs (and the
    // every-approval hook once a candidate is fully mirrored) are effectively
    // free — just DB reads. This is what keeps the backfill cheap on repeat.
    const isMirrored = (d: ApprovedDoc) => !!(d.drive_mirror_id && d.file_sha256 && d.drive_mirror_sha256 === d.file_sha256);
    const toUpload = docs.filter((d) => !isMirrored(d));
    const alreadyDone = docs.length - toUpload.length;
    if (toUpload.length === 0) return { ok: true, uploaded: 0, unchanged: alreadyDone };

    // 6. Drive tree + per-doc mirror (only the ones that changed / are new).
    const drive = driveClient();
    if (!drive) return { ok: false, error: "workspace_not_connected", hint: "Connect Google Workspace (the Drive scope)." };
    const agencyId = await findOrCreateFolder(drive, agencyRootFolderName(calmaroi.name));
    const batchId = await findOrCreateFolder(drive, batchName, agencyId);
    const candFolderId = await findOrCreateFolder(drive, candidateName, batchId);

    let uploaded = 0;
    const unchanged = alreadyDone;
    for (const d of toUpload) {
      const obj = await r2GetObject(d.r2_key!);
      if (!obj) continue;
      const name = d.file_name || `${d.file_type || "document"}.pdf`;
      const media = { mimeType: obj.contentType || "application/pdf", body: Readable.from(obj.body) };
      let fileId = d.drive_mirror_id ?? null;
      // Trust the recorded id if we have one; else look for a same-name file to
      // update (so pre-existing manual copies aren't duplicated), else create.
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
    return { ok: true, folderUrl: `https://drive.google.com/drive/folders/${candFolderId}`, uploaded, unchanged };
  } catch (e) {
    return { ok: false, error: "mirror_failed", hint: e instanceof Error ? e.message : String(e) };
  }
}
