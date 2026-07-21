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
import { isPreMatchDoc } from "@/lib/fileKeys";
import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";

const ROOT_FOLDER = "Borivon Candidates";
// The founder's top-level work location. Everything agency-facing lives INSIDE it:
//   WORK / "<Agency> X Borivon" / "<Batch>" / "<Candidate>" / { Vor Matching, Nach Matching }
// "WORK" may be a SHARED DRIVE or a plain folder — resolveWorkRootId handles both,
// and never creates a duplicate when one already exists.
const WORK_ROOT = "WORK";
// Sub-folders inside each candidate folder. "Vor Matching" holds the Essentials
// + Unterlagen dossier shared to find a match; "Nach Matching" is a placeholder
// for the post-match docs (visa, contract, Bearbeitung) — populated later.
const VOR_MATCHING = "Vor Matching";
const NACH_MATCHING = "Nach Matching";
// Where a copy goes once the portal no longer considers it current (replaced,
// rejected, archived). It is MOVED here, never deleted — mirroring LAW #33 and
// making a mistake fully recoverable. The agency only ever reads "Vor Matching",
// so it can never see a document the founder already threw away.
const ARCHIV = "Archiv";

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
  // supportsAllDrives/includeItemsFromAllDrives make this work when WORK is a
  // SHARED DRIVE (harmless for ordinary My-Drive folders).
  const res = await drive.files.list({
    q, fields: "files(id)", pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  const found = res.data.files?.[0]?.id;
  if (found) return found;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id as string;
}

/**
 * Resolve the founder's top-level "WORK" location, so agency folders land INSIDE
 * it instead of at the Drive root. Order: an existing SHARED DRIVE named WORK →
 * an existing FOLDER named WORK (anywhere, incl. shared drives) → create the
 * folder at My Drive root. Never duplicates an existing WORK.
 */
async function resolveWorkRootId(drive: Drive): Promise<string> {
  // 1) A Shared Drive literally named WORK.
  try {
    const sd = await drive.drives.list({ q: `name='${esc(WORK_ROOT)}'`, pageSize: 10, fields: "drives(id,name)" });
    const hit = (sd.data.drives ?? []).find((d) => (d.name ?? "").trim().toUpperCase() === WORK_ROOT);
    if (hit?.id) return hit.id;
  } catch { /* no shared-drive access or none exist → fall through */ }
  // 2) An existing folder named WORK anywhere he keeps it (not only My-Drive root).
  try {
    const f = await drive.files.list({
      q: `name='${esc(WORK_ROOT)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)", pageSize: 5,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    const folder = f.data.files?.[0]?.id;
    if (folder) return folder;
  } catch { /* fall through to create */ }
  // 3) Nothing found — create WORK at My Drive root.
  return findOrCreateFolder(drive, WORK_ROOT);
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

/**
 * The value recorded in drive_mirror_sha256 — "what did we last send the agency?".
 * PURE. Compared against itself on the next sync to decide skip-vs-re-upload.
 *
 * Prefers file_sha256, but MUST fall back to the r2_key, because file_sha256 is
 * null on the large majority of existing rows (it was added later, and several
 * insert paths drop it when the column isn't migrated). With a plain
 * `file_sha256 === drive_mirror_sha256` check those rows are never considered
 * mirrored, so every single sync re-downloaded and re-uploaded ALL of them
 * forever — the sync could never converge and only got slower as the dossier grew.
 *
 * r2_key is a sound content identity here: every write path mints a fresh
 * `candidates/<uid>/<timestamp>_<name>` key rather than overwriting (see the
 * "Unique timestamped key per upload" comment in app/api/portal/upload/route.ts),
 * so same key ⇒ same bytes, and changed bytes ⇒ changed key ⇒ re-upload.
 *
 * Deliberately does NOT write to file_sha256: that column is the LAW #39 passport
 * tamper-detection hash consumed by ensurePassportIntegrity(). Back-filling it
 * from whatever bytes happen to be in R2 today would bless any existing
 * corruption and permanently disable that guard.
 */
export function mirrorFingerprint(d: Pick<ApprovedDoc, "file_sha256" | "r2_key">): string | null {
  if (d.file_sha256) return d.file_sha256;
  return d.r2_key ? `r2key:${d.r2_key}` : null;
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
  | { ok: true; uploaded: number; unchanged: number; archived: number }
  | { ok: false; error: "workspace_not_connected" | "mirror_failed"; hint?: string };

/** Find a folder WITHOUT creating it (null when absent) — lets a candidate with
 *  nothing to sync and no folder yet cost zero Drive writes. */
async function findFolder(drive: Drive, name: string, parentId: string): Promise<string | null> {
  const res = await drive.files.list({
    q: `name='${esc(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`,
    fields: "files(id)", pageSize: 1,
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id ?? null;
}

/**
 * RETRACTION. Everything in "Vor Matching" that the mirror itself put there but
 * which the portal no longer treats as current (rejected, replaced, archived,
 * or the candidate left the batch) is MOVED into "Archiv".
 *
 * Two hard safety rules:
 *  • ONLY files carrying our `borivon_doc_id` marker are eligible. A file the
 *    founder dragged into the folder by hand has no marker and is never touched.
 *  • MOVE, never delete and never trash — Drive's trash auto-purges after ~30
 *    days, which is just a delayed hard delete and would break LAW #33 at the
 *    mirror boundary. A mistake here costs one drag-and-drop to undo.
 *
 * Returns how many copies were retracted. Never throws.
 */
export type MirrorFile = { id?: string | null; name?: string | null; appProperties?: Record<string, string> | null };

/**
 * Which mirrored files are no longer current and must be pulled out of the
 * agency's view? PURE so the safety rule is testable in isolation:
 *
 *   a file is eligible ONLY if the portal itself placed it there
 *   (appProperties.borivon_doc_id set by our own upload) AND that doc id is no
 *   longer among the candidate's live approved docs.
 *
 * Anything the founder dropped into the folder by hand carries no marker and is
 * therefore NEVER touched. Retraction = move to Archiv, never delete/trash
 * (LAW #33 — Drive trash auto-purges at ~30d, which is a delayed hard delete).
 */
export function selectStaleMirrorFiles(files: MirrorFile[], currentDocIds: Iterable<string>): MirrorFile[] {
  const live = new Set(currentDocIds);
  return files.filter((f) => {
    const docId = f.appProperties?.borivon_doc_id;
    return !!f.id && !!docId && !live.has(docId); // unmarked = founder's own → skip
  });
}

async function reconcileVorMatching(
  db: SupabaseClient,
  drive: Drive,
  currentDocs: ApprovedDoc[],
  vorId: string,
  candFolderId: string,
): Promise<number> {
  // Page through — a silent 200-file cap would leave stale copies visible.
  const found: MirrorFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${vorId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,appProperties)", pageSize: 200, pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    found.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  const stale = selectStaleMirrorFiles(found, currentDocs.map((d) => d.id));
  if (stale.length === 0) return 0;
  const archivId = await findOrCreateFolder(drive, ARCHIV, candFolderId); // lazily, only when needed
  let moved = 0;
  for (const f of stale) {
    try {
      await drive.files.update({ fileId: f.id!, addParents: archivId, removeParents: vorId, supportsAllDrives: true });
      moved++;
      // CRITICAL: sever this doc's mirror pointer. The row still carries
      // drive_mirror_id/_sha256 pointing at the file we just moved to Archiv.
      // If the doc later becomes live again (a rejected doc re-approved on the
      // SAME row, unchanged bytes), isMirrored would be true → we'd upload
      // nothing → the copy stays stranded in Archiv and the agency silently
      // never gets it back. Nulling the pointer forces a fresh Vor-Matching
      // upload next sync. (The archived file itself stays — LAW #33.)
      const docId = f.appProperties?.borivon_doc_id;
      if (docId) {
        await db.from("documents")
          .update({ drive_mirror_id: null, drive_mirror_sha256: null })
          .eq("id", docId)
          .then(undefined, () => { /* pointer reset is best-effort; retraction already happened */ });
      }
    } catch { /* one stuck file must never abort the whole sync */ }
  }
  return moved;
}

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
    // Only the PRE-match dossier (Essentials + Unterlagen) goes to "Vor Matching".
    // Post-match / Visum-phase docs are left for the "Nach Matching" folder (later).
    const docs = latestApprovedPerName((rawDocs ?? []) as ApprovedDoc[]).filter((d) => isPreMatchDoc(d.file_type));
    // Decide what's new BEFORE touching Drive → nothing new = zero Drive calls.
    const isMirrored = (d: ApprovedDoc) => {
      const fp = mirrorFingerprint(d);
      return !!(d.drive_mirror_id && fp && d.drive_mirror_sha256 === fp);
    };
    const toUpload = docs.filter((d) => !isMirrored(d));
    const unchanged = docs.length - toUpload.length;
    // NOTE: deliberately NO early return when toUpload is empty — that is exactly
    // the RETRACTION case (a doc was rejected/archived: nothing new to send, but a
    // copy must be pulled out of the agency's view). The cheap path is preserved
    // below instead: no folder yet + nothing to upload ⇒ zero Drive calls.

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

    // <Candidate> / { Vor Matching (dossier) , Nach Matching (placeholder) }.
    // Look the folder up WITHOUT creating it: a candidate with nothing to upload
    // and no folder yet has nothing stale either → return without a single write.
    let candFolderId = await findFolder(drive, candidateName, batchFolderId);
    if (!candFolderId && toUpload.length === 0) return { ok: true, uploaded: 0, unchanged, archived: 0 };
    if (!candFolderId) candFolderId = await findOrCreateFolder(drive, candidateName, batchFolderId);
    const vorId = await findOrCreateFolder(drive, VOR_MATCHING, candFolderId);
    if (toUpload.length) await findOrCreateFolder(drive, NACH_MATCHING, candFolderId); // placeholder

    let uploaded = 0;
    for (const d of toUpload) {
      const obj = await r2GetObject(d.r2_key!);
      if (!obj) continue;
      const name = d.file_name || `${d.file_type || "document"}.pdf`;
      const media = { mimeType: obj.contentType || "application/pdf", body: Readable.from(obj.body) };
      // OWNERSHIP MARKER — this is what lets the reconcile pass tell OUR copies
      // from files the founder placed in the folder himself (which stay untouched).
      const appProperties = { borivon_doc_id: d.id, borivon_user_id: userId, borivon_sha: mirrorFingerprint(d) ?? "" };
      let fileId = d.drive_mirror_id ?? null;
      // Trust the recorded id; else find a same-name file in Vor Matching to
      // update (no dupes); else create.
      if (!fileId) {
        const existing = await drive.files.list({
          q: `name='${esc(name)}' and '${vorId}' in parents and trashed=false`,
          fields: "files(id)", pageSize: 1,
          supportsAllDrives: true, includeItemsFromAllDrives: true,
        });
        fileId = existing.data.files?.[0]?.id ?? null;
      }
      if (fileId) {
        try { await drive.files.update({ fileId, media, requestBody: { appProperties }, supportsAllDrives: true }); }
        catch { fileId = (await drive.files.create({ requestBody: { name, parents: [vorId], appProperties }, media, fields: "id", supportsAllDrives: true })).data.id as string; }
      } else {
        fileId = (await drive.files.create({ requestBody: { name, parents: [vorId], appProperties }, media, fields: "id", supportsAllDrives: true })).data.id as string;
      }
      // Record what we mirrored. If THIS write is lost the sync never converges
      // (every later run re-uploads the same bytes), so a failure is logged loudly
      // rather than swallowed — it is the difference between a 5-second sync and
      // a 5-minute one.
      const { error: wbErr } = await db
        .from("documents")
        .update({ drive_mirror_id: fileId, drive_mirror_sha256: mirrorFingerprint(d) })
        .eq("id", d.id);
      if (wbErr) console.error("[driveMirror] mirror write-back failed for doc", d.id, "-", wbErr.message);
      uploaded++;
    }

    // RETRACT whatever the portal no longer treats as current. Runs on EVERY
    // sync — including when nothing was uploaded — so a rejected/replaced doc
    // stops being visible to the agency instead of lingering there forever.
    const archived = await reconcileVorMatching(db, drive, docs, vorId, candFolderId);

    return { ok: true, uploaded, unchanged, archived };
  } catch (e) {
    return { ok: false, error: "mirror_failed", hint: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Create WORK / "<Agency> X Borivon" / "<Batch>" once; returns the batch folder id.
 * The agency folder is nested inside the founder's existing WORK drive/folder —
 * that's where he actually looks for shared agency material.
 */
export async function ensureBatchFolder(drive: Drive, agencyRootName: string, batchName: string): Promise<string> {
  const workId = await resolveWorkRootId(drive);
  const rootId = await findOrCreateFolder(drive, agencyRootName, workId);
  return findOrCreateFolder(drive, batchName, rootId);
}

/** The DWD Drive client, or null if Workspace/Drive isn't connected. */
export function getDriveOrNull(): Drive | null {
  return driveClient() ?? null;
}
