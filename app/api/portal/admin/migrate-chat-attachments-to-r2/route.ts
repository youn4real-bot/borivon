/**
 * One-time migration: move existing chat attachments out of the Postgres
 * `messages.attachment` (inline base64 data-URL) column into Cloudflare R2, so
 * those bytes stop counting as Supabase egress and the rows shrink.
 *
 * SAFETY:
 *   • UPLOAD → VERIFY (HeadObject) → only THEN write attachment_key + null the
 *     base64. A row is never stripped of its image unless the bytes are
 *     confirmed in R2.
 *   • Idempotent — only touches rows that still have `attachment` and no
 *     `attachment_key`, so re-running continues where it left off.
 *   • Per-row try/catch — one bad row is logged + skipped, never aborts.
 *   • Small batch + `remaining` so the caller loops until done without timing out.
 *     (Rows whose base64 fails validation can't be migrated and stay counted in
 *     `remaining` + listed in `failed`; stop looping when `migrated` is 0.)
 *
 * Supreme-admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { validateImageDataUrl } from "@/lib/validateDataUrl";
import { r2Configured, r2Put, r2Exists } from "@/lib/r2";
import { chatAttachmentKey } from "@/lib/chatAttachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 25;

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!r2Configured()) return NextResponse.json({ error: "R2 not configured" }, { status: 503 });

  const db = getServiceSupabase();

  // Only rows that still hold inline base64, no R2 key yet, and haven't already
  // been ATTEMPTED (attachment_mime is set as a sentinel on un-migratable rows
  // so they don't re-match every batch and `done` can actually become true).
  const { data: rows, error } = await db
    .from("messages")
    .select("id, thread_user_id, attachment")
    .not("attachment", "is", null)
    .is("attachment_key", null)
    .is("attachment_mime", null)
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let migrated = 0;
  const failed: { id: string; reason: string }[] = [];

  for (const row of rows ?? []) {
    const id = row.id as string;
    const fail = (reason: string) => failed.push({ id, reason });
    try {
      const att = (row.attachment as string | null) ?? "";
      const v = validateImageDataUrl(att);
      if (!v.ok) {
        // Can't migrate (legacy SVG / malformed base64). Mark it ATTEMPTED via a
        // sentinel mime so it stops re-matching the batch (otherwise `done` never
        // becomes true). The base64 stays intact — no data loss, still serves.
        await db.from("messages").update({ attachment_mime: "unmigratable" }).eq("id", id);
        fail(`invalid data url: ${v.reason}`);
        continue;
      }

      const key = chatAttachmentKey(row.thread_user_id as string, id, v.mime);
      await r2Put(key, v.bytes, v.mime);
      if (!(await r2Exists(key))) { fail("post-upload verify failed"); continue; }

      // Only now point the row at R2 AND free the base64 bytes from Postgres.
      const { error: updErr } = await db
        .from("messages")
        .update({ attachment_key: key, attachment_mime: v.mime, attachment: null })
        .eq("id", id);
      if (updErr) { fail(`DB update: ${updErr.message}`); continue; }

      migrated++;
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  const { count: remaining } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .not("attachment", "is", null)
    .is("attachment_key", null)
    .is("attachment_mime", null); // exclude already-attempted (sentinel) rows

  return NextResponse.json({
    processed: rows?.length ?? 0,
    migrated,
    failed,
    remaining: remaining ?? 0,
    done: (remaining ?? 0) === 0,
  });
}
