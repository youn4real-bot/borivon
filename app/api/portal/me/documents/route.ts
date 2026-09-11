import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";

/**
 * GET /api/portal/me/documents → { docs: [...], hadSuperseded }
 *
 * The caller's OWN documents, newest first — what the dashboard used to read
 * straight from Supabase (Supabase → D1 step P0). Same three-step column
 * fallback the dashboard had, so an un-migrated column narrows the select
 * instead of blanking every box. `hadSuperseded` tells the client whether the
 * archived-row filter (LAW #33) can run.
 */
export const dynamic = "force-dynamic";

const FULL = "id, file_name, file_type, uploaded_at, status, feedback, drive_file_id, r2_key, superseded_at";
const NO_SUPERSEDED = "id, file_name, file_type, uploaded_at, status, feedback, drive_file_id, r2_key";
const LEGACY = "id, file_name, file_type, uploaded_at, status, feedback, drive_file_id";

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const db = getServiceSupabase();
  const q = (cols: string) => db
    .from("documents").select(cols).eq("user_id", auth.userId)
    .order("uploaded_at", { ascending: false });

  let res = await q(FULL);
  let hadSuperseded = true;
  if (res.error) { res = await q(NO_SUPERSEDED); hadSuperseded = false; }
  if (res.error) res = await q(LEGACY);
  if (res.error) return NextResponse.json({ error: "Internal error" }, { status: 500 });
  return NextResponse.json({ docs: res.data ?? [], hadSuperseded }, { headers: { "Cache-Control": "no-store" } });
}
