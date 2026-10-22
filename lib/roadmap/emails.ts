/**
 * Fahrplan emails: the delivery mail (PDF attached) and a short follow-up series
 * that leads to a call. The series goes ONLY to people who ticked "send me tips"
 * AND clicked the confirm link in the delivery mail (double opt-in: German law,
 * §7 UWG, and it keeps the sender reputation clean). Every follow-up carries an
 * unsubscribe link and a List-Unsubscribe header.
 *
 * 5th-grade language, no price anywhere (founder rules).
 */
import type { Lang } from "./content";
import { LEVELS, UI, pick } from "./content";
import { STAGES } from "./stages";
import type { RoadmapResult } from "./score";
import { formatEuro } from "./pdf";

export const BOOK_URL = "https://borivon.com/book/clinic";
/** Days after the confirm click when each follow-up goes out. */
export const FOLLOWUP_DAYS = [2, 5, 9, 14] as const;

type Mail = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shell(lang: Lang, bodyHtml: string, footerExtra = ""): string {
  const foot = lang === "de" ? "Borivon · Pflegefachkräfte für Deutschland" : lang === "fr" ? "Borivon · Infirmières pour l'Allemagne" : "Borivon · Nurses for Germany";
  return `<!doctype html><html lang="${lang}"><body style="margin:0;background:#f6f4ef;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#1c1c1e">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px;border:1px solid #ebe6da">
<div style="font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:24px;margin-bottom:22px">Borivon<span style="color:#c9a240;font-style:normal">.</span></div>
${bodyHtml}
</div>
<p style="max-width:560px;margin:14px auto 0;font-size:11px;line-height:1.6;color:#8a8a8a;text-align:center">${foot} · <a href="https://borivon.com" style="color:#8a8a8a">borivon.com</a> · contact@borivon.com${footerExtra}</p>
</body></html>`;
}
const p = (s: string) => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${s}</p>`;
const btn = (href: string, label: string) =>
  `<p style="margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:#c9a240;color:#131312;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 26px;border-radius:999px">${esc(label)}</a></p>`;

/**
 * The delivery mail, shaped like the founder's reference (acquisition.com
 * roadmap mail): "as promised", what is inside, a short story of their level,
 * then a P.S. that frames the call as "see if you fit", never as a sale.
 * `confirmUrl` only when they asked for tips.
 */
export function deliveryMail(o: { lang: Lang; firstName: string; facility: string; result: RoadmapResult; confirmUrl?: string }): Mail {
  const { lang, result } = o;
  const lvl = pick(LEVELS[result.level].name, lang);
  const St = STAGES[result.level];
  const loss = formatEuro(result.totalYear, lang);
  const hi = esc(o.firstName || "");
  const fac = o.facility ? esc(o.facility) : "";
  const T = {
    de: {
      subject: `Ihr Pflege-Fahrplan (Stufe ${result.level}: ${lvl})`,
      hello: `Hallo ${hi},`,
      promised: `wie versprochen: Hier ist Ihr persönlicher Pflege-Fahrplan${fac ? ` für ${fac}` : ""}. Das PDF ist im Anhang.`,
      insideH: "Darin finden Sie:",
      inside: [
        "auf welcher der 5 Stufen Ihr Haus steht, und was Sie das im Jahr kostet",
        "was Sie bremst, Bereich für Bereich",
        "Ihren Plan für die nächste Stufe, mit einer 90-Tage-Liste zum Abhaken",
      ],
      level: `Sie sind auf Stufe ${result.level} von 5: ${esc(lvl)}.`,
      loss: result.totalYear > 0 ? `Leere Stellen und Kündigungen kosten Sie etwa <b>${loss} im Jahr</b>.` : "",
      bottom: "Unterm Strich:",
      start: "Fangen Sie mit Seite 6 an (Ihr Plan). Drucken Sie Seite 7 aus (die 90-Tage-Liste).",
      bye: "Viele Grüße<br>Ihr Borivon-Team",
      confirm: "Sie wollten weitere Tipps per E-Mail. Bitte bestätigen Sie das mit einem Klick:",
      confirmBtn: "Ja, Tipps senden",
      ps: "P.S. Viele Häuser bleiben auf ihrer Stufe hängen, weil zu viel auf einmal brennt. Wir arbeiten pro Runde mit höchstens 10 Häusern.",
      psLink: "Prüfen Sie hier, ob Ihr Haus passt.",
    },
    en: {
      subject: `Your nurse staffing roadmap (level ${result.level}: ${lvl})`,
      hello: `Hello ${hi},`,
      promised: `as promised: here is your personal roadmap${fac ? ` for ${fac}` : ""}. The PDF is attached.`,
      insideH: "Inside you will find:",
      inside: [
        "which of the 5 levels your facility is on, and what that costs you a year",
        "what holds you back, area by area",
        "your plan for the next level, with a 90-day checklist",
      ],
      level: `You are on level ${result.level} of 5: ${esc(lvl)}.`,
      loss: result.totalYear > 0 ? `Empty posts and resignations cost you about <b>${loss} a year</b>.` : "",
      bottom: "Bottom line:",
      start: "Start with page 6 (your plan). Print page 7 (the 90-day checklist).",
      bye: "Best regards<br>The Borivon team",
      confirm: "You asked for more tips by email. Please confirm with one click:",
      confirmBtn: "Yes, send tips",
      ps: "P.S. Many facilities get stuck on their level because too much is on fire at once. We work with at most 10 employers per group.",
      psLink: "See if your facility is a fit.",
    },
    fr: {
      subject: `Votre plan infirmier (niveau ${result.level} : ${lvl})`,
      hello: `Bonjour ${hi},`,
      promised: `comme promis : voici votre plan personnel${fac ? ` pour ${fac}` : ""}. Le PDF est en pièce jointe.`,
      insideH: "Vous y trouverez :",
      inside: [
        "à quel niveau sur 5 se trouve votre établissement, et ce que cela vous coûte par an",
        "ce qui vous freine, domaine par domaine",
        "votre plan pour le niveau suivant, avec une liste de 90 jours à cocher",
      ],
      level: `Vous êtes au niveau ${result.level} sur 5 : ${esc(lvl)}.`,
      loss: result.totalYear > 0 ? `Les postes vides et les départs vous coûtent environ <b>${loss} par an</b>.` : "",
      bottom: "En résumé :",
      start: "Commencez par la page 6 (votre plan). Imprimez la page 7 (la liste de 90 jours).",
      bye: "Bien cordialement<br>L'équipe Borivon",
      confirm: "Vous avez demandé d'autres conseils par e-mail. Merci de confirmer en un clic :",
      confirmBtn: "Oui, envoyer les conseils",
      ps: "P.S. Beaucoup d'établissements restent bloqués à leur niveau, car trop de choses brûlent en même temps. Nous travaillons avec 10 employeurs au maximum par groupe.",
      psLink: "Vérifiez ici si votre établissement correspond.",
    },
  }[lang];
  const story = pick(St.story, lang);
  const bottom = pick(St.bottom, lang);
  const U = UI[lang];
  const segs = [1, 2, 3, 4, 5].map((i) => `<td style="height:5px;line-height:5px;font-size:0;background:${i <= result.level ? "#c9a240" : "#2b2b30"};border-radius:3px">&nbsp;</td>`).join('<td width="6" style="font-size:0">&nbsp;</td>');
  const card = `<div style="background:#0e0e10;border-radius:16px;padding:22px 24px;margin:0 0 24px">` +
    `<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c9a240;font-weight:bold">${esc(U.level)} ${result.level} ${esc(U.of5)}</div>` +
    `<div style="font-family:'Playfair Display',Georgia,serif;font-size:30px;line-height:1.15;color:#eeecea;margin:8px 0 6px">${esc(lvl)}</div>` +
    `<div style="font-size:14px;line-height:1.5;color:#9a978f">${esc(pick(LEVELS[result.level].line, lang))}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-collapse:separate"><tr>${segs}</tr></table></div>`;
  const list = `<ul style="font-size:15px;line-height:1.6;margin:0 0 18px;padding-left:20px">${T.inside.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  const body = card + p(T.hello) + p(T.promised) + p(`<b>${T.insideH}</b>`) + list +
    p(`<b>${T.level}</b> ${esc(story)}`) +
    p(`${T.loss ? T.loss + " " : ""}${T.bottom} <b>${esc(bottom)}</b>`) + p(T.start) +
    (o.confirmUrl ? p(T.confirm) + btn(o.confirmUrl, T.confirmBtn) : "") +
    p(T.bye) +
    `<p style="font-size:14px;line-height:1.6;margin:22px 0 0;padding-top:16px;border-top:1px solid #ebe6da;color:#4a4a4a">${T.ps} <a href="${BOOK_URL}" style="color:#9c7a27;font-weight:bold">${T.psLink}</a></p>`;
  const strip = (x: string) => x.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "");
  const text = [
    strip(T.hello), strip(T.promised),
    T.insideH + "\n" + T.inside.map((x) => "- " + x).join("\n"),
    `${T.level} ${story}`,
    `${T.loss ? strip(T.loss) + " " : ""}${T.bottom} ${bottom}`,
    T.start,
    o.confirmUrl ? `${T.confirm} ${o.confirmUrl}` : "",
    strip(T.bye),
    `${T.ps} ${T.psLink} ${BOOK_URL}`,
  ].filter(Boolean).join("\n\n");
  return { subject: T.subject, html: shell(lang, body), text };
}

/** Follow-up #n (0-based), sent FOLLOWUP_DAYS[n] days after the confirm click. */
export function followupMail(n: number, o: { lang: Lang; firstName: string; result: RoadmapResult; unsubscribeUrl: string }): Mail | null {
  const { lang } = o;
  const hi = esc(o.firstName || "");
  const per = formatEuro(o.result.perNurseMonth, lang);
  const three = formatEuro(o.result.perNurseMonth * 3, lang);
  const S: Record<Lang, { subject: string; lines: string[]; cta: string }[]> = {
    de: [
      { subject: "Der teuerste Fehler bei Pflegekräften aus dem Ausland", lines: [
        `Hallo ${hi},`,
        "der teuerste Fehler ist nicht ein zu hoher Preis. Es ist die Pflegekraft, die in der Probezeit wieder geht. Dann zahlen Sie alles doppelt: Leihkräfte, Einarbeitung, die Suche.",
        "Stellen Sie jeder Vermittlung drei Fragen: <b>1.</b> Wer prüft ihr Deutsch, und wie? <b>2.</b> Wer macht Anerkennung und Visum? <b>3.</b> Was passiert, wenn sie in der Probezeit geht?",
        "Wenn die Antworten unklar sind: Finger weg.",
      ], cta: "Prüfen, ob mein Haus passt" },
      { subject: "Die erste Woche entscheidet", lines: [
        `Hallo ${hi},`,
        "ob eine Pflegekraft bleibt, entscheidet sich oft in der ersten Woche. Drei Dinge machen den Unterschied:",
        "<b>1.</b> Jemand holt sie ab. <b>2.</b> Die Wohnung ist fertig, bevor sie kommt. <b>3.</b> Jeden Tag 10 Minuten: Wie war es heute?",
        "Den ganzen 90-Tage-Plan finden Sie auf Seite 7 Ihres Fahrplans.",
      ], cta: "Fragen? Kurz sprechen" },
      { subject: "So rechnet sich eine Pflegekraft, die bleibt", lines: [
        `Hallo ${hi},`,
        `eine Pflegekraft, die bleibt, bringt Ihnen etwa <b>${per} pro Monat</b>: weniger Leihkräfte, wieder volle Betten.`,
        `Bei drei Pflegekräften sind das etwa <b>${three} pro Monat</b>. Jeder Monat, den Sie warten, ist Geld, das nicht zurückkommt.`,
        "In 15 Minuten rechnen wir Ihre echten Zahlen aus. Kostenlos.",
      ], cta: "Meine Zahlen ausrechnen" },
      { subject: "Passt Ihr Haus in die nächste Runde?", lines: [
        `Hallo ${hi},`,
        "Sie haben jetzt Ihren Fahrplan. Sie können ihn allein umsetzen, oder mit uns: Sie führen ein Interview, wir machen den Rest, bis die Pflegekraft die Probezeit geschafft hat.",
        "Wir nehmen pro Runde höchstens 10 Häuser auf, und nicht jedes Haus passt. In 15 Minuten finden wir es gemeinsam heraus.",
      ], cta: "Prüfen, ob mein Haus passt" },
    ],
    en: [
      { subject: "The most expensive mistake with nurses from abroad", lines: [
        `Hello ${hi},`,
        "the most expensive mistake is not a high price. It is the nurse who leaves during probation. Then you pay for everything twice: agency staff, onboarding, the search.",
        "Ask every agency three questions: <b>1.</b> Who checks her German, and how? <b>2.</b> Who does recognition and the visa? <b>3.</b> What happens if she leaves during probation?",
        "If the answers are unclear: walk away.",
      ], cta: "Check if we are a fit" },
      { subject: "The first week decides", lines: [
        `Hello ${hi},`,
        "whether a nurse stays is often decided in the first week. Three things make the difference:",
        "<b>1.</b> Someone picks her up. <b>2.</b> The flat is ready before she arrives. <b>3.</b> 10 minutes every day: how was today?",
        "The full 90-day plan is on page 7 of your roadmap.",
      ], cta: "Questions? Let's talk" },
      { subject: "What a nurse who stays is worth", lines: [
        `Hello ${hi},`,
        `a nurse who stays brings you about <b>${per} a month</b>: less agency staff, full beds again.`,
        `With three nurses that is about <b>${three} a month</b>. Every month you wait is money that never comes back.`,
        "In 15 minutes we work out your real numbers. For free.",
      ], cta: "Work out my numbers" },
      { subject: "Is your facility a fit for the next group?", lines: [
        `Hello ${hi},`,
        "you have your roadmap now. You can put it into action on your own, or with us: you do one interview, we do the rest, until the nurse has passed probation.",
        "We take at most 10 employers per group, and not every facility is a fit. In 15 minutes we find out together.",
      ], cta: "Check if we are a fit" },
    ],
    fr: [
      { subject: "L'erreur la plus chère avec les infirmières de l'étranger", lines: [
        `Bonjour ${hi},`,
        "l'erreur la plus chère n'est pas un prix trop élevé. C'est l'infirmière qui part pendant la période d'essai. Vous payez alors tout deux fois : intérim, intégration, recherche.",
        "Posez trois questions à chaque agence : <b>1.</b> Qui vérifie son allemand, et comment ? <b>2.</b> Qui gère la reconnaissance et le visa ? <b>3.</b> Que se passe-t-il si elle part pendant l'essai ?",
        "Si les réponses sont floues : passez votre chemin.",
      ], cta: "Vérifier si nous correspondons" },
      { subject: "La première semaine décide", lines: [
        `Bonjour ${hi},`,
        "qu'une infirmière reste se décide souvent la première semaine. Trois choses font la différence :",
        "<b>1.</b> Quelqu'un vient la chercher. <b>2.</b> Le logement est prêt avant son arrivée. <b>3.</b> 10 minutes chaque jour : comment ça s'est passé ?",
        "Le plan complet de 90 jours est à la page 7 de votre plan.",
      ], cta: "Des questions ? Parlons-en" },
      { subject: "Ce que vaut une infirmière qui reste", lines: [
        `Bonjour ${hi},`,
        `une infirmière qui reste vous rapporte environ <b>${per} par mois</b> : moins d'intérim, des lits de nouveau pleins.`,
        `Avec trois infirmières, c'est environ <b>${three} par mois</b>. Chaque mois d'attente est de l'argent perdu.`,
        "En 15 minutes, nous calculons vos vrais chiffres. Gratuitement.",
      ], cta: "Calculer mes chiffres" },
      { subject: "Votre établissement correspond-il au prochain groupe ?", lines: [
        `Bonjour ${hi},`,
        "vous avez maintenant votre plan. Vous pouvez le mettre en œuvre seul, ou avec nous : vous faites un entretien, nous faisons le reste, jusqu'à la fin de la période d'essai.",
        "Nous acceptons au maximum 10 employeurs par groupe, et tous ne correspondent pas. En 15 minutes, nous le découvrons ensemble.",
      ], cta: "Vérifier si nous correspondons" },
    ],
  };
  const m = S[lang][n];
  if (!m) return null;
  const unsub = lang === "de" ? "Keine Tipps mehr? Hier abbestellen" : lang === "fr" ? "Plus de conseils ? Se désabonner" : "No more tips? Unsubscribe";
  const html = shell(lang, m.lines.map(p).join("") + btn(BOOK_URL, m.cta),
    ` · <a href="${esc(o.unsubscribeUrl)}" style="color:#8a8a8a">${esc(unsub)}</a>`);
  const text = [...m.lines.map((l) => l.replace(/<[^>]+>/g, "")), `${m.cta}: ${BOOK_URL}`, `${unsub}: ${o.unsubscribeUrl}`].join("\n\n");
  return { subject: m.subject, html, text };
}
