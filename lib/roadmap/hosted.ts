/**
 * The Fahrplan lives ON the website (founder 2026-11-08, like acquisition.com):
 * the mail carries a link, the PDF opens inside borivon.com/fahrplan/plan with
 * its links still clickable, and downloading is optional.
 *
 * Rendered once at delivery and kept in R2 (roadmap/<leadId>/...), so opening
 * is instant; rendered again on demand if the copy is missing. Deleted with
 * the lead's other data by the retention job.
 */
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } from "pdf-lib";
import { r2Configured, r2Put, r2GetObject, r2Delete } from "@/lib/r2";
import { renderRoadmapPdf } from "./pdf";
import { renderAgencyCheckPdf } from "./bonusPdf";
import { scoreRoadmap, normalizeAnswers, type RoadmapAnswers } from "./score";
import { asSalutation, addressName } from "./consent";
import { calcUrl } from "./calc";
import { signLeadToken } from "./token";
import { LANGS, type Lang } from "./content";
import type { RoadmapDetails } from "./leadState";
import { isFormV2, normalizeForm, toModel, facilityLine } from "./form";

export type HostedDoc = "plan" | "bonus";
const SITE = "https://borivon.com";

export const hostedKey = (leadId: string, doc: HostedDoc) => `roadmap/${leadId}/${doc === "plan" ? "fahrplan" : "agentur-check"}.pdf`;

/** The link in the delivery mail: the viewer page with the signed token. */
export async function viewLink(leadId: string, lang: Lang, doc: HostedDoc = "plan"): Promise<string> {
  const p = new URLSearchParams({ id: leadId, t: await signLeadToken("view", leadId), lang });
  if (doc === "bonus") p.set("doc", "bonus");
  return `${SITE}/fahrplan/plan?${p.toString()}`;
}

export function fileName(doc: HostedDoc, lang: Lang): string {
  return doc === "plan"
    ? (lang === "de" ? "Pflege-Fahrplan" : lang === "fr" ? "Plan-infirmier" : "Nurse-staffing-roadmap") + "-Borivon.pdf"
    : (lang === "de" ? "Agentur-Check" : lang === "fr" ? "Check-agence" : "Agency-check") + "-Borivon.pdf";
}

/** Render one document for a lead, exactly as the mail used to attach it. */
export async function renderFor(leadId: string, d: RoadmapDetails, doc: HostedDoc): Promise<Uint8Array> {
  const lang: Lang = LANGS.includes(d.lang as Lang) ? (d.lang as Lang) : "de";
  if (doc === "bonus") return renderAgencyCheckPdf(lang);
  const form = isFormV2(d.form) ? normalizeForm(d.form as Record<string, unknown>) : undefined;
  const answers = form ? toModel(form) : normalizeAnswers((d.answers ?? {}) as Partial<RoadmapAnswers>);
  const result = scoreRoadmap(answers);
  return renderRoadmapPdf({
    result, lang, form,
    name: addressName(lang, asSalutation(d.salutation), String(d.lastName ?? ""), String(d.firstName ?? "")),
    facility: form ? facilityLine(form, lang) : String(d.facility ?? ""),
    date: d.consent?.confirmedAt ? new Date(String(d.consent.confirmedAt)) : new Date(),
    calcUrl: await calcUrl({ lang, facilityType: answers.facilityType, openPosts: answers.openPosts, leftLastYear: answers.leftLastYear, leadId }),
  });
}

/** Store a rendered document (best effort: a miss is re-rendered on open). */
export async function storeHosted(leadId: string, doc: HostedDoc, bytes: Uint8Array): Promise<boolean> {
  if (!r2Configured()) return false;
  try { await r2Put(hostedKey(leadId, doc), bytes, "application/pdf"); return true; }
  catch (e) { console.error("[roadmap] hosted store failed:", e instanceof Error ? e.message : e); return false; }
}

/** The stored copy, or a fresh render (stored for next time). */
export async function getHosted(leadId: string, d: RoadmapDetails, doc: HostedDoc): Promise<Uint8Array> {
  if (r2Configured()) {
    try { const o = await r2GetObject(hostedKey(leadId, doc)); if (o) return new Uint8Array(o.body); }
    catch (e) { console.error("[roadmap] hosted read failed:", e instanceof Error ? e.message : e); }
  }
  const bytes = await renderFor(leadId, d, doc);
  await storeHosted(leadId, doc, bytes);
  return bytes;
}

export async function deleteHosted(leadId: string): Promise<void> {
  if (!r2Configured()) return;
  for (const doc of ["plan", "bonus"] as const) { try { await r2Delete(hostedKey(leadId, doc)); } catch { /* idempotent */ } }
}

export type PageLink = { page: number; x: number; y: number; w: number; h: number; url: string };

/**
 * The link areas of a PDF, as fractions of the page (top-left origin), so the
 * web viewer can lay clickable boxes over its canvas pages.
 */
export async function pdfLinks(bytes: Uint8Array): Promise<PageLink[]> {
  const doc = await PDFDocument.load(bytes);
  const out: PageLink[] = [];
  doc.getPages().forEach((page, i) => {
    const { width: W, height: H } = page.getSize();
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const a = annots.lookupMaybe(k, PDFDict);
      const action = a?.lookupMaybe(PDFName.of("A"), PDFDict);
      const uri = action?.lookup(PDFName.of("URI"));
      const rect = a?.lookupMaybe(PDFName.of("Rect"), PDFArray);
      if (!rect || !(uri instanceof PDFString || uri instanceof PDFHexString)) continue;
      const [x0, y0, x1, y1] = rect.asArray().map((n) => Number((n as unknown as { asNumber(): number }).asNumber()));
      const url = uri.decodeText();
      if (!/^https:\/\//.test(url)) continue;
      out.push({ page: i + 1, x: Math.min(x0, x1) / W, y: (H - Math.max(y0, y1)) / H, w: Math.abs(x1 - x0) / W, h: Math.abs(y1 - y0) / H, url });
    }
  });
  return out;
}
