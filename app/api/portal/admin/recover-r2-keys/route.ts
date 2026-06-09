import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { r2Configured, r2List } from "@/lib/r2";

/**
 * SUPREME-ADMIN-ONLY one-click repair: re-attach the R2 object key to
 * `documents` rows that lost it. A bug in the upload route's schema-tolerant
 * retry (triggered because the file_sha256 column wasn't migrated) inserted
 * rows WITHOUT r2_key even though the bytes were already saved to R2 — so the
 * file served as a broken/empty PDF. This finds those orphaned rows (r2_key
 * null AND drive_file_id null), lists the bytes that are already in R2 under
 * the candidate's prefix, matches by filename + closest upload time, and
 * backfills r2_key. Idempotent. Also reports R2 reachability for diagnosis.
 *
 * POST → { r2Configured, scanned, recovered, lost: [...], sample }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Mirror of candidateKey()'s filename sanitiser in lib/r2.ts. */
const sani = (s: string) => (s || "document").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  if (!r2Configured()) {
    return NextResponse.json({ r2Configured: false, scanned: 0, recovered: 0, lost: [], note: "R2 not configured in this environment." });
  }

  const db = getServiceSupabase();
  const { data: rows, error } = await db
    .from("documents")
    .select("id, user_id, file_name, uploaded_at")
    .is("r2_key", null)
    .is("drive_file_id", null)
    .limit(2000);
  if (error) { console.error("[recover-r2-keys] query error:", error.message); return NextResponse.json({ error: "query_failed" }, { status: 500 }); }

  const orphaned = (rows ?? []) as { id: string; user_id: string; file_name: string; uploaded_at: string }[];

  // Cache R2 listing per user (one ListObjects sweep per candidate).
  const listCache = new Map<string, { key: string; size: number }[]>();
  const listUser = async (uid: string) => {
    if (!listCache.has(uid)) listCache.set(uid, await r2List(`candidates/${uid}/`));
    return listCache.get(uid)!;
  };

  let recovered = 0;
  const lost: string[] = [];
  let sample = "";

  for (const r of orphaned) {
    let objs: { key: string; size: number }[];
    try { objs = await listUser(r.user_id); }
    catch (e) { console.error("[recover-r2-keys] R2 list failed:", e instanceof Error ? e.message : e); return NextResponse.json({ error: "r2_list_failed" }, { status: 502 }); }

    const want = sani(r.file_name);
    const matches = objs.filter((o) => o.key.endsWith(want) && o.size > 0);
    if (matches.length === 0) { lost.push(r.file_name); continue; }

    // Closest object by the timestamp embedded in the key (candidates/<u>/<ts>_<name>).
    const rowMs = Date.parse(r.uploaded_at) || 0;
    const ts = (k: string) => Number(k.split("/").pop()?.split("_")[0] ?? 0) || 0;
    matches.sort((a, b) => Math.abs(ts(a.key) - rowMs) - Math.abs(ts(b.key) - rowMs));
    const key = matches[0].key;

    const { error: upErr } = await db.from("documents").update({ r2_key: key }).eq("id", r.id);
    if (upErr) { console.error("[recover-r2-keys] update failed:", upErr.message); continue; }
    recovered++;
    if (!sample) sample = `${r.file_name} → ${key}`;
  }

  return NextResponse.json({ r2Configured: true, scanned: orphaned.length, recovered, lost, sample });
}
