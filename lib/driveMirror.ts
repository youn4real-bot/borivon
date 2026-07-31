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
import { isPreMatchDoc, resolveFileKey } from "@/lib/fileKeys";
import { getServiceSupabase } from "@/lib/supabase";
import { UUID_RE } from "@/lib/uuid";
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
/**
 * Where retracted copies go. NOT inside the candidate folder any more.
 *
 * Retraction previously moved a stale file to "<Batch>/<Candidate>/Archiv" —
 * still INSIDE the folder tree shared with the agency. So a document the portal
 * had explicitly pulled back (rejected, replaced, superseded, or belonging to a
 * candidate who moved away) stayed readable to that agency through inherited
 * sharing, and through any link they already held. "Retracted" has to mean
 * retracted, so Archiv now lives at the WORK root, one level ABOVE every
 * "<Agency> X Borivon" folder — outside whatever is shared, however it is
 * shared. Files are still only MOVED, never deleted or trashed (LAW #33).
 */
const ARCHIV_ROOT = "_Archiv (Borivon intern)";

/** WORK / _Archiv (Borivon intern) / <Candidate> — created only when needed. */
async function resolveArchivFolder(drive: Drive, candidateName: string): Promise<string> {
  const workId = await resolveWorkRootId(drive);
  const rootId = await findOrCreateFolder(drive, ARCHIV_ROOT, workId);
  return findOrCreateFolder(drive, candidateName || "Unbekannt", rootId);
}

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
  //
  // ON WORKERS THIS CANNOT RUN. The fetch-based Drive shim used on workerd
  // (lib/googleDriveShim.ts) implements no `drives` namespace at all, so this
  // throws immediately and the old bare `catch {}` made that indistinguishable
  // from "checked, found nothing".
  //
  // It matters because step 2 below searches for a FOLDER. A Shared DRIVE named
  // WORK is not a folder and will not match it, so on Workers we would fall all
  // the way through and CREATE a new WORK folder in My Drive — quietly mirroring
  // candidate documents somewhere other than the shared drive the team actually
  // uses, with nobody told.
  //
  // Detect the missing namespace explicitly and say so once, rather than
  // pretending the check happened. Behaviour is otherwise unchanged: it still
  // falls through, because inventing a shared-drive lookup on the shim here is a
  // bigger change than this bug warrants.
  if (typeof (drive as { drives?: { list?: unknown } }).drives?.list !== "function") {
    console.warn(
      "[driveMirror] shared-drive lookup unavailable on this runtime (Drive shim has no drives.list) — " +
      "if the WORK root is a Shared Drive rather than a folder, it will not be found",
    );
  } else {
    try {
      const sd = await drive.drives.list({ q: `name='${esc(WORK_ROOT)}'`, pageSize: 10, fields: "drives(id,name)" });
      const hit = (sd.data.drives ?? []).find((d) => (d.name ?? "").trim().toUpperCase() === WORK_ROOT);
      if (hit?.id) return hit.id;
    } catch (e) {
      // A real API error (no shared-drive access, none exist) — distinct from the
      // runtime simply not supporting the call.
      console.warn("[driveMirror] drives.list failed:", e instanceof Error ? e.message : e);
    }
  }
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
  drive_mirror_batch_id: string | null; // which batch folder the copy lives in (feature #3)
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

/**
 * Clamp appProperties to Drive's hard limit: 124 bytes UTF-8 per entry, counting
 * the KEY AND THE VALUE together. Over that, Google rejects the whole upload with
 * a 403 and the document silently never mirrors.
 *
 * This bites on `borivon_sha`: mirrorFingerprint falls back to `r2key:<path>` for
 * any document without a file_sha256, and an R2 key is a long path — key + value
 * sails past 124. A sha256 (75 bytes with its key) fits comfortably, which is why
 * only some documents failed.
 *
 * Truncating is safe because `borivon_sha` is written for humans only — nothing
 * reads it back. The value that MATTERS for change detection is the full
 * fingerprint in documents.drive_mirror_sha256, which has no length limit, and
 * the marker we actually match on is `borivon_doc_id` (a uuid, always fits).
 * Entries whose key alone exceeds the limit are dropped rather than sent.
 */
export function safeAppProperties(props: Record<string, string>): Record<string, string> {
  const LIMIT = 124;
  const enc = new TextEncoder();
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(props)) {
    const keyBytes = enc.encode(k).length;
    if (keyBytes >= LIMIT) continue; // no room for any value — omit entirely
    const budget = LIMIT - keyBytes;
    let v = raw ?? "";
    if (enc.encode(v).length > budget) {
      // Trim by BYTES, then drop any trailing partial UTF-8 sequence so the
      // value stays valid text (an R2 key can contain non-ASCII).
      const bytes = enc.encode(v).slice(0, budget);
      v = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/�+$/, "");
    }
    out[k] = v;
  }
  return out;
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
  | { ok: true; uploaded: number; unchanged: number; archived: number; missing: number }
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
/**
 * Does this doc's recorded Drive copy live in a DIFFERENT batch's folder than the
 * candidate's current one? PURE — the batch-move safety rule, testable in isolation:
 *
 *   true ONLY if we HAVE a copy (drive_mirror_id) AND we KNOW which batch it's in
 *   (drive_mirror_batch_id is set) AND that batch differs from the current one.
 *
 * A NULL drive_mirror_batch_id means "legacy / unknown" and is treated as
 * "current" → the copy is NEVER wrongly retracted before the code has stamped it.
 * When true, the old copy is moved to Archiv and the doc re-uploads to the new folder.
 */
export function isMirrorInWrongBatch(
  d: Pick<ApprovedDoc, "drive_mirror_id" | "drive_mirror_batch_id">,
  currentBatchId: string | null,
): boolean {
  return !!d.drive_mirror_id && d.drive_mirror_batch_id != null && d.drive_mirror_batch_id !== currentBatchId;
}

export function selectStaleMirrorFiles(files: MirrorFile[], currentDocIds: Iterable<string>): MirrorFile[] {
  const live = new Set(currentDocIds);
  return files.filter((f) => {
    const docId = f.appProperties?.borivon_doc_id;
    return !!f.id && !!docId && !live.has(docId); // unmarked = founder's own → skip
  });
}

async function reconcileFolder(
  db: SupabaseClient,
  drive: Drive,
  currentDocs: ApprovedDoc[],
  folderId: string,
  candidateName: string,
): Promise<number> {
  // Page through — a silent 200-file cap would leave stale copies visible.
  const found: MirrorFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,appProperties)", pageSize: 200, pageToken,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    found.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  const stale = selectStaleMirrorFiles(found, currentDocs.map((d) => d.id));
  if (stale.length === 0) return 0;
  // Lazily — and OUTSIDE the agency-shared tree (see ARCHIV_ROOT).
  const archivId = await resolveArchivFolder(drive, candidateName);
  let moved = 0;
  for (const f of stale) {
    try {
      await drive.files.update({ fileId: f.id!, addParents: archivId, removeParents: folderId, supportsAllDrives: true });
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
 * Move ONE mirrored file into an "Archiv" folder beside it — used to retract a
 * copy stranded in a PREVIOUS batch's folder after a candidate moved batches.
 * The file's parent is a Vor/Nach folder; its GRANDPARENT is that batch's
 * candidate folder — we read its NAME so the file lands under the same person in
 * the shared root archive (outside every agency folder). Never throws (a
 * deleted/foreign file just returns false). LAW #33: MOVE, never delete/trash.
 */
async function archiveMirroredFileById(drive: Drive, fileId: string): Promise<boolean> {
  try {
    const f = await drive.files.get({ fileId, fields: "parents", supportsAllDrives: true });
    const parent = f.data.parents?.[0];
    if (!parent) return false;
    const pf = await drive.files.get({ fileId: parent, fields: "parents,name", supportsAllDrives: true });
    const candFolder = pf.data.parents?.[0];
    if (!candFolder) return false;
    const cf = await drive.files.get({ fileId: candFolder, fields: "name", supportsAllDrives: true });
    const archivId = await resolveArchivFolder(drive, cf.data.name || "Unbekannt");
    await drive.files.update({ fileId, addParents: archivId, removeParents: parent, supportsAllDrives: true });
    return true;
  } catch { return false; }
}

/**
 * Retract every doc whose recorded copy lives in a DIFFERENT batch's folder (the
 * candidate moved batches) OR whose candidate has no batch at all (offboarded).
 * Each copy is moved to its OLD folder's Archiv and its mirror pointers nulled,
 * so it re-uploads fresh to the current batch folder (or simply stops being
 * visible to the old agency). Returns how many were retracted. Never throws.
 */
async function retractMovedDocs(db: SupabaseClient, drive: Drive, movedDocs: ApprovedDoc[]): Promise<number> {
  let moved = 0;
  for (const d of movedDocs) {
    if (!d.drive_mirror_id) continue;
    const ok = await archiveMirroredFileById(drive, d.drive_mirror_id);
    // Null the pointers regardless: even if the file was already gone, the row
    // must stop claiming a stale mirror so the current-batch upload runs.
    let wb = await db.from("documents")
      .update({ drive_mirror_id: null, drive_mirror_sha256: null, drive_mirror_batch_id: null })
      .eq("id", d.id);
    if (wb.error && /drive_mirror_batch_id|column .* does not exist|schema cache/i.test(wb.error.message ?? "")) {
      wb = await db.from("documents")
        .update({ drive_mirror_id: null, drive_mirror_sha256: null })
        .eq("id", d.id);
    }
    if (ok) moved++;
  }
  return moved;
}

/**
 * Post-match doc types kept OUT of the agency's "Nach Matching" folder. Empty by
 * default → the whole visa-phase dossier is mirrored (that folder was designed
 * for exactly these docs). Add a fileKey here (e.g. "defizitbescheid") to hide
 * that one doc type from the partner while still mirroring everything else.
 */
const NACH_MATCHING_EXCLUDE_KEYS = new Set<string>([]);

/** A post-match doc that SHOULD reach the agency's Nach Matching folder. */
export function isNachMatchingDoc(fileType: string | null | undefined): boolean {
  if (isPreMatchDoc(fileType)) return false;            // pre-match → Vor Matching
  return !NACH_MATCHING_EXCLUDE_KEYS.has(resolveFileKey((fileType ?? "").trim()));
}

/**
 * Upload a set of docs into ONE folder (Vor or Nach Matching), returning the
 * count uploaded + the count whose R2 bytes were unreadable (surfaced, never
 * silent). Idempotent: an unchanged doc is skipped by the caller before it gets
 * here; this reuses a recorded drive_mirror_id (update-in-place) or finds a
 * same-name file (no dupes) or creates. Stamps the ownership marker so the
 * reconcile pass can tell our copies from the founder's own files. Never throws
 * per-file — one stuck upload must not abort the candidate.
 */
async function uploadDocsToFolder(
  db: SupabaseClient,
  drive: Drive,
  docs: ApprovedDoc[],
  folderId: string,
  userId: string,
  batchId: string | null,
): Promise<{ uploaded: number; missing: number }> {
  let uploaded = 0;
  let missing = 0;
  for (const d of docs) {
    const obj = await r2GetObject(d.r2_key!);
    if (!obj) {
      // Approved + current but its stored file is unreadable → the agency would
      // silently be missing it. Count + log so the sync reports it truthfully.
      missing++;
      console.error("[driveMirror] approved doc has unreadable R2 bytes — not copied:", d.id, d.file_name, d.r2_key);
      continue;
    }
    const name = d.file_name || `${d.file_type || "document"}.pdf`;
    const media = { mimeType: obj.contentType || "application/pdf", body: Readable.from(obj.body) };
    // Clamped: Drive rejects the WHOLE upload with a 403 if any single entry
    // exceeds 124 bytes of key+value, and the r2key fallback fingerprint does.
    const appProperties = safeAppProperties({
      borivon_doc_id: d.id, borivon_user_id: userId, borivon_sha: mirrorFingerprint(d) ?? "",
    });
    let fileId = d.drive_mirror_id ?? null;
    if (!fileId) {
      const existing = await drive.files.list({
        q: `name='${esc(name)}' and '${folderId}' in parents and trashed=false`,
        fields: "files(id)", pageSize: 1,
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      fileId = existing.data.files?.[0]?.id ?? null;
    }
    if (fileId) {
      try { await drive.files.update({ fileId, media, requestBody: { appProperties }, supportsAllDrives: true }); }
      catch { fileId = (await drive.files.create({ requestBody: { name, parents: [folderId], appProperties }, media, fields: "id", supportsAllDrives: true })).data.id as string; }
    } else {
      fileId = (await drive.files.create({ requestBody: { name, parents: [folderId], appProperties }, media, fields: "id", supportsAllDrives: true })).data.id as string;
    }
    // Record what we mirrored — including WHICH batch folder it now lives in, so
    // a later batch move can find + retract this exact copy. If this write is
    // lost the sync never converges (every run re-uploads the same bytes), so log
    // loudly. Schema-tolerant: on a deployment without drive_mirror_batch_id, drop
    // just that column and keep the sha/id write (the mirror still converges;
    // batch tracking stays inactive until the migration is run).
    const fp = mirrorFingerprint(d);
    let wb = await db.from("documents")
      .update({ drive_mirror_id: fileId, drive_mirror_sha256: fp, drive_mirror_batch_id: batchId })
      .eq("id", d.id);
    if (wb.error && /drive_mirror_batch_id|column .* does not exist|schema cache/i.test(wb.error.message ?? "")) {
      wb = await db.from("documents")
        .update({ drive_mirror_id: fileId, drive_mirror_sha256: fp })
        .eq("id", d.id);
    }
    if (wb.error) console.error("[driveMirror] mirror write-back failed for doc", d.id, "-", wb.error.message);
    uploaded++;
  }
  return { uploaded, missing };
}

/**
 * Mirror ONE candidate's approved docs into <batchFolderId>/<Candidate name>/.
 * The dossier is split by phase: the PRE-match dossier (Essentials + Unterlagen)
 * goes to "Vor Matching"; the POST-match / Visum-phase docs (contract, EzB,
 * Zusatzblatt, Vorabzustimmung, visa, insurance, …) go to "Nach Matching".
 * Idempotent + cheap: a doc whose fingerprint already matches its recorded
 * drive_mirror_sha256 is skipped with ZERO Drive calls (folders are only created
 * when there's actually something to write). Never throws.
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
  currentBatchId: string | null,
): Promise<CandidateMirrorResult> {
  try {
    // Approved docs with R2 bytes, newest-per-filename. Schema-tolerant on the
    // feature-#3 column: until supabase/drive_mirror_batch.sql is run, select
    // WITHOUT it and treat every doc's batch as unknown (= current) so nothing is
    // wrongly retracted — the mirror behaves exactly as it did before.
    const BASE_COLS = "id,file_name,file_type,r2_key,file_sha256,drive_mirror_id,drive_mirror_sha256,uploaded_at";
    const q = (cols: string) => db
      .from("documents").select(cols)
      .eq("user_id", userId).eq("status", "approved")
      .is("superseded_at", null).not("r2_key", "is", null);
    let res = await q(`${BASE_COLS},drive_mirror_batch_id`);
    if (res.error && /drive_mirror_batch_id|column .* does not exist|schema cache/i.test(res.error.message ?? "")) {
      res = await q(BASE_COLS);
    }
    const allDocs = latestApprovedPerName((res.data ?? []).map((r) => ({
      drive_mirror_batch_id: null, ...(r as object),
    })) as ApprovedDoc[]);
    // Split the dossier by phase: PRE-match → "Vor Matching", POST-match →
    // "Nach Matching". Dedup by filename per phase.
    const preDocs  = allDocs.filter((d) => isPreMatchDoc(d.file_type));
    const postDocs = allDocs.filter((d) => isNachMatchingDoc(d.file_type));
    // Decide what's new BEFORE touching Drive → nothing new = zero Drive calls.
    const isMirrored = (d: ApprovedDoc) => {
      if (isMirrorInWrongBatch(d, currentBatchId)) return false; // recorded elsewhere → re-upload here
      const fp = mirrorFingerprint(d);
      return !!(d.drive_mirror_id && fp && d.drive_mirror_sha256 === fp);
    };
    // Retract copies stranded in a PREVIOUS batch's folder (move to that folder's
    // Archiv, null the pointers) before anything else, so the re-upload below
    // lands them fresh in the CURRENT batch folder.
    const movedAway = allDocs.filter((d) => isMirrorInWrongBatch(d, currentBatchId));
    let archived = await retractMovedDocs(db, drive, movedAway);
    const preToUpload  = preDocs.filter((d) => !isMirrored(d));
    const postToUpload = postDocs.filter((d) => !isMirrored(d));
    const unchanged = (preDocs.length - preToUpload.length) + (postDocs.length - postToUpload.length);
    const anyToUpload = preToUpload.length + postToUpload.length;
    // NOTE: deliberately NO early return when nothing is new — that is exactly
    // the RETRACTION case (a doc was rejected/archived: nothing to send, but a
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

    // <Candidate> / { Vor Matching (pre-match) , Nach Matching (post-match) }.
    // Look the folder up WITHOUT creating it: a candidate with nothing to upload
    // and no folder yet has nothing stale either → return without a single write.
    let candFolderId = await findFolder(drive, candidateName, batchFolderId);
    if (!candFolderId && anyToUpload === 0) return { ok: true, uploaded: 0, unchanged, archived, missing: 0 };
    if (!candFolderId) candFolderId = await findOrCreateFolder(drive, candidateName, batchFolderId);

    let uploaded = 0;
    let missing = 0;  // approved docs whose R2 bytes couldn't be fetched — never silent

    // ── Vor Matching (pre-match dossier) — the primary folder; ALWAYS reconcile.
    // Reconcile must run even when preDocs is empty: "every pre-match doc was
    // rejected" is exactly when the stale copies need pulling into Archiv. We
    // reach here only when the candidate folder exists, so Vor already does too
    // (or is a cheap create).
    const vorId = await findOrCreateFolder(drive, VOR_MATCHING, candFolderId);
    {
      const r = await uploadDocsToFolder(db, drive, preToUpload, vorId, userId, currentBatchId);
      uploaded += r.uploaded; missing += r.missing;
    }
    archived += await reconcileFolder(db, drive, preDocs, vorId, candidateName);

    // ── Nach Matching (post-match / Visum-phase docs) ─────────────────────────
    // Create it when there are post docs to place; otherwise only reconcile it
    // if it already exists (so retraction works when every post doc was removed,
    // without minting an empty folder for pre-match-only candidates).
    const nachId = postToUpload.length
      ? await findOrCreateFolder(drive, NACH_MATCHING, candFolderId)
      : await findFolder(drive, NACH_MATCHING, candFolderId);
    if (nachId) {
      const r = await uploadDocsToFolder(db, drive, postToUpload, nachId, userId, currentBatchId);
      uploaded += r.uploaded; missing += r.missing;
      archived += await reconcileFolder(db, drive, postDocs, nachId, candidateName);
    }

    return { ok: true, uploaded, unchanged, archived, missing };
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

/**
 * Auto-mirror ONE candidate's dossier — the engine behind scheduleCandidateMirror.
 *
 * Runs whenever that candidate's pre-match dossier changes (a doc approved,
 * rejected, replaced, re-generated) so the agency's Drive folder tracks the portal
 * WITHOUT anyone clicking "Sync this batch → Drive". Because mirrorCandidateApprovedDocs
 * is idempotent + sha-skips unchanged docs, one call handles BOTH directions: it
 * uploads new/changed bytes AND its reconcile pass retracts anything no longer live
 * into Archiv (LAW #33 — never delete/trash). Cost scales with docs CHANGED, not
 * docs approved, so back-to-back approvals coalesce naturally.
 *
 * NEVER THROWS — it runs off the request's critical path (via after()), so a Drive
 * outage or a candidate not in any batch is a silent no-op, never a failed approval.
 * Returns nothing: the caller is fire-and-forget.
 */
export async function autoMirrorCandidate(userId: string): Promise<void> {
  try {
    if (!UUID_RE.test(userId)) return;
    const db = getServiceSupabase();
    const { data: pipe } = await db
      .from("candidate_pipeline").select("batch_id").eq("user_id", userId).maybeSingle();
    const batchId = (pipe as { batch_id?: string | null } | null)?.batch_id ?? null;
    const drive = getDriveOrNull();
    if (!drive) return; // Workspace/Drive not connected — the manual sync will catch up later

    if (!batchId) {
      // Candidate is in NO batch (never placed, or removed/offboarded). There is
      // no current folder to write to, but any copies they had in a previous
      // batch must stop being visible to that agency → retract them all to Archiv.
      await retractAllCandidateMirrors(db, drive, userId);
      return;
    }
    const targets = await resolveBatchSyncTargets(db, batchId);
    if (!targets) return;
    const batchFolderId = await ensureBatchFolder(drive, targets.agencyRootName, targets.batchName);
    await mirrorCandidateApprovedDocs(db, drive, userId, batchFolderId, batchId);
  } catch (e) {
    console.error("[autoMirrorCandidate] non-fatal:", e instanceof Error ? e.message : e);
  }
}

/** Retract EVERY mirrored copy a candidate has (used when they're in no batch). */
async function retractAllCandidateMirrors(db: SupabaseClient, drive: Drive, userId: string): Promise<number> {
  const { data } = await db
    .from("documents").select("id,drive_mirror_id")
    .eq("user_id", userId).not("drive_mirror_id", "is", null);
  const mirrored = (data ?? [])
    .filter((r) => (r as { drive_mirror_id?: string | null }).drive_mirror_id)
    .map((r) => ({ id: (r as { id: string }).id, drive_mirror_id: (r as { drive_mirror_id: string }).drive_mirror_id } as ApprovedDoc));
  return retractMovedDocs(db, drive, mirrored);
}
