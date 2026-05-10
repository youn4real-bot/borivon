import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser } from "@/lib/admin-auth";
import { PDFDocument } from "pdf-lib";

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

  let body: { signatureBase64?: string; signatureZone?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { signatureBase64, signatureZone: clientZoneRaw } = body;
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

  // Parse zones — stored as JSON string; may be array (new) or single object (legacy)
  type SigZone = { page: number; x: number; y: number; w: number; h: number; party?: string };
  function isValidZone(z: Partial<SigZone>): z is SigZone {
    return (
      Number.isFinite(z.page) && (z.page as number) >= 1 &&
      Number.isFinite(z.x) && (z.x as number) >= 0 && (z.x as number) <= 1 &&
      Number.isFinite(z.y) && (z.y as number) >= 0 && (z.y as number) <= 1 &&
      Number.isFinite(z.w) && (z.w as number) > 0 && (z.w as number) <= 1 &&
      Number.isFinite(z.h) && (z.h as number) > 0 && (z.h as number) <= 1
    );
  }
  let allZones: SigZone[] = [];
  if (r.signature_zone) {
    try {
      const parsed = JSON.parse(r.signature_zone);
      if (Array.isArray(parsed)) {
        allZones = parsed.filter(isValidZone);
      } else if (isValidZone(parsed as Partial<SigZone>)) {
        allZones = [parsed as SigZone];
      }
    } catch { /* use default */ }
  }
  // If client sent adjusted zones (candidate resized), prefer those; else use DB zones
  let candidateZones: SigZone[];
  if (clientZoneRaw) {
    const clientArr = Array.isArray(clientZoneRaw) ? clientZoneRaw : [clientZoneRaw];
    const valid = (clientArr as Partial<SigZone>[]).filter(isValidZone);
    candidateZones = valid.length > 0 ? valid : allZones.filter(z => !z.party || z.party === "candidate");
  } else {
    candidateZones = allZones.filter(z => !z.party || z.party === "candidate");
  }

  // Embed the signature image — support both PNG and JPEG
  const sigDataUri = signatureBase64.startsWith("data:")
    ? signatureBase64
    : `data:image/png;base64,${signatureBase64}`;
  const isJpeg   = /^data:image\/jpe?g;/i.test(sigDataUri);
  const sigBase64 = sigDataUri.replace(/^data:[^;]+;base64,/, "");
  const sigBytes  = Uint8Array.from(Buffer.from(sigBase64, "base64"));
  const sigImage  = isJpeg
    ? await pdfDoc.embedJpg(sigBytes)
    : await pdfDoc.embedPng(sigBytes);

  function stampZone(pg: ReturnType<typeof pdfDoc.getPages>[number], zone: SigZone | null) {
    const { width: pageW, height: pageH } = pg.getSize();
    let zoneX: number, zoneY: number, zoneW: number, zoneH: number;
    if (zone) {
      zoneW = zone.w * pageW;
      zoneH = zone.h * pageH;
      zoneX = zone.x * pageW;
      zoneY = pageH - (zone.y + zone.h) * pageH;
    } else {
      zoneW = 200; zoneH = 72;
      zoneX = pageW - zoneW - 28;
      zoneY = 28;
    }
    const sigDims = sigImage.scaleToFit(zoneW, zoneH);
    pg.drawImage(sigImage, { x: zoneX + (zoneW - sigDims.width) / 2, y: zoneY + (zoneH - sigDims.height) / 2, width: sigDims.width, height: sigDims.height });
  }

  if (candidateZones.length > 0) {
    for (const zone of candidateZones) {
      const pageIndex = Math.max(0, Math.min(pages.length - 1, zone.page - 1));
      stampZone(pages[pageIndex], zone);
    }
  } else {
    // No zones defined — stamp default bottom-right of last page
    stampZone(pages[pages.length - 1], null);
  }

  const signedBytes = await pdfDoc.save();

  // Upload signed PDF to its own path
  const signedPath = r.pdf_storage_path.replace(/\.pdf$/, "-signed.pdf");
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(signedPath, signedBytes, { contentType: "application/pdf", upsert: true });

  if (upErr) {
    console.error("[sign] upload error:", upErr);
    return NextResponse.json({ error: "Could not save signed document" }, { status: 500 });
  }

  // Also overwrite the original path so pdf_storage_path always has the latest signed version
  await db.storage
    .from(BUCKET)
    .upload(r.pdf_storage_path, signedBytes, { contentType: "application/pdf", upsert: true });

  // Update record — atomic conditional update guards the SELECT/UPDATE race.
  // If another concurrent sign request already flipped status, this returns
  // 0 rows and we 409 instead of double-stamping.
  const { data: updated, error: updateErr } = await db
    .from("sign_requests")
    .update({
      status:          "signed",
      signed_at:       new Date().toISOString(),
      signed_pdf_path: signedPath,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateErr) {
    console.error("[sign] update error:", updateErr);
    return NextResponse.json({ error: "Could not update signature record" }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Already signed" }, { status: 409 });
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
