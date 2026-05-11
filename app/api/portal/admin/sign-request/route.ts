import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { PDFDocument } from "pdf-lib";

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

async function fetchPdfBuffer(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  const stream = res.data as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return Buffer.concat(chunks);
}

async function updateDriveFile(fileId: string, buffer: Buffer): Promise<void> {
  const drive = getDriveClient();
  const { PassThrough } = await import("stream");
  const stream = new PassThrough();
  stream.end(buffer);
  await drive.files.update({
    fileId,
    supportsAllDrives: true,
    requestBody: {},
    media: { mimeType: "application/pdf", body: stream },
  });
}

const MAX_PDF_BYTES = 10_000_000; // 10 MB
const BUCKET = "sign-documents";

/**
 * GET  /api/portal/admin/sign-request?candidateId=xxx
 *   Returns all sign requests for a candidate, each with a short-lived download URL.
 *
 * POST /api/portal/admin/sign-request
 *   Body: { candidateId, documentName, pdfBase64, note? }
 *   Uploads the PDF to Supabase Storage and creates a sign_request row.
 */

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!candidateId || !UUID_RE.test(candidateId)) return NextResponse.json({ error: "Invalid candidateId" }, { status: 400 });

  if (!(await canActOnCandidate(auth.role, auth.email, candidateId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("sign_requests")
    .select("id, document_name, note, status, signed_at, signed_pdf_path, viewed_at, created_at, review_status, review_feedback")
    .eq("candidate_user_id", candidateId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Internal error" }, { status: 500 });

  // Generate short-lived signed URLs for completed signed PDFs
  const requests = await Promise.all(
    (data ?? []).map(async (r: {
      id: string; document_name: string; note: string | null;
      status: string; signed_at: string | null;
      signed_pdf_path: string | null; viewed_at: string | null; created_at: string;
      review_status: string | null; review_feedback: string | null;
    }) => {
      let signedPdfUrl: string | null = null;
      if (r.signed_pdf_path) {
        const { data: urlData } = await db.storage
          .from(BUCKET)
          .createSignedUrl(r.signed_pdf_path, 3600);
        signedPdfUrl = urlData?.signedUrl ?? null;
      }
      return { ...r, signedPdfUrl };
    })
  );

  return NextResponse.json({ requests });
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Accept BOTH JSON (small payloads, driveFileId path) and multipart/form-data
  // (file uploads — bypasses Vercel's 4.5MB JSON body limit).
  const ct = req.headers.get("content-type") ?? "";
  let candidateId = "", documentName = "", driveFileId = "", note = "";
  let pdfBuffer: Buffer | null = null;
  let signatureZones: unknown = undefined; // array of zones (new) or single zone (legacy)
  let parties: { admin?: boolean; candidate?: boolean } | undefined;
  let adminSignatureBase64: string | undefined;
  let orgSignatureBase64: string | undefined;
  let adminOnly = false;
  let adminSave = false;

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    candidateId  = String(fd.get("candidateId")  ?? "");
    documentName = String(fd.get("documentName") ?? "");
    driveFileId  = String(fd.get("driveFileId")  ?? "");
    note         = String(fd.get("note")         ?? "");
    adminOnly    = fd.get("adminOnly") === "true";
    adminSave    = fd.get("adminSave")  === "true";
    // Accept signatureZones (array) or legacy signatureZone (single)
    const zonesStr = fd.get("signatureZones") ?? fd.get("signatureZone");
    if (typeof zonesStr === "string" && zonesStr) {
      try { signatureZones = JSON.parse(zonesStr); } catch { /* ignore */ }
    }
    const partiesStr = fd.get("parties");
    if (typeof partiesStr === "string" && partiesStr) {
      try { parties = JSON.parse(partiesStr); } catch { /* ignore */ }
    }
    const adminSigStr = fd.get("adminSignatureBase64");
    if (typeof adminSigStr === "string" && adminSigStr) adminSignatureBase64 = adminSigStr;
    const orgSigStr = fd.get("orgSignatureBase64");
    if (typeof orgSigStr === "string" && orgSigStr) orgSignatureBase64 = orgSigStr;
    const pdfFile = fd.get("pdf");
    if (pdfFile instanceof File) {
      const ab = await pdfFile.arrayBuffer();
      if (ab.byteLength > MAX_PDF_BYTES) {
        return NextResponse.json({ error: `PDF too large (max ${MAX_PDF_BYTES / 1_000_000} MB)` }, { status: 413 });
      }
      pdfBuffer = Buffer.from(ab);
    }
  } else {
    const raw = await req.text();
    if (raw.length > MAX_PDF_BYTES * 1.5) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    let body: { candidateId?: string; documentName?: string; pdfBase64?: string; driveFileId?: string; note?: string; signatureZones?: unknown; signatureZone?: unknown; parties?: { admin?: boolean; candidate?: boolean }; adminSignatureBase64?: string; orgSignatureBase64?: string; adminOnly?: boolean; adminSave?: boolean };
    try { body = JSON.parse(raw); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    candidateId  = body.candidateId ?? "";
    documentName = body.documentName ?? "";
    driveFileId  = body.driveFileId ?? "";
    note         = body.note ?? "";
    adminOnly    = body.adminOnly === true;
    adminSave    = body.adminSave  === true;
    // Prefer signatureZones (array), fall back to legacy signatureZone (single)
    signatureZones       = body.signatureZones ?? body.signatureZone;
    parties              = body.parties;
    adminSignatureBase64 = body.adminSignatureBase64;
    orgSignatureBase64   = body.orgSignatureBase64;
    if (body.pdfBase64) {
      pdfBuffer = Buffer.from(body.pdfBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    }
  }

  if (!documentName || (!pdfBuffer && !driveFileId)) {
    return NextResponse.json({ error: "Missing fields (documentName and pdf or driveFileId)" }, { status: 400 });
  }

  if (!adminOnly) {
    if (!candidateId) {
      return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
    }
    if (!(await canActOnCandidate(auth.role, auth.email, candidateId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // If we don't have the bytes yet, fetch from Drive
  if (!pdfBuffer && driveFileId) {
    try {
      pdfBuffer = await fetchPdfBuffer(driveFileId);
    } catch (err) {
      console.error("[sign-request POST] drive fetch error:", err);
      return NextResponse.json({ error: "Could not fetch file from Drive" }, { status: 502 });
    }
  }
  if (!pdfBuffer) {
    return NextResponse.json({ error: "No PDF bytes" }, { status: 400 });
  }

  // Helper: stamp zones onto PDF. If zones is empty and useDefaultPos=true, stamps bottom-right of last page.
  async function stampZonesOnBuffer(buf: Buffer, sigDataUri: string, _signerEmail: string, zones: { page: number; x: number; y: number; w: number; h: number }[], useDefaultPos = false): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(new Uint8Array(buf));
    const pages  = pdfDoc.getPages();
    const isJpeg = /^data:image\/jpe?g;/i.test(sigDataUri);
    const sigBase64 = sigDataUri.replace(/^data:[^;]+;base64,/, "");
    const sigBytes  = Uint8Array.from(Buffer.from(sigBase64, "base64"));
    const sigImage  = isJpeg ? await pdfDoc.embedJpg(sigBytes) : await pdfDoc.embedPng(sigBytes);
    if (zones.length > 0) {
      for (const zone of zones) {
        const pageIndex = Math.max(0, Math.min(pages.length - 1, zone.page - 1));
        const pg = pages[pageIndex];
        const { width: pageW, height: pageH } = pg.getSize();
        const zW = zone.w * pageW, zH = zone.h * pageH;
        const zX = zone.x * pageW, zY = pageH - (zone.y + zone.h) * pageH;
        const sigDims = sigImage.scaleToFit(zW, zH);
        pg.drawImage(sigImage, { x: zX + (zW - sigDims.width) / 2, y: zY + (zH - sigDims.height) / 2, width: sigDims.width, height: sigDims.height });
      }
    } else if (useDefaultPos) {
      // No explicit zones — stamp bottom-right of last page
      const pg = pages[pages.length - 1];
      const { width: pageW, height: pageH } = pg.getSize();
      const zW = 200, zH = 72;
      const zX = pageW - zW - 28, zY = 28;
      const sigDims = sigImage.scaleToFit(zW, zH);
      pg.drawImage(sigImage, { x: zX + (zW - sigDims.width) / 2, y: zY + (zH - sigDims.height) / 2, width: sigDims.width, height: sigDims.height });
    }
    return Buffer.from(await pdfDoc.save());
  }

  // Parse and validate zones helper
  type RawZone = { page: number; x: number; y: number; w: number; h: number; party?: string };
  function parseZones(raw: unknown): RawZone[] {
    function valid(z: Partial<RawZone>): z is RawZone {
      return Number.isFinite(z.page) && (z.page as number) >= 1
          && Number.isFinite(z.x) && Number.isFinite(z.y)
          && Number.isFinite(z.w) && (z.w as number) > 0
          && Number.isFinite(z.h) && (z.h as number) > 0;
    }
    if (Array.isArray(raw)) return (raw as Partial<RawZone>[]).filter(valid);
    if (raw && valid(raw as Partial<RawZone>)) return [raw as RawZone];
    return [];
  }

  // Stamp admin signature only when admin actively signed:
  // - adminOnly/adminSave: use default bottom-right if no zones drawn (intentional self-signing)
  // - candidate mode: only stamp if explicit admin zones exist — never default-stamp onto candidate's PDF
  if (adminSignatureBase64) {
    const allZones = signatureZones ? parseZones(signatureZones) : [];
    const zones = (adminOnly || adminSave) ? allZones : allZones.filter(z => z.party === "admin");
    const useDefault = adminOnly || adminSave;
    if (useDefault || zones.length > 0) {
      try {
        const sigUri = adminSignatureBase64.startsWith("data:") ? adminSignatureBase64 : `data:image/png;base64,${adminSignatureBase64}`;
        pdfBuffer = await stampZonesOnBuffer(pdfBuffer!, sigUri, auth.email, zones, useDefault);
      } catch (e) {
        console.error("[sign-request POST] admin stamp error:", e);
        return NextResponse.json({ error: "Could not stamp admin signature onto PDF. The PDF may be encrypted or in an unsupported format." }, { status: 422 });
      }
    }
  }

  // Stamp org zones (skip in adminOnly/adminSave — all zones already stamped above)
  if (!adminOnly && !adminSave && orgSignatureBase64 && signatureZones) {
    const zones = parseZones(signatureZones).filter(z => z.party === "org");
    if (zones.length > 0) {
      try {
        const sigUri = orgSignatureBase64.startsWith("data:") ? orgSignatureBase64 : `data:image/png;base64,${orgSignatureBase64}`;
        pdfBuffer = await stampZonesOnBuffer(pdfBuffer!, sigUri, auth.email, zones);
      } catch (e) {
        console.error("[sign-request POST] org stamp error:", e);
        return NextResponse.json({ error: "Could not stamp org signature onto PDF." }, { status: 422 });
      }
    }
  }

  // Write signed bytes back to the original Drive file so the "normal pdf popup" shows signatures
  if (driveFileId && (adminOnly || adminSave)) {
    try {
      await updateDriveFile(driveFileId, pdfBuffer!);
    } catch (e) {
      console.warn("[sign-request POST] Drive write-back failed (non-fatal):", e);
    }
  }

  // Admin-only mode: return the stamped PDF directly for download — no DB record
  if (adminOnly) {
    const safeDocName = documentName.replace(/[^\w\s.\-()]/g, "").trim() || "signed-document";
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeDocName}.pdf"`,
      },
    });
  }

  // DB save path (with-candidate + adminSave)
  const db = getServiceSupabase();
  const { data: row, error: insertErr } = await db
    .from("sign_requests")
    .insert({
      candidate_user_id: candidateId,
      created_by_email:  auth.email,
      document_name:     documentName,
      note:              note || null,
      status:            "pending",
      signature_zone:    signatureZones != null ? JSON.stringify(signatureZones) : null,
    })
    .select("id")
    .single();

  if (insertErr || !row) {
    console.error("[sign-request POST] insert error:", insertErr);
    return NextResponse.json({ error: `DB error: ${insertErr?.message ?? "unknown"}` }, { status: 500 });
  }

  const requestId = (row as { id: string }).id;
  const storagePath = `${candidateId}/${requestId}.pdf`;

  // Upload to Supabase Storage
  const { error: uploadErr } = await db.storage
    .from(BUCKET)
    .upload(storagePath, pdfBuffer!, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadErr) {
    console.error("[sign-request POST] storage upload error:", uploadErr);
    // Clean up the orphaned row
    await db.from("sign_requests").delete().eq("id", requestId);
    return NextResponse.json({ error: "Storage error: " + uploadErr.message }, { status: 500 });
  }

  // Save the storage path back to the row
  await db
    .from("sign_requests")
    .update({ pdf_storage_path: storagePath })
    .eq("id", requestId);

  // Permanently point documents.signed_storage_path at the (at least admin-) signed PDF
  // so the document view always serves the signed version, not the Drive original.
  // Runs for all modes — adminSave, adminOnly (save), and with-candidate.
  if (driveFileId && candidateId) {
    await db
      .from("documents")
      .update({ signed_storage_path: storagePath })
      .eq("drive_file_id", driveFileId)
      .eq("user_id", candidateId);
  }

  // Notify candidate (skip for adminSave — admin is saving for own records, not requesting signature)
  if (!adminSave) {
    const { error: notifErr } = await db.from("notifications").insert({
      user_id:  candidateId,
      doc_id:   requestId,
      doc_name: documentName,
      doc_type: "sign_request",
      action:   "sign_request",
      feedback: null,
      read:     false,
    });
    if (notifErr) console.error("[sign-request POST] notification insert failed:", notifErr);
  }

  return NextResponse.json({ id: requestId });
}
