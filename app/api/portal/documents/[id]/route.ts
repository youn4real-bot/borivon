import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "";

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

function escapeDriveQ(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function getOrCreateFolder(drive: ReturnType<typeof google.drive>, name: string, parentId: string): Promise<string> {
  const safeName = escapeDriveQ(name);
  const safeParent = escapeDriveQ(parentId);
  const res = await drive.files.list({
    q: `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${safeParent}' in parents and trashed=false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (res.data.files?.[0]?.id) return res.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id!;
}

/**
 * DELETE /api/portal/documents/[id]
 *
 * Removes a document the candidate owns. Used by the candidate dashboard's
 * "Replace" / "Remove" action on multi-doc slots like "Sonstiges (Other)".
 *
 * LAW #33: Drive file is moved to archive/<candidate-folder>/archive/ — never deleted.
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

  // LAW #33: move to archive instead of permanently deleting
  if (d.drive_file_id && ROOT_FOLDER_ID) {
    try {
      const drive = getDriveClient();
      const { data: profile } = await db
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", auth.userId)
        .maybeSingle();
      const p = profile as { first_name?: string; last_name?: string } | null;
      const folderName = p?.first_name && p?.last_name
        ? `${p.first_name.trim()} ${p.last_name.trim()}`
        : auth.userId;
      const candidateFolderId = await getOrCreateFolder(drive, folderName, ROOT_FOLDER_ID);
      const archiveFolderId = await getOrCreateFolder(drive, "archive", candidateFolderId);
      await drive.files.update({
        fileId: d.drive_file_id,
        addParents: archiveFolderId,
        supportsAllDrives: true,
        fields: "id",
      });
    } catch (err) {
      console.warn("[documents DELETE] drive archive failed:", err);
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
