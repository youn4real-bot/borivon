import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

/**
 * DELETE /api/portal/documents/[id]
 *
 * Removes a document the candidate owns. Used by the candidate dashboard's
 * "Replace" / "Remove" action on multi-doc slots like "Sonstiges (Other)".
 *
 * Auth: Bearer JWT — the JWT user must own the doc.
 *
 * Side effects:
 *   - Deletes the documents row.
 *   - Best-effort attempt to remove the file from Google Drive (failure here
 *     does not block the DB delete; orphaned Drive files can be cleaned up
 *     server-side later).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const db = getServiceSupabase();
  const { data: doc } = await db
    .from("documents")
    .select("id, user_id, drive_file_id")
    .eq("id", id)
    .maybeSingle();

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  type DocRow = { id: string; user_id: string; drive_file_id: string | null };
  const d = doc as DocRow;
  if (d.user_id !== auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Best-effort remove from Drive (don't block if it fails)
  if (d.drive_file_id) {
    try {
      const drive = getDriveClient();
      await drive.files.delete({ fileId: d.drive_file_id, supportsAllDrives: true });
    } catch (err) {
      console.warn("[documents DELETE] drive remove failed:", err);
    }
  }

  const { error } = await db.from("documents").delete().eq("id", id);
  if (error) {
    console.error("[documents DELETE] db delete failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/portal/documents/[id]
 *
 * Currently supports updating `rotation` (0/90/180/270). Auth: owner OR
 * admin/sub-admin (who can act on the doc owner).
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: { deltaRotation?: number } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const delta = body.deltaRotation;
  if (typeof delta !== "number" || delta % 90 !== 0) {
    return NextResponse.json({ error: "Invalid deltaRotation" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: doc } = await db
    .from("documents")
    .select("id, user_id, rotation")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const docRow = doc as { user_id: string; rotation: number | null };
  const ownerId = docRow.user_id;

  // Auth: try admin first, fall back to candidate ownership.
  let authorised = false;
  const adminAuth = await requireAdminRole(req);
  if (adminAuth.ok) {
    authorised = adminAuth.role === "admin"
      || (await canActOnCandidate(adminAuth.role, adminAuth.email, ownerId));
  } else {
    const userAuth = await requireUser(req);
    authorised = userAuth.ok && userAuth.userId === ownerId;
  }
  if (!authorised) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const next = (((docRow.rotation ?? 0) + delta) % 360 + 360) % 360;
  const { error } = await db.from("documents").update({ rotation: next }).eq("id", id);
  if (error) {
    console.error("[documents PATCH] update failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ success: true, rotation: next });
}
