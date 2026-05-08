import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

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
    .select("id, document_name, note, status, signed_at, signed_pdf_path, viewed_at, created_at")
    .eq("candidate_user_id", candidateId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Internal error" }, { status: 500 });

  // Generate short-lived signed URLs for completed signed PDFs
  const requests = await Promise.all(
    (data ?? []).map(async (r: {
      id: string; document_name: string; note: string | null;
      status: string; signed_at: string | null;
      signed_pdf_path: string | null; viewed_at: string | null; created_at: string;
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
  let signatureZone: unknown = undefined;
  let parties: { admin?: boolean; candidate?: boolean } | undefined;

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    candidateId  = String(fd.get("candidateId")  ?? "");
    documentName = String(fd.get("documentName") ?? "");
    driveFileId  = String(fd.get("driveFileId")  ?? "");
    note         = String(fd.get("note")         ?? "");
    const zoneStr = fd.get("signatureZone");
    if (typeof zoneStr === "string" && zoneStr) {
      try { signatureZone = JSON.parse(zoneStr); } catch { /* ignore */ }
    }
    const partiesStr = fd.get("parties");
    if (typeof partiesStr === "string" && partiesStr) {
      try { parties = JSON.parse(partiesStr); } catch { /* ignore */ }
    }
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
    let body: { candidateId?: string; documentName?: string; pdfBase64?: string; driveFileId?: string; note?: string; signatureZone?: unknown; parties?: { admin?: boolean; candidate?: boolean } };
    try { body = JSON.parse(raw); } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    candidateId  = body.candidateId ?? "";
    documentName = body.documentName ?? "";
    driveFileId  = body.driveFileId ?? "";
    note         = body.note ?? "";
    signatureZone = body.signatureZone;
    parties      = body.parties;
    if (body.pdfBase64) {
      pdfBuffer = Buffer.from(body.pdfBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    }
  }

  if (!candidateId || !documentName || (!pdfBuffer && !driveFileId)) {
    return NextResponse.json({ error: "Missing fields (candidateId, documentName, and pdf or driveFileId)" }, { status: 400 });
  }

  if (!(await canActOnCandidate(auth.role, auth.email, candidateId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Insert sign_request first to get the ID for the storage path
  const db = getServiceSupabase();
  const { data: row, error: insertErr } = await db
    .from("sign_requests")
    .insert({
      candidate_user_id: candidateId,
      created_by_email:  auth.email,
      document_name:     documentName,
      note:              note || null,
      status:            "pending",
      signature_zone:    signatureZone ? JSON.stringify(signatureZone) : null,
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
    .upload(storagePath, pdfBuffer, {
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

  // Insert candidate notification so it shows up in their bell.
  // Store the sign_request id in `doc_id` so the bell can deep-link to it.
  await db.from("notifications").insert({
    user_id:  candidateId,
    doc_id:   requestId,
    doc_name: documentName,
    doc_type: "sign_request",
    action:   "sign_request",
    feedback: null,
    read:     false,
  }); // non-blocking, best-effort — ignore errors

  return NextResponse.json({ id: requestId });
}
