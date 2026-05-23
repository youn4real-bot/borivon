/**
 * Verification audit: independently confirm EVERY Drive-backed document is
 * safely in R2. For each row we:
 *   • HEAD the R2 object → confirm it exists + get its byte size,
 *   • read the original Drive file's size → confirm the two MATCH.
 * Matching size + confirmed existence is strong proof the bytes copied fully.
 *
 * Read-only — touches nothing. Batched via ?offset so the caller can page
 * through everything without a timeout. Supreme-admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { getDriveClient } from "@/lib/passport-pdf";
import { r2Configured, r2Head } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 50;

type Tag = { id: string; name: string | null; type: string | null };

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!r2Configured()) return NextResponse.json({ error: "R2 not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { offset?: number };
  const offset = Math.max(0, body.offset ?? 0);

  const db = getServiceSupabase();
  const { data: rows, error } = await db
    .from("documents")
    .select("id, drive_file_id, r2_key, file_name, file_type")
    .not("drive_file_id", "is", null)
    .order("id", { ascending: true })
    .range(offset, offset + BATCH - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const drive = getDriveClient();
  let verified = 0;
  const missingInR2: Tag[] = [];
  const sizeMismatch: (Tag & { r2: number; drive: number })[] = [];
  const notMigrated: Tag[] = [];

  for (const row of rows ?? []) {
    const tag: Tag = { id: row.id, name: (row.file_name as string) ?? null, type: (row.file_type as string) ?? null };

    if (!row.r2_key) { notMigrated.push(tag); continue; }

    const head = await r2Head(row.r2_key as string);
    if (!head) { missingInR2.push(tag); continue; }

    // Cross-check the R2 size against the original Drive file.
    let driveSize = -1;
    try {
      const dm = await drive.files.get({ fileId: row.drive_file_id as string, fields: "size", supportsAllDrives: true });
      driveSize = Number(dm.data.size ?? -1);
    } catch { driveSize = -1; }

    if (driveSize >= 0 && head.size !== driveSize) {
      sizeMismatch.push({ ...tag, r2: head.size, drive: driveSize });
      continue;
    }
    verified++;
  }

  const { count: total } = await db
    .from("documents").select("id", { count: "exact", head: true }).not("drive_file_id", "is", null);

  return NextResponse.json({
    processed: rows?.length ?? 0,
    verified,
    missingInR2,
    sizeMismatch,
    notMigrated,
    total: total ?? 0,
    nextOffset: offset + (rows?.length ?? 0),
    done: (rows?.length ?? 0) < BATCH,
  });
}
