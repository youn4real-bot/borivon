import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const BUCKET = "sign-documents";

/**
 * POST /api/portal/me/sign-requests/[id]/sign
 * Body: { signatureBase64: string }  — PNG data URI of the drawn signature
 *
 * 1. Verifies the request belongs to the authenticated candidate
 * 2. Downloads the original PDF from Supabase Storage
 * 3. Stamps the signature + name + date onto the last page using pdf-lib
 * 4. Uploads the signed PDF back to Supabase Storage
 * 5. Updates sign_requests: status=signed, signed_pdf_path, signed_at
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { signatureBase64?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { signatureBase64 } = body;
  if (!signatureBase64) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const db = getServiceSupabase();

  // Load the sign request — verify it belongs to this candidate
  const { data: request } = await db
    .from("sign_requests")
    .select("id, candidate_user_id, document_name, pdf_storage_path, status, signature_zone")
    .eq("id", id)
    .eq("candidate_user_id", auth.userId)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((request as { status: string }).status === "signed") {
    return NextResponse.json({ error: "Already signed" }, { status: 409 });
  }

  const r = request as {
    id: string; candidate_user_id: string;
    document_name: string; pdf_storage_path: string | null;
    status: string; signature_zone: string | null;
  };

  if (!r.pdf_storage_path) {
    return NextResponse.json({ error: "No PDF attached to this request" }, { status: 400 });
  }

  // Download original PDF
  const { data: pdfDownload, error: dlErr } = await db.storage
    .from(BUCKET)
    .download(r.pdf_storage_path);

  if (dlErr || !pdfDownload) {
    console.error("[sign] download error:", dlErr);
    return NextResponse.json({ error: "Could not fetch document" }, { status: 500 });
  }

  const originalBytes = new Uint8Array(await pdfDownload.arrayBuffer());

  // Get signer name
  let signerName = auth.email;
  try {
    const { data } = await db.auth.admin.getUserById(auth.userId);
    if (data?.user?.user_metadata?.full_name) {
      signerName = data.user.user_metadata.full_name as string;
    }
  } catch { /* fallback to email */ }

  // Stamp signature onto the PDF using pdf-lib
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages  = pdfDoc.getPages();

  // Parse zone (stored as JSON string, normalized 0-1 coords)
  type SigZone = { page: number; x: number; y: number; w: number; h: number };
  let zone: SigZone | null = null;
  if (r.signature_zone) {
    try { zone = JSON.parse(r.signature_zone) as SigZone; } catch { /* use default */ }
  }

  // Select the target page (zone.page is 1-indexed; clamp to valid range)
  const pageIndex = zone
    ? Math.max(0, Math.min(pages.length - 1, zone.page - 1))
    : pages.length - 1;
  const page = pages[pageIndex];
  const { width: pageW, height: pageH } = page.getSize();

  // Embed the signature image — support both PNG and JPEG
  const sigDataUri = signatureBase64.startsWith("data:")
    ? signatureBase64
    : `data:image/png;base64,${signatureBase64}`;
  const isJpeg    = /^data:image\/jpe?g;/i.test(sigDataUri);
  const sigBase64  = sigDataUri.replace(/^data:[^;]+;base64,/, "");
  const sigBytes   = Uint8Array.from(Buffer.from(sigBase64, "base64"));
  const sigImage   = isJpeg
    ? await pdfDoc.embedJpg(sigBytes)
    : await pdfDoc.embedPng(sigBytes);

  // Compute zone rect in PDF coordinates (origin = bottom-left in pdf-lib)
  let zoneX: number, zoneY: number, zoneW: number, zoneH: number;
  if (zone) {
    zoneW = zone.w * pageW;
    zoneH = zone.h * pageH;
    zoneX = zone.x * pageW;
    // PDF origin is bottom-left; zone.y is from the top
    zoneY = pageH - (zone.y + zone.h) * pageH;
  } else {
    // Default: bottom-right corner
    zoneW = 200; zoneH = 72;
    zoneX = pageW - zoneW - 28;
    zoneY = 28;
  }

  // Scale signature image to fit inside the zone
  const sigDims = sigImage.scaleToFit(zoneW * 0.92, zoneH * 0.62);
  const imgX    = zoneX + (zoneW - sigDims.width) / 2;
  const imgY    = zoneY + zoneH * 0.3; // leave room for name/date below

  // Light background rect for the entire zone
  page.drawRectangle({
    x: zoneX, y: zoneY,
    width: zoneW, height: zoneH,
    color: rgb(0.97, 0.97, 0.97),
    borderColor: rgb(0.75, 0.75, 0.75),
    borderWidth: 0.5,
    opacity: 0.92,
  });

  // Signature image
  page.drawImage(sigImage, {
    x: imgX, y: imgY,
    width: sigDims.width, height: sigDims.height,
  });

  // Divider line + name + date
  const font    = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const dateStr = new Date().toLocaleDateString("en-GB");
  const lineY   = zoneY + zoneH * 0.28;

  page.drawLine({
    start: { x: zoneX + 4, y: lineY },
    end:   { x: zoneX + zoneW - 4, y: lineY },
    thickness: 0.4,
    color: rgb(0.7, 0.7, 0.7),
  });

  const fontSize = Math.max(5, Math.min(7, zoneW / 30));
  page.drawText(signerName, {
    x: zoneX + 5, y: lineY - fontSize - 2,
    size: fontSize, font, color: rgb(0.3, 0.3, 0.3),
    maxWidth: zoneW - 10,
  });
  page.drawText(dateStr, {
    x: zoneX + 5, y: zoneY + 3,
    size: fontSize, font, color: rgb(0.5, 0.5, 0.5),
  });

  const signedBytes = await pdfDoc.save();

  // Upload signed PDF
  const signedPath = r.pdf_storage_path.replace(/\.pdf$/, "-signed.pdf");
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(signedPath, signedBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (upErr) {
    console.error("[sign] upload error:", upErr);
    return NextResponse.json({ error: "Could not save signed document" }, { status: 500 });
  }

  // Update record — guard against silent failure
  const { error: updateErr } = await db
    .from("sign_requests")
    .update({
      status:          "signed",
      signed_at:       new Date().toISOString(),
      signed_pdf_path: signedPath,
    })
    .eq("id", id);

  if (updateErr) {
    console.error("[sign] update error:", updateErr);
    return NextResponse.json({ error: "Could not update signature record" }, { status: 500 });
  }

  // Notify the supreme admin (and any org admin assigned to this candidate)
  // that the document was signed. Best-effort — don't fail the sign if this
  // breaks. The admin_notifications table powers the admin bell with realtime.
  try {
    const { error: notifErr } = await db.from("admin_notifications").insert({
      type:        "doc-signed",
      user_name:   signerName,
      user_email:  auth.email,
      doc_type:    "sign_request",
      doc_name:    r.document_name,
    });
    if (notifErr) console.warn("[sign] admin notification insert failed (non-fatal):", notifErr);
  } catch (e) {
    console.warn("[sign] admin notification exception (non-fatal):", e);
  }

  // Generate short-lived URL for immediate confirmation
  const { data: urlData } = await db.storage
    .from(BUCKET)
    .createSignedUrl(signedPath, 3600);

  return NextResponse.json({ ok: true, signedPdfUrl: urlData?.signedUrl ?? null });
}
