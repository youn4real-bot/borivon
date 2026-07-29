import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, degrees } from "pdf-lib";
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
    return canActOnCandidate(adminAuth.role, adminAuth.email, origDoc.user_id);
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

    // Refuse before pdf-lib gets involved. Each source is capped at 10 MB on
    // upload, but nothing capped the PAIR — and merging holds both parsed
    // documents, the copied pages and the saved output at once, several times
    // the input in peak memory. Two large scans were enough to push a Workers
    // isolate over its limit, which surfaces as an opaque failure rather than a
    // message anyone can act on. Say so instead.
    const MAX_COMBINED = 16 * 1024 * 1024;
    const combined = transBytes.length + origBytes.length;
    if (combined > MAX_COMBINED) {
      return NextResponse.json({
        error: "too_large",
        message: `These two files come to ${(combined / 1048576).toFixed(1)} MB together, which is too much to merge in one go. Download them separately.`,
      }, { status: 413 });
    }

    // Merge: translated pages first, then original pages
    const merged = await PDFDocument.create();

    const transPdf = await PDFDocument.load(transBytes);
    const origPdf  = await PDFDocument.load(origBytes);

    const transPages = await merged.copyPages(transPdf, transPdf.getPageIndices());
    transPages.forEach(p => {
      if (transMeta.rotation) {
        const cur = p.getRotation().angle;
        p.setRotation(degrees((cur + transMeta.rotation) % 360));
      }
      merged.addPage(p);
    });

    const origPages = await merged.copyPages(origPdf, origPdf.getPageIndices());
    origPages.forEach(p => {
      if (origMeta.rotation) {
        const cur = p.getRotation().angle;
        p.setRotation(degrees((cur + origMeta.rotation) % 360));
      }
      merged.addPage(p);
    });

    const mergedBytes = await merged.save();

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
