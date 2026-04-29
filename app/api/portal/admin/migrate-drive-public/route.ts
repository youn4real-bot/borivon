/**
 * One-shot migration: grant "anyone with link reader" permission on every
 * Drive file referenced by the documents table. Required so the candidate
 * & admin PDF preview modals can embed Drive's `/preview` viewer (which is
 * unauthenticated and requires the file to be link-shared).
 *
 * Idempotent — safe to run repeatedly. New uploads already get this
 * permission set automatically; this endpoint exists only to retrofit the
 * docs that were uploaded before that change.
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { getDriveClient, makeDrivePublic } from "@/lib/passport-pdf";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("documents")
    .select("drive_file_id")
    .not("drive_file_id", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = Array.from(new Set((data ?? []).map(r => r.drive_file_id).filter(Boolean) as string[]));
  const drive = getDriveClient();

  let done = 0;
  for (const id of ids) {
    await makeDrivePublic(drive, id);
    done++;
  }

  return NextResponse.json({ ok: true, total: ids.length, done });
}
