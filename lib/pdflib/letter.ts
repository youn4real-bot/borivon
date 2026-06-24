/**
 * lib/pdflib/letter.ts — pure-pdf-lib re-render of components/LetterDocument.tsx.
 *
 * One-page A4 German Motivationsschreiben (employer letter + visa letter). Mirrors
 * the component: right-aligned sender block, left recipient block, right date,
 * bold (optionally centered) Betreff, salutation, body paragraphs, closing with an
 * optional hand-signature gap. Uses the same font-fit tiers + balanceWrap so the
 * output matches the @react-pdf original on Workers.
 */
import { PDFDocument, PageSizes } from "pdf-lib";
import { embedFonts, hexColor, Surface, wrapText, type DocFont } from "./render";
import type { LetterData } from "@/components/LetterDocument";

const INK = hexColor("#1C1C1E");

// ── balanceWrap helpers (copied 1:1 from the component for identical splits) ──
function approxWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    if (ch >= "A" && ch <= "Z") w += 1.0;
    else if (ch >= "a" && ch <= "z") w += 0.62;
    else if (ch === " ") w += 0.38;
    else w += 0.6;
  }
  return w;
}
function balanceWrap(text: string, capacity: number): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  const total = approxWidth(t);
  if (total <= capacity) return [t];
  const words = t.split(/\s+/);
  const lineCount = Math.max(2, Math.ceil(total / capacity));
  const target = total / lineCount;
  const rows: string[] = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && approxWidth(candidate) > target && rows.length < lineCount - 1) {
      rows.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

export async function renderLetterPdf(data: LetterData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await embedFonts(doc, ["Lexend-Regular.ttf", "Lexend-Bold.ttf"]);
  const reg = f["Lexend-Regular.ttf"];
  const bold = f["Lexend-Bold.ttf"];

  const [PW, PH] = PageSizes.A4;
  const padL = 64;
  const padR = 56;
  const padT = 48;
  const leftX = padL;
  const rightX = PW - padR;
  const contentW = PW - padL - padR;

  const bodyChars = data.bodyParagraphs.join(" ").length + (data.signSpace ? 220 : 40);
  const fit =
    bodyChars < 1100 ? { fs: 10.5, lh: 1.45, pmb: 10 } :
    bodyChars < 1500 ? { fs: 10, lh: 1.4, pmb: 9 } :
    bodyChars < 1900 ? { fs: 9.5, lh: 1.35, pmb: 8 } :
    { fs: 9, lh: 1.3, pmb: 7 };
  const fs = fit.fs;
  const adv = fs * fit.lh;
  const colCap = 44 * (10.5 / fit.fs);

  const page = doc.addPage([PW, PH]);
  const surf = new Surface(page, PH);
  let y = padT;

  const right = (text: string, font: DocFont = reg) => {
    surf.text(text, rightX - font.widthOf(text, fs), y, font, fs, INK);
    y += adv;
  };
  const left = (text: string, font: DocFont = reg) => {
    surf.text(text, leftX, y, font, fs, INK);
    y += adv;
  };
  const para = (text: string, font: DocFont = reg, center = false) => {
    for (const ln of wrapText(text, font, fs, contentW)) {
      const x = center ? leftX + (contentW - font.widthOf(ln, fs)) / 2 : leftX;
      surf.text(ln, x, y, font, fs, INK);
      y += adv;
    }
  };

  // Sender (right-aligned), block marginBottom 26
  right(data.senderName || " ");
  for (const r of balanceWrap(data.senderStreet, colCap)) right(r);
  for (const r of balanceWrap(data.senderPlace, colCap)) right(r);
  if (data.senderPhone) right(`Telefon: ${data.senderPhone}`);
  if (data.senderEmail) right(data.senderEmail);
  y += 26;

  // Recipient (left), block marginBottom 26
  for (const l of data.recipientLines) for (const r of balanceWrap(l, colCap)) left(r);
  y += 26;

  // Date (right), marginBottom 26
  right(data.dateLine);
  y += 26;

  // Betreff (bold, optional center), marginBottom 18
  if (data.subject) {
    para(data.subject, bold, !!data.subjectCenter);
    y += 18;
  }

  // Salutation, marginBottom 18
  para(data.salutation);
  y += 18;

  // Body paragraphs, each marginBottom fit.pmb
  for (const p of data.bodyParagraphs.filter((p) => p.trim())) {
    para(p);
    y += fit.pmb;
  }

  // Closing, marginTop 26; closingName marginTop 6 (or 52 for the visa sign gap)
  y += 26;
  left("Mit freundlichen Grüßen");
  y += data.signSpace ? 52 : 6;
  surf.text(data.closingName, leftX, y, reg, fs, INK);

  return doc.save();
}
