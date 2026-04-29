import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import {
  generatePassportPdf,
  getDriveClient,
  getOrCreateFolder,
  buildPdfFilename,
  ROOT_FOLDER_ID,
  makeDrivePublic,
} from "@/lib/passport-pdf";
import { PassThrough } from "stream";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET — download passport PDF ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
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

  return new Response(arrayBuffer, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
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

  if (driveRes.data.id) await makeDrivePublic(drive, driveRes.data.id);

  return NextResponse.json({ success: true, driveFileId: driveRes.data.id, filename });
}
