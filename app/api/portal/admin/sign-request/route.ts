import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";

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
  if (!candidateId) return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });

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

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = await req.text();
  if (raw.length > MAX_PDF_BYTES * 1.5) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: { candidateId?: string; documentName?: string; pdfBase64?: string; note?: string; signatureZone?: unknown };
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { candidateId, documentName, pdfBase64, note, signatureZone } = body;
  if (!candidateId || !documentName || !pdfBase64) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!(await canActOnCandidate(auth.role, auth.email, candidateId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Decode base64 PDF
  const pdfBuffer = Buffer.from(
    pdfBase64.replace(/^data:[^;]+;base64,/, ""),
    "base64",
  );

  // Insert sign_request first to get the ID for the storage path
  const db = getServiceSupabase();
  const { data: row, error: insertErr } = await db
    .from("sign_requests")
    .insert({
      candidate_user_id: candidateId,
      created_by_email:  auth.email,
      document_name:     documentName,
      note:              note ?? null,
      status:            "pending",
      signature_zone:    signatureZone ? JSON.stringify(signatureZone) : null,
    })
    .select("id")
    .single();

  if (insertErr || !row) {
    console.error("[sign-request POST] insert error:", insertErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
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

  // Insert candidate notification so it shows up in their bell
  await db.from("notifications").insert({
    user_id:  candidateId,
    doc_id:   null,
    doc_name: documentName,
    doc_type: "sign_request",
    action:   "sign_request",
    feedback: null,
    read:     false,
  }); // non-blocking, best-effort — ignore errors

  return NextResponse.json({ id: requestId });
}
