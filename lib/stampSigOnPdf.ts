"use client";

import { PDFDocument } from "pdf-lib";

export type SigZone = { page: number; x: number; y: number; w: number; h: number };

/**
 * Embed a signature image (PNG/JPEG data URI) into a PDF at one or more
 * normalized zones (each x/y/w/h in 0..1 of the page). Mirrors the
 * server-side stampZonesOnBuffer logic so admin pre-sign can happen in
 * the browser without a round-trip.
 *
 * Returns the modified PDF bytes (ready for upload).
 */
export async function stampSigOnPdf(
  pdfBytes: ArrayBuffer | Uint8Array,
  sigDataUri: string,
  zones: SigZone[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const isJpeg = /^data:image\/jpe?g;/i.test(sigDataUri);
  const sigBase64 = sigDataUri.replace(/^data:[^;]+;base64,/, "");
  // Browser-safe base64 → Uint8Array
  const sigBytes = Uint8Array.from(atob(sigBase64), c => c.charCodeAt(0));
  const sigImage = isJpeg ? await pdfDoc.embedJpg(sigBytes) : await pdfDoc.embedPng(sigBytes);

  for (const zone of zones) {
    const pageIndex = Math.max(0, Math.min(pages.length - 1, zone.page - 1));
    const pg = pages[pageIndex];
    const { width: pageW, height: pageH } = pg.getSize();
    const zW = zone.w * pageW, zH = zone.h * pageH;
    const zX = zone.x * pageW, zY = pageH - (zone.y + zone.h) * pageH;
    const sigDims = sigImage.scaleToFit(zW, zH);
    pg.drawImage(sigImage, {
      x: zX + (zW - sigDims.width) / 2,
      y: zY + (zH - sigDims.height) / 2,
      width: sigDims.width,
      height: sigDims.height,
    });
  }

  return pdfDoc.save();
}
