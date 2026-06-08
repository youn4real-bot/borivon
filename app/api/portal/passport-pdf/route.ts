import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate, roleByUserId } from "@/lib/admin-auth";
import { dlTokenUserId } from "@/lib/dlToken";
import { UUID_RE } from "@/lib/uuid";
import {
  generatePassportPdf,
  getDriveClient,
  getOrCreateFolder,
  buildPdfFilename,
  ROOT_FOLDER_ID,
  makeDrivePublic,
} from "@/lib/passport-pdf";
import { PassThrough } from "stream";
import { r2Configured, r2Put, candidateKey } from "@/lib/r2";


// ── GET — download passport PDF ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // iOS downloads navigate to this URL directly (no Authorization header is
  // possible on a top-level navigation). Header path → normal requireAdminRole.
  // No header → resolve role from the short-lived signed download token
  // (?dlt=). The raw JWT is never accepted from the URL anymore.
  const auth = req.headers.get("authorization")
    ? await requireAdminRole(req)
    : await roleByUserId(dlTokenUserId(req) ?? "");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId || !UUID_RE.test(userId)) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // Sub-admins must be assigned to this candidate
  if (!(await canActOnCandidate(auth.role, auth.email, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data: profile, error } = await db
    .from("candidate_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const buf      = await generatePassportPdf(profile);
  const filename = buildPdfFilename(profile);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  // iOS Safari force-previews application/pdf even with attachment; serve as
  // octet-stream on explicit ?dl=1 so it actually downloads to Files.
  const dl = req.nextUrl.searchParams.get("dl") === "1";
  return new Response(arrayBuffer, {
    headers: {
      "Content-Type":        dl ? "application/octet-stream" : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/[\r\n"]/g, "")}"`,
      "Cache-Control":       "private, no-store",
    },
  });
}

// ── POST — generate PDF and save to Google Drive ──────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { userId?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const userId = body.userId;
  if (!userId || !UUID_RE.test(userId)) return NextResponse.json({ error: "userId required" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data: profile, error } = await db
    .from("candidate_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const buffer   = await generatePassportPdf(profile);
  const filename = buildPdfFilename(profile);

  // ── Cloudflare R2 — primary store of record. ────────────────────────────────
  let r2Key: string | null = null;
  if (r2Configured()) {
    try {
      const key = candidateKey(userId, `${Date.now()}_${filename}`);
      await r2Put(key, buffer, "application/pdf");
      r2Key = key;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[passport-pdf] R2 put failed:", msg);
      return NextResponse.json({ error: `Storage failed: ${msg}` }, { status: 500 });
    }
  }

  // ── Google Drive — legacy, only when R2 isn't configured. Non-fatal so a
  // suspended Google account can't break this route. ──────────────────────────
  let driveFileId: string | null = null;
  if (!r2Configured()) {
    try {
      const drive      = getDriveClient();
      const rootId     = ROOT_FOLDER_ID();
      const folderName = [profile.first_name?.trim(), profile.last_name?.trim()].filter(Boolean).join(" ") || userId;
      const folderId   = await getOrCreateFolder(drive, folderName, rootId);
      const stream = new PassThrough();
      stream.end(buffer);
      const driveRes = await drive.files.create({
        requestBody: { name: filename, parents: [folderId] },
        media:       { mimeType: "application/pdf", body: stream },
        fields:      "id",
        supportsAllDrives: true,
      });
      driveFileId = driveRes.data.id ?? null;
      if (driveFileId) await makeDrivePublic(drive, driveFileId);
    } catch (e) {
      console.error("[passport-pdf] Drive (legacy) failed — non-fatal:", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ success: true, driveFileId, r2Key, filename });
}
