import { NextRequest, NextResponse } from "next/server";
import { mergeDocumentsToPdf, refusalStatus, type MergeRefusalCode } from "@/lib/mergeDocs";
import { getServiceSupabase, getAnonVerifyClient } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { isSoftDeletedAuthUser } from "@/lib/softDeleted";
import { dlTokenUserId } from "@/lib/dlToken";
import { r2GetObject } from "@/lib/r2";
import { isPassportFileType } from "@/lib/passportFile";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";

async function resolveFileMeta(
  db: ReturnType<typeof getServiceSupabase>,
  driveId: string | null,
  docId: string | null,
): Promise<{ fileId: string | null; rotation: number; r2Key: string | null; fileType: string | null }> {
  const { data } = await db
    .from("documents")
    .select("drive_file_id, rotation, r2_key, file_type")
    .eq(driveId ? "drive_file_id" : "id", driveId ?? docId!)
    .maybeSingle();
  if (!data) return { fileId: driveId, rotation: 0, r2Key: null, fileType: null };
  const row = data as { drive_file_id: string | null; rotation: number | null; r2_key: string | null; file_type: string | null };
  const rot = ((row.rotation ?? 0) % 360 + 360) % 360;
  return { fileId: driveId ?? row.drive_file_id ?? null, rotation: rot, r2Key: row.r2_key ?? null, fileType: row.file_type ?? null };
}

async function isAuthorised(
  req: NextRequest,
  origDriveId: string | null,
  transDriveId: string | null,
  origDocId: string | null,
  transDocId: string | null,
): Promise<boolean> {
  const db = getServiceSupabase();

  const adminAuth = await requireAdminRole(req);
  if (adminAuth.ok) {
    if (adminAuth.role === "admin") return true;
    const { data: origDoc } = await db
      .from("documents")
      .select("user_id")
      .eq(origDriveId ? "drive_file_id" : "id", origDriveId ?? origDocId!)
      .maybeSingle();
    if (!origDoc) return false;
    if (!(await canActOnCandidate(adminAuth.role, adminAuth.email, origDoc.user_id))) return false;
    // LAW #25: the TRANSLATION doc must be scope-checked too, and belong to the
    // SAME candidate — otherwise an org-scoped sub-admin could pass a transId for
    // ANOTHER org's candidate and get that candidate's document merged into the
    // output (the candidate branch below already checks both; this branch didn't).
    if (transDriveId || transDocId) {
      const { data: transDoc } = await db
        .from("documents")
        .select("user_id")
        .eq(transDriveId ? "drive_file_id" : "id", transDriveId ?? transDocId!)
        .maybeSingle();
      if (!transDoc || transDoc.user_id !== origDoc.user_id) return false;
    }
    return true;
  }

  // Header JWT (fetch) OR short-lived signed download token (?dlt=, iOS
  // navigation). Raw JWT is no longer accepted from the URL.
  const authHeader = req.headers.get("authorization");
  const headerJwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let actorId: string | null = null;
  if (headerJwt) {
    const { data: { user }, error } = await getAnonVerifyClient().auth.getUser(headerJwt);
    if (!error && user && !isSoftDeletedAuthUser(user)) actorId = user.id;
  } else {
    actorId = dlTokenUserId(req);
  }
  if (!actorId) return false;

  const { count: origCount } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq(origDriveId ? "drive_file_id" : "id", origDriveId ?? origDocId!)
    .eq("user_id", actorId);
  if (!origCount) return false;

  const { count: transCount } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq(transDriveId ? "drive_file_id" : "id", transDriveId ?? transDocId!)
    .eq("user_id", actorId);
  return !!transCount;
}

/**
 * English fallback text for a merge refusal.
 *
 * The dashboard and the admin panel translate the `error` CODE (LAW #19);
 * this is for everything that reads the body raw -- a curl while debugging, a
 * log line, and any caller that only knows how to show `message`. It names the
 * way out, because "Merge failed" left the candidate with nowhere to go.
 */
function refusalMessage(r: { code: MergeRefusalCode; megapixels?: number; megabytes?: number }): string {
  switch (r.code) {
    case "too_large":
      return `These two files come to ${r.megabytes ? r.megabytes.toFixed(1) : "more than 16"} MB together, which is too much to merge in one go. Download them separately.`;
    case "unsupported_format":
      return "One of these two files is in a format that cannot be merged. Download them separately, or re-upload that one as a PDF or a JPEG photo.";
    case "image_too_large":
      return `One of these two files is a ${r.megapixels ? r.megapixels.toFixed(0) : "very large"}-megapixel image, too big to merge. Download them separately, or re-upload it as a JPEG photo.`;
    case "unreadable":
      return "One of these two files could not be read. Download them separately, and re-upload the damaged one.";
  }
}

export async function GET(req: NextRequest) {
  const origId    = req.nextUrl.searchParams.get("origId");
  const transId   = req.nextUrl.searchParams.get("transId");
  const origDocId = req.nextUrl.searchParams.get("origDocId");
  const transDocId = req.nextUrl.searchParams.get("transDocId");

  if (!origId && !origDocId)
    return new NextResponse("Missing origId or origDocId", { status: 400 });
  if (!transId && !transDocId)
    return new NextResponse("Missing transId or transDocId", { status: 400 });

  const allowed = await isAuthorised(req, origId, transId, origDocId, transDocId);
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  // isAuthorised() returns only a boolean across four distinct auth branches
  // (admin / sub-admin / JWT user / dl-token) and never surfaces the actor's
  // id, so there's no safe per-identity key here — fall back to a per-IP
  // distributed limit, placed after the auth gate but before the PDF merge.
  const rl = await enforceRateLimitDistributed(req, "generate", { limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });
  }

  // Resolve doc IDs to storage keys + per-doc rotation. The bytes only ever come from R2, but a
  // legacy row that still carries a drive_file_id and no r2_key deliberately passes this guard:
  // "the document exists, its bytes are missing" is a 500 further down, not a 404 here. Treating
  // it as a 404 would tell the caller the document is gone, which is a different and wrong claim.
  const db = getServiceSupabase();
  const [origMeta, transMeta] = await Promise.all([
    resolveFileMeta(db, origId, origDocId),
    resolveFileMeta(db, transId, transDocId),
  ]);
  if ((!origMeta.fileId && !origMeta.r2Key) || (!transMeta.fileId && !transMeta.r2Key))
    return new NextResponse("File not found", { status: 404 });

  // LAW #39: passport scans must NEVER go through pdf-lib load()+save() — it
  // silently drops MRZ/VIZ content streams. Merge is only ever for a
  // qualification original/translation pair; passports have no translation
  // counterpart, so refuse outright rather than corrupt the most sensitive doc.
  if (isPassportFileType(origMeta.fileType) || isPassportFileType(transMeta.fileType))
    return new NextResponse("Passport documents cannot be merged", { status: 400 });

  // R2 is the store of record. A Drive fallback used to live here, but googleapis crashes on
  // Cloudflare Workers (google-auth-library → node:http.validateHeaderName), so it was already
  // guarded off in production and could never run — while still dragging by far the heaviest
  // dependency in the app into the worker bundle and taxing every route's cold start. A source
  // that isn't in R2 therefore fails exactly as it did before: this throws, and the caller's
  // catch turns it into a 500.
  const loadBytes = async (m: { r2Key: string | null }): Promise<Buffer> => {
    if (m.r2Key) {
      const o = await r2GetObject(m.r2Key);
      if (o) return o.body;
    }
    throw new Error("file not found (R2 only)");
  };

  try {
    // Fetch both PDFs in parallel (übersetzt first, then original)
    const [transBytes, origBytes] = await Promise.all([
      loadBytes(transMeta),
      loadBytes(origMeta),
    ]);

    // The combined-size ceiling used to live HERE, as its own early return with
    // its own JSON body — and that is exactly how its `too_large` code ended up
    // outside MERGE_REFUSAL_CODES, so every client that hit it showed "Download
    // failed — please try again" for a pair that can never fit. The rule now
    // lives in lib/mergeDocs.ts (MAX_COMBINED_BYTES) and comes back through the
    // one refusal path below, in the one vocabulary the clients translate.
    //
    // Merge: translated pages first, then original pages. Either half can now
    // be a PHOTOGRAPH, so the merging itself lives in lib/mergeDocs.ts, which
    // turns a JPEG or PNG into a page rather than throwing into the catch
    // below. That throw was the entire reason every upload box except the
    // passport still had to say "PDF only".
    const result = await mergeDocumentsToPdf([
      { bytes: transBytes, rotation: transMeta.rotation },
      { bytes: origBytes,  rotation: origMeta.rotation },
    ]);

    // A format that cannot be merged is a fact about the file, not a server
    // fault. Return a code the dashboard and the admin panel turn into a
    // translated sentence (LAW #19); the bare 500 this replaces said nothing,
    // which is the failure mode this whole branch exists to remove.
    if (!result.ok) {
      return NextResponse.json({
        error: result.code,
        kind: result.kind,
        message: refusalMessage(result),
      }, { status: refusalStatus(result.code) });
    }
    const mergedBytes = result.bytes;

    {
      const dl = req.nextUrl.searchParams.get("dl") === "1";
      const nm = (req.nextUrl.searchParams.get("name") || "merged.pdf")
        .replace(/[\r\n"]/g, "").slice(0, 200);
      return new NextResponse(Buffer.from(mergedBytes), {
        headers: {
          // octet-stream + filename so iOS Safari actually downloads it.
          "Content-Type": dl ? "application/octet-stream" : "application/pdf",
          "Content-Disposition": dl ? `attachment; filename="${nm}"` : "attachment",
          "Cache-Control": "private, no-store",
        },
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[merge-pdf] error:", msg);
    return new NextResponse("Merge failed", { status: 500 });
  }
}
