/**
 * The Visa-Mappe (founder 2026-11-10, journey stage 4: "a place where employer and nurse download and
 * gather all the documents once her visa appointment is there"). One PDF: a contents page, then every
 * APPROVED document of the nurse, in the order of the candidate checklist (passport, CV, letter,
 * language certificate, qualifications with their translations, the rest at the end).
 *
 * Built in the BROWSER from the portal's own file downloads (/api/portal/file), so every existing
 * check (who may see what, the passport integrity of LAW #39) stays exactly where it is. Nothing is
 * stored, nothing is changed: the documents are only read.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { CHECKLIST_ITEMS } from "@/lib/candidateChecklist";
import { resolveFileKey, canonicalDocLabel } from "@/lib/fileKeys";

export type BundleDoc = { id: string; file_type: string | null; status: string | null; uploaded_at?: string | null };
type Lang = "de" | "en" | "fr";

const ORDER = new Map(CHECKLIST_ITEMS.map((it, i) => [it.key, i] as const));

/** Where a document goes in the folder: its checklist item, the translation right after the original. */
export function bundleRank(fileType: string | null): number {
  const key = resolveFileKey(fileType);
  if (!key) return 9999;
  if (ORDER.has(key)) return ORDER.get(key)! * 2;
  const base = key.replace(/_de$/, "");
  if (base !== key && ORDER.has(base)) return ORDER.get(base)! * 2 + 1;
  return 5000; // slot documents, Sonstiges: after the checklist, in upload order
}

export function bundleLabel(fileType: string | null, lang: Lang): string {
  const key = resolveFileKey(fileType);
  return (key && canonicalDocLabel(key, lang)) || (fileType ?? "").trim() || "Dokument";
}

/** The approved documents, in folder order. */
export function bundleOrder(docs: BundleDoc[]): BundleDoc[] {
  return docs
    .filter((d) => d.status === "approved")
    .map((d, i) => ({ d, i, r: bundleRank(d.file_type) }))
    .sort((a, b) => a.r - b.r || String(a.d.uploaded_at ?? "").localeCompare(String(b.d.uploaded_at ?? "")) || a.i - b.i)
    .map((x) => x.d);
}

const T = {
  de: { title: "Visa-Mappe", for: "für", made: "Erstellt am", list: "Inhalt", page: "Seite", skipped: "Nicht enthalten (Datei nicht lesbar)", note: "Alle freigegebenen Unterlagen, in der Reihenfolge der Checkliste." },
  en: { title: "Visa folder", for: "for", made: "Created on", list: "Contents", page: "Page", skipped: "Not included (file could not be read)", note: "All approved documents, in checklist order." },
  fr: { title: "Dossier visa", for: "pour", made: "Créé le", list: "Sommaire", page: "Page", skipped: "Non inclus (fichier illisible)", note: "Tous les documents validés, dans l’ordre de la liste." },
} as const;

/** WinAnsi-safe text for the standard font (umlauts fine; anything exotic becomes "?"). */
const safe = (s: string) => s.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”„]/g, '"').replace(/[^ -~ -ÿ]/g, "?");

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isJpg = (b: Uint8Array) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8;
const isPng = (b: Uint8Array) => b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

export async function buildVisaBundle(
  docs: BundleDoc[],
  fetchBytes: (id: string) => Promise<Uint8Array | null>,
  meta: { name: string; lang: Lang; date?: Date },
): Promise<{ bytes: Uint8Array; included: number; skipped: string[] }> {
  const t = T[meta.lang] ?? T.de;
  const out = await PDFDocument.create();
  out.setTitle(`${t.title} · ${meta.name}`);
  out.setCreator("borivon.com");
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];
  const ink = rgb(0.082, 0.075, 0.059), mute = rgb(0.42, 0.39, 0.345), gold = rgb(0.478, 0.36, 0.125), line = rgb(0.867, 0.84, 0.784);

  const cover = out.addPage(A4);
  const ordered = bundleOrder(docs);
  const rows: { label: string; page: number }[] = [];
  const skipped: string[] = [];

  for (const d of ordered) {
    const label = bundleLabel(d.file_type, meta.lang);
    const bytes = await fetchBytes(d.id).catch(() => null);
    if (!bytes) { skipped.push(label); continue; }
    const startPage = out.getPageCount() + 1;
    try {
      if (isPdf(bytes)) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      } else if (isJpg(bytes) || isPng(bytes)) {
        const img = isJpg(bytes) ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        const page = out.addPage(A4);
        const m = 36, maxW = A4[0] - 2 * m, maxH = A4[1] - 2 * m;
        const s = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * s, h = img.height * s;
        page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
      } else { skipped.push(label); continue; }
      rows.push({ label, page: startPage });
    } catch {
      skipped.push(label);
    }
  }

  // the contents page, in the site's quiet look
  const M = 56;
  let y = A4[1] - 96;
  cover.drawText("Borivon.", { x: M, y: A4[1] - 60, size: 13, font: bold, color: ink });
  cover.drawText(safe(t.title), { x: M, y, size: 30, font: bold, color: ink });
  y -= 28;
  cover.drawText(safe(`${t.for} ${meta.name}`), { x: M, y, size: 13, font, color: ink });
  y -= 18;
  const when = (meta.date ?? new Date()).toLocaleDateString(meta.lang === "en" ? "en-GB" : meta.lang === "fr" ? "fr-FR" : "de-DE", { day: "numeric", month: "long", year: "numeric" });
  cover.drawText(safe(`${t.made} ${when} · ${t.note}`), { x: M, y, size: 9.5, font, color: mute });
  y -= 34;
  cover.drawText(safe(t.list.toUpperCase()), { x: M, y, size: 8.5, font: bold, color: gold });
  y -= 12;
  for (const r of rows) {
    if (y < 90) break;
    cover.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: line });
    y -= 18;
    cover.drawText(safe(r.label).slice(0, 80), { x: M, y, size: 11, font, color: ink });
    const pg = `${t.page} ${r.page}`;
    cover.drawText(safe(pg), { x: A4[0] - M - font.widthOfTextAtSize(pg, 10), y, size: 10, font, color: mute });
    y -= 10;
  }
  if (skipped.length && y > 100) {
    y -= 22;
    cover.drawText(safe(`${t.skipped}: ${skipped.join(", ")}`).slice(0, 120), { x: M, y, size: 9, font, color: rgb(0.6, 0.29, 0.2) });
  }
  return { bytes: await out.save(), included: rows.length, skipped };
}
