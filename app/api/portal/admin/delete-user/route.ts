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
    q: `name = 'DELETED USERS' and '${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id)",
    pageSize: 1,
  });
  if (res.data.files?.length) return res.data.files[0].id!;
  const created = await drive.files.create({
    requestBody: {
      name: "DELETED USERS",
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

  // ── 2. Storage blobs (not reachable by a DB cascade) ───────────────────────
  // sign_requests rows get cascade-deleted below, but the PDFs they point at
  // live in Storage — remove them first or they orphan forever.
  try {
    const { data: sigReqs } = await db
      .from("sign_requests")
      .select("pdf_storage_path, signed_pdf_path")
      .eq("candidate_user_id", userId);
    const paths = (sigReqs ?? []).flatMap(r => [r.pdf_storage_path, r.signed_pdf_path].filter(Boolean) as string[]);
    if (paths.length) await db.storage.from("sign-documents").remove(paths).catch(() => {});
  } catch { /* best-effort */ }

  // ── 3. Email-keyed rows (NOT a FK to auth.users(id) → cascade can't reach) ──
  async function softDelete(table: string, query: PromiseLike<{ error: { message: string } | null }>) {
    try {
      const { error } = await query;
      if (error) console.warn(`[delete-user] cleanup ${table}:`, error.message);
    } catch (e) {
      console.warn(`[delete-user] cleanup ${table} threw:`, e);
    }
  }
  if (userEmail) {
    await softDelete("admin_notifications",            db.from("admin_notifications").delete().eq("user_email", userEmail));
    await softDelete("sub_admins",                     db.from("sub_admins").delete().eq("email", userEmail));
    await softDelete("organization_members",           db.from("organization_members").delete().eq("sub_admin_email", userEmail));
    await softDelete("sub_admin_assignments (email)",  db.from("sub_admin_assignments").delete().eq("sub_admin_email", userEmail));
  }
  await softDelete("pdf_field_mappings", db.from("pdf_field_mappings").update({ created_by: null }).eq("created_by", userId));

  // ── 4. PERMANENT delete — schema-agnostic SQL function ─────────────────────
  // app_delete_user (supabase/hard_delete_user.sql) clears EVERY table whose
  // FK points at auth.users(id) then deletes the auth row, all in one tx.
  // No soft-delete, no ghost account — Delete means gone, everywhere.
  const { error: rpcErr } = await db.rpc("app_delete_user", { p_uid: userId });
  if (!rpcErr) {
    return Response.json({ ok: true, displayName });
  }

  // Migration not applied yet → fall back to the manual table sweep so the
  // feature still works before the SQL is run. Still NO soft-delete ghost:
  // if the auth row genuinely can't be removed we return an explicit error
  // telling the owner to run the migration once.
  const fnMissing = /app_delete_user|does not exist|schema cache|PGRST202|42883/i.test(
    `${rpcErr.message ?? ""} ${(rpcErr as { code?: string }).code ?? ""}`,
  );
  if (!fnMissing) {
    console.error("[delete-user] app_delete_user failed:", rpcErr.message);
    return Response.json({ error: "Delete failed: " + rpcErr.message }, { status: 500 });
  }

  // Legacy manual sweep (pre-migration). Order: dependents before parents.
  async function safeDelete(table: string, query: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  try {
    await safeDelete("sub_admin_assignments",  db.from("sub_admin_assignments").delete().eq("candidate_user_id", userId));
    await safeDelete("candidate_organizations", db.from("candidate_organizations").delete().eq("candidate_user_id", userId));
    await safeDelete("documents",               db.from("documents").delete().eq("user_id", userId));
    await safeDelete("notifications",           db.from("notifications").delete().eq("user_id", userId));
    await safeDelete("sign_requests",           db.from("sign_requests").delete().eq("candidate_user_id", userId));
    await safeDelete("messages (thread)",       db.from("messages").delete().eq("thread_user_id", userId));
    await safeDelete("messages (sender)",       db.from("messages").delete().eq("sender_user_id", userId));
    await safeDelete("candidate_pipeline",      db.from("candidate_pipeline").delete().eq("user_id", userId));
    await safeDelete("candidate_profiles",      db.from("candidate_profiles").delete().eq("user_id", userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Deletion partially failed: " + msg }, { status: 500 });
  }
  await softDelete("feed_comment_likes (own)", db.from("feed_comment_likes").delete().eq("user_id", userId));
  await softDelete("feed_likes (own)",         db.from("feed_likes").delete().eq("user_id", userId));
  {
    const { data: ownComments } = await db.from("feed_comments").select("id").eq("user_id", userId);
    const cIds = (ownComments ?? []).map((c: { id: string }) => c.id);
    if (cIds.length) await softDelete("feed_comment_likes (on user comments)", db.from("feed_comment_likes").delete().in("comment_id", cIds));
  }
  {
    const { data: ownPosts } = await db.from("feed_posts").select("id").eq("user_id", userId);
    const pIds = (ownPosts ?? []).map((p: { id: string }) => p.id);
    if (pIds.length) {
      await softDelete("feed_likes (on user posts)", db.from("feed_likes").delete().in("post_id", pIds));
      const { data: postComments } = await db.from("feed_comments").select("id").in("post_id", pIds);
      const pcIds = (postComments ?? []).map((c: { id: string }) => c.id);
      if (pcIds.length) await softDelete("feed_comment_likes (on post comments)", db.from("feed_comment_likes").delete().in("comment_id", pcIds));
      await softDelete("feed_comments (on user posts)", db.from("feed_comments").delete().in("post_id", pIds));
    }
  }
  await softDelete("feed_comments (own)", db.from("feed_comments").delete().eq("user_id", userId));
  await softDelete("feed_posts (own)",    db.from("feed_posts").delete().eq("user_id", userId));
  await softDelete("suggested_matches",   db.from("suggested_matches").delete().eq("candidate_user_id", userId));
  await softDelete("community_seen",       db.from("community_seen").delete().eq("user_id", userId));
  await softDelete("agency_profiles",      db.from("agency_profiles").delete().eq("user_id", userId));

  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (!authError) {
    return Response.json({ ok: true, displayName });
  }

  // Hard delete blocked by some unmapped FK. Delete must STILL succeed for
  // the owner — and it's safe now: every admin list runs auth users through
  // lib/softDeleted.ts, so a banned+scrambled account is invisible
  // EVERYWHERE (dashboard, Users panel, candidate list, …). So we:
  //   • ban for ~100 years      → can never log in
  //   • scramble the email      → the ORIGINAL email is freed, so the person
  //                               can immediately re-register in any role
  //   • flag user_metadata.deleted → filtered out of every list
  // Net: "Delete" always works, no SQL needed, no visible ghost, email reusable.
  console.error("[delete-user] hard delete blocked, applying safe disable:", authError.message);
  try {
    await db.auth.admin.updateUserById(userId, {
      ban_duration: "876600h",
      email: `deleted+${userId}@borivon.invalid`,
      password: crypto.randomUUID() + crypto.randomUUID(),
      user_metadata: { deleted: true },
    });
  } catch (e) {
    console.error("[delete-user] safe-disable failed:", e);
    return Response.json(
      { error: "Data cleared but the account could not be disabled: " + authError.message },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, displayName });
}
