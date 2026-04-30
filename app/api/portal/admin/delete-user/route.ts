import { NextRequest } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";
import { google } from "googleapis";

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID ?? "";

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

async function getOrCreateDeletedDataFolder(
  drive: ReturnType<typeof getDriveClient>,
): Promise<string> {
  const res = await drive.files.list({
    q: `name = 'Deleted Data' and '${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
  });
  if (res.data.files?.length) return res.data.files[0].id!;
  const created = await drive.files.create({
    requestBody: {
      name: "Deleted Data",
      mimeType: "application/vnd.google-apps.folder",
      parents: [ROOT_FOLDER_ID],
    },
    fields: "id",
  });
  return created.data.id!;
}

// RFC-4122 UUID v4 pattern — Supabase auth IDs are always this format.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  // Sub-admins may NOT delete users — full admin only.
  if (auth.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId: string = body.userId;
  if (!userId) return Response.json({ error: "Missing userId" }, { status: 400 });
  // Reject anything that is not a well-formed UUID — prevents crafted strings
  // from reaching the auth table or any downstream Supabase delete call.
  if (!UUID_RE.test(userId)) return Response.json({ error: "Invalid userId" }, { status: 400 });

  const db = getServiceSupabase();

  // Get user info before any deletion (need email + display name)
  const { data: { user: targetUser } } = await db.auth.admin.getUserById(userId);
  const userEmail = (targetUser?.email ?? "").toLowerCase();

  const { data: profile } = await db
    .from("candidate_profiles")
    .select("first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  const displayName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    userEmail ||
    userId;

  // ── 1. Move all Drive files to "Deleted Data" ──────────────────────────────
  const { data: docs } = await db
    .from("documents")
    .select("drive_file_id")
    .eq("user_id", userId)
    .not("drive_file_id", "is", null);

  if (docs?.length && ROOT_FOLDER_ID) {
    try {
      const drive = getDriveClient();
      const deletedRootId = await getOrCreateDeletedDataFolder(drive);

      // Create per-user sub-folder: "FirstName LastName (abc12345)"
      const subFolderRes = await drive.files.create({
        requestBody: {
          name: `${displayName} (${userId.slice(0, 8)})`,
          mimeType: "application/vnd.google-apps.folder",
          parents: [deletedRootId],
        },
        fields: "id",
      });
      const userDeletedFolderId = subFolderRes.data.id!;

      for (const doc of docs) {
        if (!doc.drive_file_id) continue;
        try {
          const meta = await drive.files.get({
            fileId: doc.drive_file_id,
            fields: "parents",
          });
          const currentParents = (meta.data.parents ?? []).join(",");
          await drive.files.update({
            fileId: doc.drive_file_id,
            addParents: userDeletedFolderId,
            removeParents: currentParents,
            fields: "id",
          });
        } catch {
          // File already deleted or inaccessible — skip
        }
      }
    } catch (e) {
      console.error("[delete-user] Drive move error:", e);
    }
  }

  // ── 2. Delete all Supabase rows ────────────────────────────────────────────
  // Sequence matters — delete dependents before parents.
  // Each call checks for errors so a DB failure aborts early rather than
  // silently leaving orphaned rows or skipping the auth deletion.
  async function safeDelete(table: string, query: Promise<{ error: { message: string } | null }>) {
    const { error } = await query;
    if (error) {
      console.error(`[delete-user] Failed to delete from ${table}:`, error.message);
      throw new Error(`DB delete failed on ${table}: ${error.message}`);
    }
  }

  try {
    await safeDelete("sub_admin_assignments", db.from("sub_admin_assignments").delete().eq("candidate_user_id", userId));
    await safeDelete("candidate_organizations", db.from("candidate_organizations").delete().eq("candidate_user_id", userId));
    await safeDelete("documents",              db.from("documents").delete().eq("user_id", userId));
    await safeDelete("notifications",          db.from("notifications").delete().eq("user_id", userId));
    // Messages: delete whole thread AND any messages sent by this user in other threads
    await safeDelete("messages (thread)",      db.from("messages").delete().eq("thread_user_id", userId));
    await safeDelete("messages (sender)",      db.from("messages").delete().eq("sender_user_id", userId));
    await safeDelete("candidate_pipeline",     db.from("candidate_pipeline").delete().eq("user_id", userId));
    await safeDelete("candidate_profiles",     db.from("candidate_profiles").delete().eq("user_id", userId));
    await safeDelete("candidates",             db.from("candidates").delete().eq("id", userId));
    await safeDelete("users",                  db.from("users").delete().eq("id", userId));

    if (userEmail) {
      // admin_notifications keyed by candidate email
      await safeDelete("admin_notifications", db.from("admin_notifications").delete().eq("user_email", userEmail));
      // sub_admins table keyed by email (covers admin self-delete)
      await safeDelete("sub_admins",          db.from("sub_admins").delete().eq("email", userEmail));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Deletion partially failed: " + msg }, { status: 500 });
  }

  // ── 3. Delete from Supabase Auth (must be last) ────────────────────────────
  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError) {
    console.error("[delete-user] Auth delete error:", authError.message);
    return Response.json(
      { error: "Data cleared but auth deletion failed: " + authError.message },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, displayName });
}
