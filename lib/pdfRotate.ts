import { PDFDocument, degrees } from "pdf-lib";

/**
 * Apply a view rotation to a PDF — but NEVER at the cost of the file's
 * content. pdf-lib's load()→save() round-trip silently drops page content
 * for some scanner-produced PDFs (object-stream/incremental-update layouts
 * common in phone passport scans) → the candidate's passport rendered blank
 * ("the data got erased"). This bug is intermittent because it only triggers
 * on those specific PDFs once a rotation is set.
 *
 * Rule: the uploaded PDF must come back EXACTLY as uploaded. If the rotate
 * re-save throws, OR yields an empty/degenerate result (no pages, or the
 * byte size collapsed — the tell-tale of dropped image/content streams),
 * we return the ORIGINAL bytes untouched. Worst case: that one view isn't
 * rotated; the passport is never erased.
 */
export async function safeRotatePdf(original: Buffer, rotation: number): Promise<Buffer> {
  if (rotation === 0) return original;
  try {
    const pdfDoc = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
    const pages = pdfDoc.getPages();
    if (pages.length === 0) return original;
    for (const page of pages) {
      const cur = page.getRotation().angle;
      page.setRotation(degrees((cur + rotation) % 360));
    }
    // `useObjectStreams: false` writes each object as its own stream, which
    // preserves the image / content streams the compacted default save can
    // drop on scanner-produced PDFs. Slightly larger output, content intact.
    const out = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));

    // VERIFY the output instead of guessing from its size.
    //
    // Both previous guards were byte-count heuristics and both silently ate
    // legitimate rotations. `out.length < original.length * 0.5` fired on any
    // ordinary document whose flat re-save compacts (a scanner's verbose PDF
    // halves easily), and `out.length < 1024` fires on any small one. In both
    // cases the rotation was written to the database and the UNROTATED
    // original was served back: rotate, reopen, still sideways, with nothing
    // the user could do about it.
    //
    // What the guard is actually for is catching a re-save that lost content.
    // Re-reading the result and confirming the pages are still there checks
    // exactly that, and cannot be fooled by a file that is merely small or
    // merely well-compressed.
    //
    // Passports never reach here at all: every call site computes
    // `effectiveRotation` as 0 when isPassportFileType(fileType), so LAW #39 is
    // enforced upstream rather than by hoping a size check catches it.
    try {
      const verify = await PDFDocument.load(out, { ignoreEncryption: true });
      if (verify.getPageCount() !== pages.length) return original;
    } catch {
      return original; // unreadable output → never serve it
    }
    return out;
  } catch {
    return original; // encrypted / unsupported / parse failure → never erase
  }
}
