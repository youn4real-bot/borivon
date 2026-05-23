/**
 * One-time migration: COPY every existing Google Drive file into Cloudflare R2
 * and record its r2_key, so old files serve from R2 like new uploads do.
 *
 * SAFETY (the whole point):
 *   • NEVER deletes or modifies the Drive file — Drive stays a full backup.
 *   • COPY → VERIFY (HeadObject) → only THEN write r2_key. A file is never
 *     marked migrated unless its bytes are confirmed present in R2.
 *   • Idempotent — only touches rows that still have drive_file_id and no
 *     r2_key, so re-running just continues where it left off.
 *   • Per-file try/catch — one bad file is logged + skipped, never aborts.
 *   • Small batch + `remaining` count so the caller loops until done without
 *     hitting a function timeout.
 *
 * Supreme-admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { getDriveClient } from "@/lib/passport-pdf";
import { r2Configured, r2Put, r2Exists, candidateKey } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 10; // small enough to finish well under any function timeout

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!r2Configured()) return NextResponse.json({ error: "R2 not configured" }, { status: 503 });

  const db = getServiceSupabase();

  // Only files that have a Drive copy but no R2 copy yet.
  const { data: rows, error } = await db
    .from("documents")
    .select("id, user_id, drive_file_id, file_name, file_type")
    .not("drive_file_id", "is", null)
    .is("r2_key", null)
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const drive = getDriveClient();
  let copied = 0;
  const failed: { id: string; reason: string; name: string | null; type: string | null }[] = [];

  for (const row of rows ?? []) {
    const driveId = row.drive_file_id as string;
    const fail = (reason: string) =>
      failed.push({ id: row.id, reason, name: (row.file_name as string) ?? null, type: (row.file_type as string) ?? null });
    try {
      // 1) Read the bytes from Drive (read-only; the Drive file is untouched).
      const meta = await drive.files.get({ fileId: driveId, fields: "mimeType", supportsAllDrives: true });
      const res = await drive.files.get(
        { fileId: driveId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" },
      );
      const stream = res.data as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => resolve());
        stream.on("error", reject);
      });
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) { fail("Drive file is empty (0 bytes) — broken before migration"); continue; }

      // 2) Write into R2 under a stable, collision-proof key.
      const key = candidateKey(row.user_id as string, `${driveId}_${(row.file_name as string) ?? "document"}`);
      await r2Put(key, buf, meta.data.mimeType ?? "application/octet-stream");

      // 3) VERIFY it actually landed before recording anything.
      if (!(await r2Exists(key))) { fail("post-upload verify failed"); continue; }

      // 4) Only now point the row at R2. Drive copy stays as backup.
      const { error: updErr } = await db.from("documents").update({ r2_key: key }).eq("id", row.id);
      if (updErr) { fail(`DB update: ${updErr.message}`); continue; }

      copied++;
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  // How many still need copying after this batch?
  const { count: remaining } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .not("drive_file_id", "is", null)
    .is("r2_key", null);

  return NextResponse.json({
    processed: rows?.length ?? 0,
    copied,
    failed,
    remaining: remaining ?? 0,
    done: (remaining ?? 0) === 0,
  });
}
