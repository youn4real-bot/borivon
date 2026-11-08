/**
 * Fahrplan emails, in the order they go out (founder, 2026-11-07):
 *   1 · confirmMail   right after the form: ONLY a confirm link, no PDF, no ad
 *   2 · deliveryMail  after the confirm click: the PDF + bonus attached
 *   3 · followupMail  the short tips series that leads to a call
 * Nothing but #1 goes out before the double opt-in (§7 UWG, Art. 6(1)(a) GDPR).
 * Every mail from #2 on carries an unsubscribe link + List-Unsubscribe header.
 *
 * 5th-grade language, no price anywhere (founder rules).
 */
import type { Lang } from "./content";
import { LEVELS, UI, pick } from "./content";
import { STAGES } from "./stages";
import type { RoadmapResult, FacilityType } from "./score";
import { FACILITY } from "./types";
import { formatEuro } from "./pdf";
import { greeting, type Salutation } from "./consent";

export const BOOK_URL = "https://borivon.com/book/clinic";
/** Who the mail is for: Anrede + Nachname (no first name since 2026-11-07). */
export type Addressee = { salutation: Salutation; lastName: string; firstName?: string };

/** Days after the confirm click when each follow-up goes out. */
export const FOLLOWUP_DAYS = [2, 5, 9, 14] as const;

type Mail = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Founder's sign-off with the real "Borivon." logo (public/email-logo.png, the site font as an image).
 *  The card is #fcfaf7 = the logo's own background, so the logo has no visible box. */
export const SIGNER = "Youness Taoufiq";
function signature(lang: Lang): string {
  const role = lang === "de" ? "Gründer, Borivon" : lang === "fr" ? "Fondateur, Borivon" : "Founder, Borivon";
  return `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #ebe6da">
<div style="font-size:15px;line-height:1.5;color:#1c1c1e"><b>${SIGNER}</b><br><span style="color:#6d6a63">${role}</span></div>
<img src="https://borivon.com/email-logo.png" alt="Borivon." width="132" height="42" style="display:block;border:0;outline:none;text-decoration:none;margin:14px 0 8px" />
<div style="font-size:12px;line-height:1.6;color:#8a8a8a">77 Boulevard Mohamed Smiha · 20080 Casablanca, Marokko<br><a href="mailto:contact@borivon.com" style="color:#8a8a8a">contact@borivon.com</a> · <a href="https://borivon.com" style="color:#8a8a8a">borivon.com</a></div>
</div>`;
}
function shell(lang: Lang, bodyHtml: string, footerExtra = ""): string {
  const legal = lang === "de" ? ["Impressum", "Datenschutz"] : lang === "fr" ? ["Mentions légales", "Confidentialité"] : ["Legal notice", "Privacy"];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f4ef;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#1c1c1e">
<div style="max-width:560px;margin:0 auto;background:#fcfaf7;border-radius:16px;padding:32px 28px;border:1px solid #ebe6da">
${bodyHtml}
${signature(lang)}
</div>
<p style="max-width:560px;margin:14px auto 0;font-size:11px;line-height:1.6;color:#8a8a8a;text-align:center"><a href="https://borivon.com/impressum" style="color:#8a8a8a">${legal[0]}</a> · <a href="https://borivon.com/datenschutz" style="color:#8a8a8a">${legal[1]}</a>${footerExtra}</p>
</body></html>`;
}
const p = (s: string) => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${s}</p>`;
const btn = (href: string, label: string) =>
  `<p style="margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:#c9a240;color:#131312;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 26px;border-radius:999px">${esc(label)}</a></p>`;

const unsubLabel = (lang: Lang) =>
  lang === "de" ? "Keine E-Mails mehr? Hier abmelden" : lang === "fr" ? "Plus d'e-mails ? Se désabonner" : "No more emails? Unsubscribe";
const unsubFooter = (lang: Lang, url: string) => ` · <a href="${esc(url)}" style="color:#8a8a8a">${esc(unsubLabel(lang))}</a>`;

/**
 * Mail #1, sent right after the form. Only the confirm link: no PDF, no offer,
 * no P.S. (an ad in the opt-in mail itself would be advertising without consent).
 */
export function confirmMail(o: Addressee & { lang: Lang; facility: string; confirmUrl: string }): Mail {
  const { lang } = o;
  const fac = o.facility ? esc(o.facility) : "";
  const T = {
    de: {
      subject: "Bitte bestätigen: Ihr Pflege-Fahrplan",
      lines: [
        `fast geschafft. Bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick. Danach schicken wir Ihnen sofort Ihren Fahrplan${fac ? ` für ${fac}` : ""} als PDF.`,
      ],
      btn: "Ja, Fahrplan senden",
      notYou: "Sie haben das nicht angefordert? Dann ignorieren Sie diese E-Mail einfach. Wir schreiben Ihnen nicht wieder.",
      bye: "Viele Grüße",
    },
    en: {
      subject: "Please confirm: your nurse staffing roadmap",
      lines: [
        `almost done. Please confirm your email address with one click. Then we send you your roadmap${fac ? ` for ${fac}` : ""} as a PDF right away.`,
      ],
      btn: "Yes, send my roadmap",
      notYou: "You did not ask for this? Then just ignore this email. We will not write to you again.",
      bye: "Best regards",
    },
    fr: {
      subject: "Merci de confirmer : votre plan infirmier",
      lines: [
        `c'est presque fini. Merci de confirmer votre adresse e-mail en un clic. Ensuite, nous vous envoyons tout de suite votre plan${fac ? ` pour ${fac}` : ""} en PDF.`,
      ],
      btn: "Oui, envoyer mon plan",
      notYou: "Vous n'avez rien demandé ? Ignorez simplement cet e-mail. Nous ne vous écrirons plus.",
      bye: "Bien cordialement",
    },
  }[lang];
  const hello = esc(greeting(lang, o.salutation, o.lastName, o.firstName));
  const body = p(hello) + T.lines.map(p).join("") + btn(o.confirmUrl, T.btn) +
    `<p style="font-size:13px;line-height:1.6;margin:0 0 14px;color:#6d6a63">${T.notYou}</p>` + p(T.bye);
  const strip = (x: string) => x.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "");
  const text = [greeting(lang, o.salutation, o.lastName, o.firstName), ...T.lines.map(strip), `${T.btn}: ${o.confirmUrl}`, T.notYou, strip(T.bye)].join("\n\n");
  return { subject: T.subject, html: shell(lang, body), text };
}

/**
 * Mail #2, after the confirm click. Shaped like the founder's reference
 * (acquisition.com roadmap mail): "as promised", what is inside, a short story
 * of their level, then a P.S. that frames the call as "see if you fit", never
 * as a sale. Marketing from here on, so it carries the unsubscribe link.
 */
export function deliveryMail(o: Addressee & { lang: Lang; facility: string; result: RoadmapResult; unsubscribeUrl: string; viewUrl: string; bonusUrl: string; previousUrl?: string }): Mail {
  const { lang, result } = o;
  const prevT = { de: "Ihr früherer Fahrplan bleibt gültig:", en: "Your earlier roadmap stays valid:", fr: "Votre plan précédent reste valable :" }[lang];
  const prevL = { de: "früheren Fahrplan öffnen", en: "open the earlier roadmap", fr: "ouvrir le plan précédent" }[lang];
  const lvl = pick(LEVELS[result.level].name, lang);
  const St = STAGES[result.level];
  const loss = formatEuro(result.totalYear, lang);
  const hello = esc(greeting(lang, o.salutation, o.lastName, o.firstName));
  const fac = o.facility ? esc(o.facility) : "";
  const T = {
    de: {
      subject: `Ihr Pflege-Fahrplan (Stufe ${result.level}: ${lvl})`,
      hello,
      promised: `wie versprochen: Hier ist Ihr persönlicher Pflege-Fahrplan${fac ? ` für ${fac}` : ""}. Er liegt online für Sie bereit, ohne Download.`,
      open: "Fahrplan öffnen", bonusLink: "Bonus öffnen: der Agentur-Check",
      insideH: "Darin finden Sie:",
      inside: [
        "auf welcher der 5 Stufen Sie stehen, und was leere Stellen Sie im Jahr kosten",
        "Ihren Zeitplan: bis wann Sie starten müssen, damit die erste Fachkraft rechtzeitig da ist",
        "Checklisten für die nächste Stufe und den 90-Tage-Plan zum Abhaken",
        "<b>Bonus:</b> den Agentur-Check. 10 Fragen, bevor Sie Pflegekräfte aus dem Ausland holen",
      ],
      level: `Sie sind auf Stufe ${result.level} von 5: ${esc(lvl)}.`,
      loss: result.totalYear > 0 ? `${result.turnoverCostYear > 0 ? "Leere Stellen und Kündigungen kosten" : "Leere Stellen kosten"} Sie etwa <b>${loss} im Jahr</b>.` : "",
      bottom: "Unterm Strich:",
      start: "Fangen Sie bei „Ihr Zeitplan“ an. Dann die Checklisten abhaken.",
      bye: "Viele Grüße",
      ps: "P.S. Sie möchten die Pflegekräfte erst persönlich sehen? Das geht in unserem Workshop in Marokko, 2 Tage, nur 10 Plätze.",
      psLink: "Platz anfragen.",
    },
    en: {
      subject: `Your nurse staffing roadmap (level ${result.level}: ${lvl})`,
      hello,
      promised: `as promised: here is your personal roadmap${fac ? ` for ${fac}` : ""}. It is ready for you online, no download needed.`,
      open: "Open my roadmap", bonusLink: "Open the bonus: the agency check",
      insideH: "Inside you will find:",
      inside: [
        "which of the 5 levels you are on, and what empty posts cost you a year",
        "your timeline: when to start so the first nurse arrives in time",
        "checklists for the next level and the 90-day plan to tick off",
        "<b>Bonus:</b> the agency check. 10 questions before you bring nurses from abroad",
      ],
      level: `You are on level ${result.level} of 5: ${esc(lvl)}.`,
      loss: result.totalYear > 0 ? `${result.turnoverCostYear > 0 ? "Empty posts and resignations cost" : "Empty posts cost"} you about <b>${loss} a year</b>.` : "",
      bottom: "Bottom line:",
      start: "Start with “Your timeline”. Then tick off the checklists.",
      bye: "Best regards",
      ps: "P.S. Want to see the nurses in person first? You can, at our workshop in Morocco: 2 days, only 10 seats.",
      psLink: "Request a seat.",
    },
    fr: {
      subject: `Votre plan infirmier (niveau ${result.level} : ${lvl})`,
      hello,
      promised: `comme promis : voici votre plan personnel${fac ? ` pour ${fac}` : ""}. Il vous attend en ligne, sans téléchargement.`,
      open: "Ouvrir mon plan", bonusLink: "Ouvrir le bonus : le check agence",
      insideH: "Vous y trouverez :",
      inside: [
        "à quel niveau sur 5 vous êtes, et ce que les postes vides vous coûtent par an",
        "votre calendrier : quand commencer pour que la première infirmière arrive à temps",
        "des listes pour le niveau suivant et le plan de 90 jours à cocher",
        "<b>Bonus :</b> le check agence. 10 questions avant de faire venir des infirmières de l'étranger",
      ],
      level: `Vous êtes au niveau ${result.level} sur 5 : ${esc(lvl)}.`,
      loss: result.totalYear > 0 ? `${result.turnoverCostYear > 0 ? "Les postes vides et les départs vous coûtent" : "Les postes vides vous coûtent"} environ <b>${loss} par an</b>.` : "",
      bottom: "En résumé :",
      start: "Commencez par « Votre calendrier ». Puis cochez les listes.",
      bye: "Bien cordialement",
      ps: "P.S. Vous voulez d'abord voir les infirmières en personne ? C'est possible à notre atelier au Maroc : 2 jours, seulement 10 places.",
      psLink: "Demander une place.",
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
  const body = card + p(T.hello) + p(T.promised) + btn(o.viewUrl, T.open) + p(`<b>${T.insideH}</b>`) + list +
    p(`<a href="${esc(o.bonusUrl)}" style="color:#9c7a27;font-weight:bold">${esc(T.bonusLink)} →</a>`) +
    (o.previousUrl ? p(`${esc(prevT)} <a href="${esc(o.previousUrl)}" style="color:#9c7a27">${esc(prevL)}</a>`) : "") +
    p(`<b>${T.level}</b> ${esc(story)}`) +
    p(`${T.loss ? T.loss + " " : ""}${T.bottom} <b>${esc(bottom)}</b>`) + p(T.start) +
    p(T.bye) +
    `<p style="font-size:14px;line-height:1.6;margin:22px 0 0;padding-top:16px;border-top:1px solid #ebe6da;color:#4a4a4a">${T.ps} <a href="${BOOK_URL}" style="color:#9c7a27;font-weight:bold">${T.psLink}</a></p>`;
  const strip = (x: string) => x.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "");
  const text = [
    strip(T.hello), strip(T.promised), `${T.open}: ${o.viewUrl}`,
    T.insideH + "\n" + T.inside.map((x) => "- " + strip(x)).join("\n"),
    `${T.bonusLink}: ${o.bonusUrl}`,
    o.previousUrl ? `${prevT} ${o.previousUrl}` : "",
    `${T.level} ${story}`,
    `${T.loss ? strip(T.loss) + " " : ""}${T.bottom} ${bottom}`,
    T.start,
    strip(T.bye),
    `${T.ps} ${T.psLink} ${BOOK_URL}`,
    `${unsubLabel(lang)}: ${o.unsubscribeUrl}`,
  ].filter(Boolean).join("\n\n");
  return { subject: T.subject, html: shell(lang, body, unsubFooter(lang, o.unsubscribeUrl)), text };
}

/** Follow-up #n (0-based), sent FOLLOWUP_DAYS[n] days after the confirm click. */
export function followupMail(n: number, o: Addressee & { lang: Lang; result: RoadmapResult; unsubscribeUrl: string; facilityType?: FacilityType }): Mail | null {
  const { lang } = o;
  const firstWeek = esc(pick(FACILITY[o.facilityType ?? "care_home"].firstWeek, lang));
  const hello = esc(greeting(lang, o.salutation, o.lastName, o.firstName));
  const per = formatEuro(o.result.perNurseMonth, lang);
  const three = formatEuro(o.result.perNurseMonth * 3, lang);
  const S: Record<Lang, { subject: string; lines: string[]; cta: string }[]> = {
    de: [
      { subject: "Der teuerste Fehler bei Pflegekräften aus dem Ausland", lines: [
        hello,
        "der teuerste Fehler ist nicht ein zu hoher Preis. Es ist die Pflegekraft, die in der Probezeit wieder geht. Dann zahlen Sie alles doppelt: die Suche, die Einarbeitung, die leere Stelle.",
        "Stellen Sie jeder Vermittlung drei Fragen: <b>1.</b> Wer prüft ihr Deutsch, und wie? <b>2.</b> Wer macht Anerkennung und Visum? <b>3.</b> Was passiert, wenn sie in der Probezeit geht?",
        "Wenn die Antworten unklar sind: Finger weg. Alle 10 Fragen stehen im Agentur-Check aus unserer ersten E-Mail.",
      ], cta: "Prüfen, ob meine Einrichtung passt" },
      { subject: "Die erste Woche entscheidet", lines: [
        hello,
        "ob eine Pflegekraft bleibt, entscheidet sich oft in der ersten Woche. Drei Dinge machen den Unterschied:",
        "<b>1.</b> Jemand holt sie ab. <b>2.</b> Die Wohnung ist fertig, bevor sie kommt. <b>3.</b> Jeden Tag 10 Minuten: Wie war es heute?",
        firstWeek,
        "Den ganzen 90-Tage-Plan finden Sie in Ihrem Fahrplan.",
      ], cta: "Fragen? Kurz sprechen" },
      { subject: "So rechnet sich eine Pflegekraft, die bleibt", lines: [
        hello,
        `eine Pflegekraft, die bleibt, bringt Ihnen etwa <b>${per} pro Monat</b>. So viel kostet Sie eine leere Stelle heute.`,
        `Bei drei Pflegekräften sind das etwa <b>${three} pro Monat</b>. Jeder Monat, den Sie warten, ist Geld, das nicht zurückkommt.`,
        "In 15 Minuten rechnen wir Ihre echten Zahlen aus. Kostenlos.",
      ], cta: "Meine Zahlen ausrechnen" },
      { subject: "Lernen Sie Ihre Pflegekräfte persönlich kennen", lines: [
        hello,
        "Sie haben jetzt Ihren Fahrplan. Viele wollen den nächsten Schritt nicht allein gehen, sondern die Pflegekräfte erst einmal selbst sehen.",
        "Dafür gibt es unseren <b>Workshop in Marokko</b>: 2 Tage mit mir. Wir setzen Ihren Fahrplan gemeinsam um, und Sie lernen die Pflegekräfte persönlich kennen. Sie fahren mit einem fertigen Plan nach Hause.",
        "<b>3.000 € pro Platz.</b> Bringen Sie gern Kolleginnen oder Kollegen mit. Es gibt nur 10 Plätze pro Termin.",
      ], cta: "Platz anfragen" },
    ],
    en: [
      { subject: "The most expensive mistake with nurses from abroad", lines: [
        hello,
        "the most expensive mistake is not a high price. It is the nurse who leaves during probation. Then you pay for everything twice: the search, the onboarding, the empty post.",
        "Ask every agency three questions: <b>1.</b> Who checks her German, and how? <b>2.</b> Who does recognition and the visa? <b>3.</b> What happens if she leaves during probation?",
        "If the answers are unclear: walk away. All 10 questions are in the agency check from our first email.",
      ], cta: "Check if we are a fit" },
      { subject: "The first week decides", lines: [
        hello,
        "whether a nurse stays is often decided in the first week. Three things make the difference:",
        "<b>1.</b> Someone picks her up. <b>2.</b> The flat is ready before she arrives. <b>3.</b> 10 minutes every day: how was today?",
        firstWeek,
        "The full 90-day plan is in your roadmap.",
      ], cta: "Questions? Let's talk" },
      { subject: "What a nurse who stays is worth", lines: [
        hello,
        `a nurse who stays brings you about <b>${per} a month</b>. That is what one empty post costs you today.`,
        `With three nurses that is about <b>${three} a month</b>. Every month you wait is money that never comes back.`,
        "In 15 minutes we work out your real numbers. For free.",
      ], cta: "Work out my numbers" },
      { subject: "Meet your nurses in person", lines: [
        hello,
        "you have your roadmap now. Many don't want to take the next step alone, but to see the nurses for themselves first.",
        "That is what our <b>workshop in Morocco</b> is for: 2 days with me. We put your roadmap into action together, and you meet the nurses in person. You go home with a finished plan.",
        "<b>€3,000 per seat.</b> Feel free to bring colleagues. There are only 10 seats per date.",
      ], cta: "Request a seat" },
    ],
    fr: [
      { subject: "L'erreur la plus chère avec les infirmières de l'étranger", lines: [
        hello,
        "l'erreur la plus chère n'est pas un prix trop élevé. C'est l'infirmière qui part pendant la période d'essai. Vous payez alors tout deux fois : la recherche, l'intégration, le poste vide.",
        "Posez trois questions à chaque agence : <b>1.</b> Qui vérifie son allemand, et comment ? <b>2.</b> Qui gère la reconnaissance et le visa ? <b>3.</b> Que se passe-t-il si elle part pendant l'essai ?",
        "Si les réponses sont floues : passez votre chemin. Les 10 questions sont dans le check agence de notre premier e-mail.",
      ], cta: "Vérifier si nous correspondons" },
      { subject: "La première semaine décide", lines: [
        hello,
        "qu'une infirmière reste se décide souvent la première semaine. Trois choses font la différence :",
        "<b>1.</b> Quelqu'un vient la chercher. <b>2.</b> Le logement est prêt avant son arrivée. <b>3.</b> 10 minutes chaque jour : comment ça s'est passé ?",
        firstWeek,
        "Le plan complet de 90 jours est dans votre plan.",
      ], cta: "Des questions ? Parlons-en" },
      { subject: "Ce que vaut une infirmière qui reste", lines: [
        hello,
        `une infirmière qui reste vous rapporte environ <b>${per} par mois</b>. C'est ce que vous coûte un poste vide aujourd'hui.`,
        `Avec trois infirmières, c'est environ <b>${three} par mois</b>. Chaque mois d'attente est de l'argent perdu.`,
        "En 15 minutes, nous calculons vos vrais chiffres. Gratuitement.",
      ], cta: "Calculer mes chiffres" },
      { subject: "Rencontrez vos infirmières en personne", lines: [
        hello,
        "vous avez maintenant votre plan. Beaucoup ne veulent pas faire la prochaine étape seuls, mais d'abord voir les infirmières eux-mêmes.",
        "C'est le but de notre <b>atelier au Maroc</b> : 2 jours avec moi. Nous mettons votre plan en œuvre ensemble, et vous rencontrez les infirmières en personne. Vous repartez avec un plan prêt.",
        "<b>3 000 € par place.</b> Venez avec des collègues si vous voulez. Seulement 10 places par date.",
      ], cta: "Demander une place" },
    ],
  };
  const m = S[lang][n];
  if (!m) return null;
  const html = shell(lang, m.lines.map(p).join("") + btn(BOOK_URL, m.cta), unsubFooter(lang, o.unsubscribeUrl));
  const text = [...m.lines.map((l) => l.replace(/<[^>]+>/g, "")), `${m.cta}: ${BOOK_URL}`, `${unsubLabel(lang)}: ${o.unsubscribeUrl}`].join("\n\n");
  return { subject: m.subject, html, text };
}
