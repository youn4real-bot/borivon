/**
 * The bonus that travels with the Fahrplan (founder, 2026-10-27: like the
 * acquisition.com roadmap, give something extra right after they submit).
 * "Der Agentur-Check": 10 questions to ask ANY agency before bringing nurses
 * from abroad, and what a good answer sounds like. It positions Borivon as the
 * adviser, not a vendor. It is a value asset: the only next step it names is the
 * workshop, softly (founder 2026-11-09: no calls, the workshop is the one paid step).
 *
 * Same look as lib/roadmap/pdf.ts (borivon.com since 2026-11-09: warm paper, EB Garamond
 * headings drawn as outlines, Inter text, hairlines). 2 A4 pages. 5th-grade words.
 * No claims about Borivon, no statistics: only questions and what good looks like.
 */
import { PDFDocument, PageSizes, PDFName, PDFString, type PDFPage, type RGB } from "pdf-lib";
import { embedFonts, hexColor, Surface, wrapText, measure, type DocFont } from "@/lib/pdflib/render";
import { pick, type L, type Lang } from "./content";
import { loadVectorFont, wrapVector, type VectorFont } from "./vectorFont";

// borivon.com tokens (content/pflege/bv.css)
const NIGHT = hexColor("#12110e");
const FG = hexColor("#f4efe4");
const MUTED_NIGHT = hexColor("#a59e90");
const GOLD = hexColor("#a8843a");
const GOLD_D = hexColor("#7a5c20");
const GOLD_L = hexColor("#d4b676");
const PAPER = hexColor("#f4f1ea");
const LINE = hexColor("#ddd6c8");
const INK = hexColor("#15130f");
const MUTED = hexColor("#6b6458");
const GAIN = hexColor("#46684b");
const WORKSHOP_URL = "https://borivon.com/workshop?via=pdf";

export const AGENCY_CHECK: { q: L; a: L }[] = [
  { q: { de: "Wie prüfen Sie das Deutsch?", en: "How do you check their German?", fr: "Comment vérifiez-vous l'allemand ?" },
    a: { de: "Mit einem eigenen Test und einem Gespräch. Ein Zertifikat allein reicht nicht.", en: "With their own test and a conversation. A certificate alone is not enough.", fr: "Avec leur propre test et un entretien. Un certificat seul ne suffit pas." } },
  { q: { de: "Wer kümmert sich um Anerkennung und Visum?", en: "Who handles recognition and the visa?", fr: "Qui gère la reconnaissance et le visa ?" },
    a: { de: "Eine feste Person. Mit einem Plan, wer was bis wann macht.", en: "One fixed person. With a plan of who does what by when.", fr: "Une personne fixe. Avec un plan : qui fait quoi, et quand." } },
  { q: { de: "Wann ist der erste Arbeitstag?", en: "When is the first day at work?", fr: "Quand est le premier jour de travail ?" },
    a: { de: "Ein ehrlicher Zeitplan, mit einem Datum für jeden Schritt.", en: "An honest timeline, with a date for every step.", fr: "Un calendrier honnête, avec une date pour chaque étape." } },
  { q: { de: "Was passiert, wenn sie in der Probezeit geht?", en: "What happens if she leaves during probation?", fr: "Que se passe-t-il si elle part pendant l'essai ?" },
    a: { de: "Eine Garantie, schriftlich. Zum Beispiel: Die nächste Pflegekraft kostet nichts.", en: "A guarantee, in writing. For example: the next nurse costs nothing.", fr: "Une garantie, par écrit. Par exemple : l'infirmière suivante ne coûte rien." } },
  { q: { de: "Kann ich sie vorher kennenlernen?", en: "Can I meet her first?", fr: "Puis-je la rencontrer avant ?" },
    a: { de: "Ja. Echte Profile mit Lebenslauf und Zeugnissen. Dann ein Gespräch mit Ihnen.", en: "Yes. Real profiles with CV and certificates. Then a talk with you.", fr: "Oui. De vrais profils avec CV et diplômes. Puis un entretien avec vous." } },
  { q: { de: "Wer kümmert sich um die Wohnung?", en: "Who sorts out the flat?", fr: "Qui s'occupe du logement ?" },
    a: { de: "Die Wohnung ist geklärt, bevor sie ankommt.", en: "The flat is sorted before she arrives.", fr: "Le logement est réglé avant son arrivée." } },
  { q: { de: "Wie wird sie auf Deutschland vorbereitet?", en: "How is she prepared for Germany?", fr: "Comment est-elle préparée à l'Allemagne ?" },
    a: { de: "Nicht nur Sprache. Auch Arbeit, Alltag und Kultur in Deutschland.", en: "Not only language. Also work, daily life and culture in Germany.", fr: "Pas seulement la langue. Aussi le travail, le quotidien et la culture en Allemagne." } },
  { q: { de: "Wer ist nach der Ankunft für sie da?", en: "Who is there for her after she arrives?", fr: "Qui est là pour elle après son arrivée ?" },
    a: { de: "Eine feste Person. Bis die Probezeit geschafft ist.", en: "One fixed person. Until probation is passed.", fr: "Une personne fixe. Jusqu'à la fin de la période d'essai." } },
  { q: { de: "Wie viele Ihrer Pflegekräfte sind nach einem Jahr noch da?", en: "How many of your nurses are still there after a year?", fr: "Combien de vos infirmières sont encore là après un an ?" },
    a: { de: "Eine ehrliche Zahl. Wer sie nicht kennt, misst nicht.", en: "An honest number. If they don't know it, they don't measure.", fr: "Un chiffre honnête. Qui ne le connaît pas ne mesure pas." } },
  { q: { de: "Was genau muss ich selbst tun?", en: "What exactly do I have to do myself?", fr: "Que dois-je faire moi-même, exactement ?" },
    a: { de: "Wenig, und klar beschrieben. Zum Beispiel: ein Gespräch führen und eine Ansprechperson bestimmen.", en: "Little, and clearly described. For example: one interview and choosing a mentor.", fr: "Peu de choses, clairement décrites. Par exemple : un entretien et choisir une marraine." } },
];

const T: Record<Lang, Record<string, string>> = {
  de: { eyebrow: "Bonus · zu Ihrem Fahrplan", title: "Der Agentur-Check", sub: "10 Fragen, bevor Sie Pflegekräfte aus dem Ausland holen. Und woran Sie eine gute Antwort erkennen.", good: "Gute Antwort", ctaH: "Der nächste Schritt: der Workshop in Casablanca.", ctaP: "Zwei Tage an Ihrem Plan, mit Youness Taoufiq. Am zweiten Tag lernen Sie die Pflegekräfte kennen, die zu Ihrem Plan passen.", btn: "Mehr zum Workshop", page: "Seite" },
  en: { eyebrow: "Bonus · with your roadmap", title: "The agency check", sub: "10 questions to ask before you bring nurses from abroad. And how to spot a good answer.", good: "Good answer", ctaH: "The next step: the workshop in Casablanca.", ctaP: "Two days on your plan, with Youness Taoufiq. On day two you meet the nurses who fit your plan.", btn: "More about the workshop", page: "Page" },
  fr: { eyebrow: "Bonus · avec votre plan", title: "Le check agence", sub: "10 questions à poser avant de faire venir des infirmières de l'étranger. Et comment reconnaître une bonne réponse.", good: "Bonne réponse", ctaH: "La prochaine étape : le workshop à Casablanca.", ctaP: "Deux jours sur votre plan, avec Youness Taoufiq. Le deuxième jour, vous rencontrez les infirmières qui correspondent à votre plan.", btn: "En savoir plus sur le workshop", page: "Page" },
};

export async function renderAgencyCheckPdf(lang: Lang): Promise<Uint8Array> {
  const t = T[lang];
  const doc = await PDFDocument.create();
  doc.setTitle(`${t.title} · Borivon`);
  doc.setAuthor("Borivon");
  doc.setCreator("borivon.com");
  const f = await embedFonts(doc, ["Inter-Regular-pdf.ttf", "Inter-Medium-pdf.ttf", "Inter-SemiBold-pdf.ttf"]);
  const reg: DocFont = f["Inter-Regular-pdf.ttf"], med: DocFont = f["Inter-Medium-pdf.ttf"], semi: DocFont = f["Inter-SemiBold-pdf.ttf"];
  const [H, HI] = await Promise.all([loadVectorFont("fonts/EBGaramond-Medium-pdf.ttf"), loadVectorFont("fonts/EBGaramond-Italic-pdf.ttf")]);
  const [PW, PH] = PageSizes.A4;
  const M = 60, W = PW - 2 * M;
  let pageNo = 0;

  const para = (s: Surface, text: string, x: number, y: number, w: number, font: DocFont, size: number, color: RGB, lh = 1.55) => {
    for (const ln of wrapText(text, font, size, w)) { s.text(ln, x, y, font, size, color); y += size * lh; }
    return y;
  };
  const disp = (page: PDFPage, vf: VectorFont, text: string, x: number, y: number, w: number, size: number, color: RGB, lh = 1.12) => {
    for (const ln of wrapVector(text, vf, size, w, -0.02 * size)) { vf.draw(page, PH, ln, x, y, size, color, -0.02 * size); y += size * lh; }
    return y;
  };
  const newPage = (dark = false) => {
    const page = doc.addPage([PW, PH]);
    pageNo++;
    const s = new Surface(page, PH);
    s.rect(0, 0, PW, PH, dark ? NIGHT : PAPER);
    HI.draw(page, PH, "Borivon", M, 30, 17, dark ? FG : INK);
    H.draw(page, PH, ".", M + HI.measure("Borivon", 17), 30, 17, GOLD);
    s.hline(M, PW - M, PH - 54, LINE, 0.8);
    const pn = String(pageNo).padStart(2, "0");
    s.text(pn, PW - M - measure(pn, med, 8.5, 0.6), PH - 42, med, 8.5, MUTED, 0.6);
    s.text("borivon.com", M, PH - 42, reg, 8.5, MUTED);
    return { page, s };
  };
  const question = (page: PDFPage, s: Surface, i: number, y: number) => {
    const item = AGENCY_CHECK[i];
    const n = String(i + 1);
    H.draw(page, PH, n.padStart(2, "0"), M, y + 1, 20, GOLD_D, -0.2);
    y = disp(page, H, pick(item.q, lang), M + 50, y + 2, W - 50, 18.5, INK, 1.16) + 6;
    s.roundedRect(M + 50, y + 2.2, 5, 5, 2.5, { fill: GAIN });
    s.text(t.good.toUpperCase(), M + 61, y, med, 7, GAIN, 1.1);
    y = para(s, pick(item.a, lang), M + 50, y + 15, W - 50, reg, 11.3, INK) + 16;
    return y;
  };

  // page 1: title block + questions 1–5
  {
    const { page, s } = newPage();
    s.rect(0, 70, PW, 176, NIGHT);
    s.roundedRect(M, 106 + 2.2, 5, 5, 2.5, { fill: GOLD_L });
    s.text(t.eyebrow.toUpperCase(), M + 12, 106, med, 7.5, GOLD_L, 1.2);
    disp(page, H, t.title, M, 124, W, 42, FG);
    para(s, t.sub, M, 184, W, reg, 12, MUTED_NIGHT, 1.6);
    let y = 270;
    for (let i = 0; i < 5; i++) {
      y = question(page, s, i, y);
      if (i < 4) { s.hline(M + 50, M + W, y - 8, LINE, 0.8); y += 8; }
    }
  }
  // page 2: questions 6–10 + the invitation
  {
    const { page, s } = newPage();
    let y = 96;
    for (let i = 5; i < 10; i++) {
      y = question(page, s, i, y);
      if (i < 9) { s.hline(M + 50, M + W, y - 8, LINE, 0.8); y += 8; }
    }
    y += 14;
    // a soft close on a night card: the workshop, nothing else
    const bh = 38;
    const hEnd = 30 + wrapVector(t.ctaH, H, 21, W - 56, -0.02 * 21).length * 21 * 1.12;
    const textEnd = hEnd + 8 + wrapText(t.ctaP, reg, 11, W - 56).length * 11 * 1.55;
    const ch = textEnd + 20 + bh + 28;
    s.roundedRect(M, y, W, ch, 6, { fill: NIGHT });
    disp(page, H, t.ctaH, M + 28, y + 30, W - 56, 21, FG);
    para(s, t.ctaP, M + 28, y + hEnd + 8, W - 56, reg, 11, MUTED_NIGHT);
    const lw = measure(t.btn, semi, 12), bw = lw + 24 + 16 + 22, by = y + textEnd + 20;
    s.roundedRect(M + 28, by, bw, bh, 3, { fill: PAPER });
    s.text(t.btn, M + 50, by + 13, semi, 12, INK);
    page.drawSvgPath("M 0 0 L 15 0 M 10.5 -4.5 L 15 0 L 10.5 4.5", { x: M + 50 + lw + 12, y: PH - (by + bh / 2), borderColor: GOLD_D, borderWidth: 1.3 });
    const link = doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [M + 28, PH - by - bh, M + 28 + bw, PH - by], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(WORKSHOP_URL) },
    }));
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  }
  return doc.save();
}
