/**
 * Fahrplan emails, in the order they go out (founder, 2026-11-07):
 *   1 · confirmMail   right after the form: ONLY a confirm link, no PDF, no ad
 *   2 · deliveryMail  after the confirm click: a link to the Fahrplan, shaped like the acquisition.com roadmap mail
 *   3 · followupMail  the short tips series that leads to a call
 * Nothing but #1 goes out before the double opt-in (§7 UWG, Art. 6(1)(a) GDPR).
 * Every mail from #2 on carries an unsubscribe link + List-Unsubscribe header.
 *
 * 5th-grade language, no price anywhere (founder rules).
 */
import type { Lang } from "./content";
import { LEVELS, pick } from "./content";
import type { RoadmapResult, FacilityType, Level } from "./score";
import { FACILITY } from "./types";
import { formatEuro } from "./pdf";
import { greeting, type Salutation } from "./consent";
import { upcomingOpenDates, dateRangeLabel } from "@/lib/workshopDates";

export const BOOK_URL = "https://borivon.com/book/clinic";
/** The workshop in Morocco (content/pflege/workshop.html): the P.S., the last tip mail, the PDF last page. */
// ?via=mail: the founder's analytics credits workshop visits (and bookings) to the mails
export const WORKSHOP_URL = "https://borivon.com/workshop?via=mail";
/** Who the mail is for: Anrede + Nachname (no first name since 2026-11-07). */
export type Addressee = { salutation: Salutation; lastName: string; firstName?: string };

/** Days after the confirm click when each follow-up goes out. */
export const FOLLOWUP_DAYS = [2, 5, 9, 14] as const;

type Mail = { subject: string; html: string; text: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Mail look = the acquisition.com roadmap mail, 1:1 (founder 2026-11-08): plain white, short lines,
 * the link as ">> PFLEGE-FAHRPLAN – STUFE 2 <<", signed "– Youness", a P.S., then centred:
 * logo, company address (as in the Impressum), unsubscribe, a short disclaimer.
 */
export const SIGNER = "Youness";
const LINK = "#9c7a27";
// #fcfaf7 = the logo's own background, so the logo shows without a box
const BYE: Record<Lang, string> = { de: "Viele Grüße,<br>– Youness", en: "Best regards,<br>– Youness", fr: "Bien cordialement,<br>– Youness" };
const SIGNOFF: Record<Lang, string> = { de: "Viel Erfolg,<br>– Youness", en: "Enjoy,<br>– Youness", fr: "Bonne réussite,<br>– Youness" };
const DISCLAIMER: Record<Lang, string> = {
  de: "Diese Nachricht und Ihr Fahrplan dienen nur der Information und sind keine Rechts- oder Unternehmensberatung. Alle Zahlen sind Schätzungen auf Basis Ihrer Angaben. Ergebnisse hängen von vielen Faktoren ab. Wir geben keine Garantie für ein bestimmtes Ergebnis.",
  en: "This message and your roadmap are for information only and are not legal or business advice. All numbers are estimates based on your answers. Results depend on many factors. We make no promise of any specific outcome.",
  fr: "Ce message et votre plan sont fournis à titre d'information uniquement et ne constituent pas un conseil juridique ou professionnel. Tous les chiffres sont des estimations basées sur vos réponses. Les résultats dépendent de nombreux facteurs. Nous ne garantissons aucun résultat précis.",
};
/** The company motto (founder 2026-11-09): word for word, everywhere. Borivon helps facilities; it does not "bring nurses". */
const MOTTO: Record<Lang, string> = {
  de: "Das Unternehmen Borivon hilft Gesundheitseinrichtungen, Pflegekräfte aus dem Ausland zu gewinnen und zu halten, weil gute Pflege kein Luxus sein darf.",
  en: "Borivon helps healthcare facilities win and keep nurses from abroad, because good care must never be a luxury.",
  fr: "Borivon aide les établissements de santé à recruter et à fidéliser des infirmiers venus de l’étranger, car de bons soins ne doivent jamais être un luxe.",
};
function shell(lang: Lang, bodyHtml: string, footerExtra = ""): string {
  const legal = lang === "de" ? ["Impressum", "Datenschutz"] : lang === "fr" ? ["Mentions légales", "Confidentialité"] : ["Legal notice", "Privacy"];
  const muted = "color:#5b6573";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fcfaf7;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#1c1c1e">
<div style="max-width:540px;margin:0 auto">
${bodyHtml}
<div style="margin-top:56px;text-align:center">
<img src="https://borivon.com/email-logo.png" alt="Borivon." width="170" height="55" style="display:inline-block;border:0;outline:none;text-decoration:none" />
<p style="font-size:13px;line-height:1.6;margin:14px auto 0;max-width:440px;color:#1c1c1e">${MOTTO[lang]}</p>
<p style="font-size:12px;line-height:1.6;margin:14px 0 0;${muted}">Borivon LLC, 30 N Gould St Ste R,<br>Sheridan, WY 82801, USA</p>
<p style="font-size:12px;line-height:1.6;margin:12px 0 0;${muted}"><a href="https://borivon.com/impressum" style="${muted}">${legal[0]}</a> · <a href="https://borivon.com/datenschutz" style="${muted}">${legal[1]}</a>${footerExtra}</p>
<p style="font-size:11px;line-height:1.6;margin:16px auto 0;max-width:460px;${muted}">${DISCLAIMER[lang]}</p>
</div>
</div>
</body></html>`;
}
const p = (s: string) => `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">${s}</p>`;
/** The link, the way acquisition.com does it: >> LABEL << */
const btn = (href: string, label: string) =>
  `<p style="margin:20px 0;font-size:15px;font-weight:bold">&gt;&gt; <a href="${esc(href)}" style="color:${LINK};text-decoration:underline">${esc(label)}</a> &lt;&lt;</p>`;
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
        `fast geschafft. Bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick. Danach öffnet sich Ihr Fahrplan${fac ? ` für ${fac}` : ""} sofort. Eine Kopie schicken wir Ihnen zusätzlich per E-Mail.`,
      ],
      btn: "Fahrplan jetzt öffnen",
      notYou: "Sie haben das nicht angefordert? Dann ignorieren Sie diese E-Mail einfach. Wir schreiben Ihnen nicht wieder.",
      bye: BYE.de,
    },
    en: {
      subject: "Please confirm: your nurse staffing roadmap",
      lines: [
        `almost done. Please confirm your email address with one click. Then your roadmap${fac ? ` for ${fac}` : ""} opens right away. We also send a copy to your inbox.`,
      ],
      btn: "Open my roadmap now",
      notYou: "You did not ask for this? Then just ignore this email. We will not write to you again.",
      bye: BYE.en,
    },
    fr: {
      subject: "Merci de confirmer : votre plan infirmier",
      lines: [
        `c'est presque fini. Merci de confirmer votre adresse e-mail en un clic. Ensuite, votre plan${fac ? ` pour ${fac}` : ""} s'ouvre tout de suite. Nous vous en envoyons aussi une copie par e-mail.`,
      ],
      btn: "Ouvrir mon plan",
      notYou: "Vous n'avez rien demandé ? Ignorez simplement cet e-mail. Nous ne vous écrirons plus.",
      bye: BYE.fr,
    },
  }[lang];
  const hello = esc(greeting(lang, o.salutation, o.lastName, o.firstName));
  const body = p(hello) + T.lines.map(p).join("") + btn(o.confirmUrl, T.btn) +
    `<p style="font-size:13px;line-height:1.6;margin:0 0 14px;color:#6d6a63">${T.notYou}</p>` + p(T.bye);
  const strip = (x: string) => x.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "");
  const text = [greeting(lang, o.salutation, o.lastName, o.firstName), ...T.lines.map(strip), `${T.btn}: ${o.confirmUrl}`, T.notYou, strip(T.bye)].join("\n\n");
  return { subject: T.subject, html: shell(lang, body), text };
}

/** What each level is, said the acquisition.com way: when · your role · the main problem · why the name · how it feels. */
const LEVEL_MAIL: Record<Level, Record<Lang, { when: string; role: string; problem: string; why: string; feel: string }>> = {
  1: {
    de: { when: "Stufe 1 ist, wenn jeden Tag Leute fehlen und Sie nur noch den Dienstplan retten.", role: "Ihre Rolle ist die Feuerwehr: Sie löschen jeden Tag einen neuen Brand.", problem: "Es fehlen zu viele Leute auf einmal.", why: "Darum heißt sie die Stufe „Retten“.", feel: "Alles ist dringend. Sie müssen erst einmal Ruhe hineinbringen." },
    en: { when: "Level 1 is when people are missing every day and you are just saving the rota.", role: "Your role is the fire brigade: every day you put out a new fire.", problem: "Too many people are missing at once.", why: "That's why it's called the “Rescue” level.", feel: "Everything is urgent. First you need to bring calm in." },
    fr: { when: "Le niveau 1, c'est quand il manque du monde chaque jour et que vous sauvez juste le planning.", role: "Votre rôle, ce sont les pompiers : chaque jour, un nouvel incendie.", problem: "Il manque trop de monde en même temps.", why: "C'est pour ça qu'on l'appelle le niveau « Sauver ».", feel: "Tout est urgent. Il faut d'abord ramener le calme." },
  },
  2: {
    de: { when: "Stufe 2 ist, wenn der Betrieb läuft, aber Sie jede Stelle einzeln besetzen.", role: "Ihre Rolle ändert sich von „Retter“ zu „Füller“: Sie holen Leute, eine nach der anderen.", problem: "Jede Stelle ist ein neuer Kraftakt.", why: "Darum heißt sie die Stufe „Füllen“.", feel: "Es läuft, aber es kostet zu viel Kraft. Sie brauchen einen festen Ablauf." },
    en: { when: "Level 2 is when things run, but you fill every post one at a time.", role: "Your role changes from “rescuer” to “filler”: you bring people in, one after another.", problem: "Every post is a new struggle.", why: "That's why it's called the “Fill” level.", feel: "It works, but it takes too much effort. You need a fixed process." },
    fr: { when: "Le niveau 2, c'est quand tout tourne, mais que vous pourvoyez chaque poste un par un.", role: "Votre rôle passe de « sauveur » à « remplisseur » : vous faites venir les gens, un par un.", problem: "Chaque poste est un nouvel effort.", why: "C'est pour ça qu'on l'appelle le niveau « Remplir ».", feel: "Ça marche, mais ça coûte trop d'énergie. Il vous faut un processus fixe." },
  },
  3: {
    de: { when: "Stufe 3 ist, wenn fast alles besetzt ist, aber Leute wieder gehen.", role: "Ihre Rolle ändert sich von „Füller“ zu „Halter“: Jetzt geht es darum, dass die Neuen bleiben.", problem: "Jede Kündigung wirft Sie zurück.", why: "Darum heißt sie die Stufe „Halten“.", feel: "Es ist ruhiger, aber wackelig. Sie müssen dafür sorgen, dass Leute bleiben." },
    en: { when: "Level 3 is when almost everything is filled, but people leave again.", role: "Your role changes from “filler” to “keeper”: now it's about making new nurses stay.", problem: "Every resignation sets you back.", why: "That's why it's called the “Keep” level.", feel: "It's calmer, but shaky. You need to make sure people stay." },
    fr: { when: "Le niveau 3, c'est quand presque tout est pourvu, mais que des gens repartent.", role: "Votre rôle passe de « remplisseur » à « gardien » : il s'agit maintenant que les nouvelles restent.", problem: "Chaque départ vous fait reculer.", why: "C'est pour ça qu'on l'appelle le niveau « Garder ».", feel: "C'est plus calme, mais fragile. Il faut faire en sorte que les gens restent." },
  },
  4: {
    de: { when: "Stufe 4 ist, wenn Ihre Leute bleiben und Sie früh wissen, wer kommt.", role: "Ihre Rolle ändert sich von „Halter“ zu „Planer“: Sie denken 12 Monate voraus.", problem: "Sie planen erst ein paar Monate voraus.", why: "Darum heißt sie die Stufe „Planen“.", feel: "Es läuft gut. Jetzt geht es um Wachstum mit Plan." },
    en: { when: "Level 4 is when your people stay and you know early who is coming.", role: "Your role changes from “keeper” to “planner”: you think 12 months ahead.", problem: "You only plan a few months ahead.", why: "That's why it's called the “Plan” level.", feel: "It's going well. Now it's about growing with a plan." },
    fr: { when: "Le niveau 4, c'est quand vos équipes restent et que vous savez tôt qui arrive.", role: "Votre rôle passe de « gardien » à « planificateur » : vous pensez 12 mois à l'avance.", problem: "Vous ne planifiez que quelques mois.", why: "C'est pour ça qu'on l'appelle le niveau « Planifier ».", feel: "Tout va bien. Il s'agit maintenant de grandir avec un plan." },
  },
  5: {
    de: { when: "Stufe 5 ist, wenn Pflegekräfte von selbst zu Ihnen kommen.", role: "Ihre Rolle ändert sich von „Planer“ zu „Magnet“: Ihr guter Ruf holt die Leute.", problem: "Oben bleiben ist schwerer als hinkommen.", why: "Darum heißt sie die Stufe „Anziehen“.", feel: "Sie sind da, wo viele hinwollen. Jetzt heißt es: dranbleiben." },
    en: { when: "Level 5 is when nurses come to you by themselves.", role: "Your role changes from “planner” to “magnet”: your good name brings people in.", problem: "Staying on top is harder than getting there.", why: "That's why it's called the “Attract” level.", feel: "You are where many want to be. Now: keep at it." },
    fr: { when: "Le niveau 5, c'est quand les infirmières viennent d'elles-mêmes.", role: "Votre rôle passe de « planificateur » à « aimant » : votre réputation attire les gens.", problem: "Rester au sommet est plus dur que d'y arriver.", why: "C'est pour ça qu'on l'appelle le niveau « Attirer ».", feel: "Vous êtes là où beaucoup veulent être. Maintenant : persévérer." },
  },
};

/**
 * Mail #2, after the confirm click: built exactly like the acquisition.com roadmap mail.
 * Marketing from here on, so it carries the unsubscribe link. The P.S. is the soft workshop offer.
 */
export function deliveryMail(o: Addressee & { lang: Lang; facility: string; result: RoadmapResult; unsubscribeUrl: string; viewUrl: string; bonusUrl: string; previousUrl?: string }): Mail {
  const { lang, result } = o;
  const n = result.level;
  const next = Math.min(5, n + 1);
  const lvl = pick(LEVELS[n].name, lang);
  const L = LEVEL_MAIL[n][lang];
  const hello = esc(greeting(lang, o.salutation, o.lastName, o.firstName));
  const T = {
    de: {
      subject: `Ihr Pflege-Fahrplan (Stufe ${n}: ${lvl})`,
      promised: "wie versprochen, hier ist Ihr Pflege-Fahrplan:", tap: "Tippen Sie hier für Ihr PDF:",
      link: `PFLEGE-FAHRPLAN – STUFE ${n}`, insideH: "Darin finden Sie:",
      inside: [`Was Stufe ${n} genau ist und was Sie gerade bremst`, "Was Sie dagegen tun können, mit Checklisten zum Abhaken", n < 5 ? `Was es braucht, um auf Stufe ${next} zu kommen` : "Was es braucht, um oben zu bleiben"],
      note: "<b>Hinweis</b>: Im Fahrplan finden Sie auch Ihren Zeitplan, einen Rechner für Ihre eigenen Zahlen und als Bonus den Agentur-Check. Und weil Sie den ersten Schritt gemacht haben, wartet auf der letzten Seite eine Belohnung für Sie.",
      next: "Der Fahrplan zeigt Ihnen, was Sie als Nächstes tun.",
      ps: `P.S. Viele Einrichtungen bleiben auf Stufe ${n} hängen. Zu viel kommt auf einmal, und es ist schwer zu wissen, wo man anfängt.`,
      ps2: "In unserem Workshop in Casablanca bauen wir in 2 Tagen Ihren Plan: was Sie zuerst lösen und in welcher Reihenfolge. Am zweiten Tag lernen Sie die Pflegekräfte dafür persönlich kennen.",
      psLink: "Prüfen Sie hier, ob Sie dabei sein können.",
      prev: "Ihr früherer Fahrplan bleibt gültig:", prevLink: "früheren Fahrplan öffnen",
    },
    en: {
      subject: `Your nurse staffing roadmap (level ${n}: ${lvl})`,
      promised: "as promised, here is your roadmap:", tap: "Tap below for your PDF:",
      link: `NURSE ROADMAP – LEVEL ${n}`, insideH: "Inside you'll find:",
      inside: [`Exactly what level ${n} is and what is holding you back`, "What to do about it, with checklists to tick off", n < 5 ? `And what it takes to reach level ${next}` : "And what it takes to stay on top"],
      note: "<b>Note</b>: the roadmap also has your timeline, a calculator for your own numbers and, as a bonus, the agency check. And on the last page, a thank-you is waiting for you.",
      next: "The roadmap shows you what to do next.",
      ps: `P.S. Many facilities get stuck at level ${n}. Too much hits at once, and it's hard to know where to start.`,
      ps2: "At our workshop in Casablanca, Morocco, we build your plan in 2 days: what to fix first and in what order. On day two you meet the nurses for it in person.",
      psLink: "See if you qualify here.",
      prev: "Your earlier roadmap stays valid:", prevLink: "open the earlier roadmap",
    },
    fr: {
      subject: `Votre plan infirmier (niveau ${n} : ${lvl})`,
      promised: "comme promis, voici votre plan :", tap: "Cliquez ici pour votre PDF :",
      link: `PLAN INFIRMIER – NIVEAU ${n}`, insideH: "Vous y trouverez :",
      inside: [`Ce qu'est exactement le niveau ${n} et ce qui vous freine`, "Quoi faire, avec des listes à cocher", n < 5 ? `Et ce qu'il faut pour passer au niveau ${next}` : "Et ce qu'il faut pour rester au sommet"],
      note: "<b>Remarque</b> : le plan contient aussi votre calendrier, un calculateur pour vos propres chiffres et, en bonus, le check agence. Et à la dernière page, un remerciement vous attend.",
      next: "Le plan vous montre quoi faire ensuite.",
      ps: `P.S. Beaucoup d'établissements restent bloqués au niveau ${n}. Trop de choses arrivent en même temps, et on ne sait pas par où commencer.`,
      ps2: "Dans notre atelier à Casablanca, au Maroc, nous construisons votre plan en 2 jours : quoi régler d'abord et dans quel ordre. Le deuxième jour, vous rencontrez les infirmières en personne.",
      psLink: "Vérifiez ici si vous pouvez participer.",
      prev: "Votre plan précédent reste valable :", prevLink: "ouvrir le plan précédent",
    },
  }[lang];
  const a = (href: string, label: string) => `<a href="${esc(href)}" style="color:${LINK};font-weight:bold;text-decoration:underline">${esc(label)}</a>`;
  const list = `<ul style="font-size:15px;line-height:1.6;margin:0 0 16px;padding-left:22px">${T.inside.map((x) => `<li style="margin:0 0 10px">${esc(x)}</li>`).join("")}</ul>`;
  const body =
    p(hello) + p(T.promised) +
    p(`<b><u>${T.tap}</u></b>`) + btn(o.viewUrl, T.link) +
    p(`<b>${T.insideH}</b>`) + list + p(T.note) +
    (o.previousUrl ? p(`${esc(T.prev)} ${a(o.previousUrl, T.prevLink)}`) : "") +
    p(esc(L.when)) + p(esc(L.role)) + p(esc(L.problem)) + p(esc(L.why)) + p(esc(L.feel)) +
    p(a(o.viewUrl, T.next)) +
    p(SIGNOFF[lang]) +
    `<div style="margin-top:28px">` + p(esc(T.ps)) + p(esc(T.ps2)) + p(a(WORKSHOP_URL, T.psLink)) + `</div>`;
  const text = [
    greeting(lang, o.salutation, o.lastName, o.firstName), T.promised, `${T.tap}\n>> ${T.link} <<\n${o.viewUrl}`,
    T.insideH + "\n" + T.inside.map((x) => "- " + x).join("\n"), T.note.replace(/<[^>]+>/g, ""),
    o.previousUrl ? `${T.prev} ${o.previousUrl}` : "",
    L.when, L.role, L.problem, L.why, L.feel, `${T.next} ${o.viewUrl}`,
    SIGNOFF[lang].replace("<br>", "\n"),
    `${T.ps}\n\n${T.ps2}\n\n${T.psLink} ${WORKSHOP_URL}`,
    `${unsubLabel(lang)}: ${o.unsubscribeUrl}`,
  ].filter(Boolean).join("\n\n");
  void o.bonusUrl; // the bonus lives in the viewer (second tab)
  return { subject: T.subject, html: shell(lang, body, unsubFooter(lang, o.unsubscribeUrl)), text };
}

/** Follow-up #n (0-based), sent FOLLOWUP_DAYS[n] days after the confirm click. */
export function followupMail(n: number, o: Addressee & { lang: Lang; result: RoadmapResult; unsubscribeUrl: string; facilityType?: FacilityType }): Mail | null {
  const { lang } = o;
  const firstWeek = esc(pick(FACILITY[o.facilityType ?? "care_home"].firstWeek, lang));
  // The next open workshop dates, from the one list (lib/workshopDates): a mail never names a date that has passed.
  const next = upcomingOpenDates().slice(0, 2).map((d) => `<b>${esc(dateRangeLabel(d, lang))}</b>`);
  const both = (and: string) => (next.length === 2 ? `${next[0]} ${and} ${next[1]}` : next[0] ?? "");
  const datesLine = !next.length ? "" : {
    de: `${next.length === 2 ? "Die nächsten Termine" : "Der nächste Termin"}: ${both("und")}, jeweils Samstag und Sonntag.`,
    en: `${next.length === 2 ? "The next dates" : "The next date"}: ${both("and")}, Saturday and Sunday.`,
    fr: `${next.length === 2 ? "Les prochaines dates" : "La prochaine date"} : ${both("et")}, samedi et dimanche.`,
  }[lang];
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
      ], cta: "Den Workshop ansehen" },
      { subject: "Die erste Woche entscheidet", lines: [
        hello,
        "ob eine Pflegekraft bleibt, entscheidet sich oft in der ersten Woche. Drei Dinge machen den Unterschied:",
        "<b>1.</b> Jemand holt sie ab. <b>2.</b> Die Wohnung ist fertig, bevor sie kommt. <b>3.</b> Jeden Tag 10 Minuten: Wie war es heute?",
        firstWeek,
        "Den ganzen 90-Tage-Plan finden Sie in Ihrem Fahrplan.",
      ], cta: "Pflegekräfte persönlich treffen" },
      { subject: "So rechnet sich eine Pflegekraft, die bleibt", lines: [
        hello,
        `eine Pflegekraft, die bleibt, bringt Ihnen etwa <b>${per} pro Monat</b>. So viel kostet Sie eine leere Stelle heute.`,
        `Bei drei Pflegekräften sind das etwa <b>${three} pro Monat</b>. Jeder Monat, den Sie warten, ist Geld, das nicht zurückkommt.`,
        "Im Workshop in Casablanca rechnen wir Ihre echten Zahlen mit Ihnen durch.",
      ], cta: "Den Workshop ansehen" },
      { subject: "Ihr Plan in 2 Tagen. Und die Pflegekräfte dazu.", lines: [
        hello,
        "Sie haben jetzt Ihren Fahrplan. Viele wollen den nächsten Schritt nicht allein gehen.",
        "Dafür gibt es unseren <b>Workshop in Casablanca</b>: 2 Tage mit mir, in unseren Konferenzräumen. Am ersten Tag finden wir Ihre größte Hürde und bauen Ihren Plan. Am zweiten lernen Sie die Pflegekräfte persönlich kennen, die zu diesem Plan passen. Sie fahren mit einem fertigen Plan nach Hause.",
        datesLine,
        "1.500 € pro Person. 20 Plätze pro Termin.",
      ], cta: "Platz anfragen" },
    ],
    en: [
      { subject: "The most expensive mistake with nurses from abroad", lines: [
        hello,
        "the most expensive mistake is not a high price. It is the nurse who leaves during probation. Then you pay for everything twice: the search, the onboarding, the empty post.",
        "Ask every agency three questions: <b>1.</b> Who checks her German, and how? <b>2.</b> Who does recognition and the visa? <b>3.</b> What happens if she leaves during probation?",
        "If the answers are unclear: walk away. All 10 questions are in the agency check from our first email.",
      ], cta: "See the workshop" },
      { subject: "The first week decides", lines: [
        hello,
        "whether a nurse stays is often decided in the first week. Three things make the difference:",
        "<b>1.</b> Someone picks her up. <b>2.</b> The flat is ready before she arrives. <b>3.</b> 10 minutes every day: how was today?",
        firstWeek,
        "The full 90-day plan is in your roadmap.",
      ], cta: "Meet the nurses in person" },
      { subject: "What a nurse who stays is worth", lines: [
        hello,
        `a nurse who stays brings you about <b>${per} a month</b>. That is what one empty post costs you today.`,
        `With three nurses that is about <b>${three} a month</b>. Every month you wait is money that never comes back.`,
        "At the workshop in Casablanca we work through your real numbers with you.",
      ], cta: "See the workshop" },
      { subject: "Your plan in 2 days. And the nurses for it.", lines: [
        hello,
        "you have your roadmap now. Many don't want to take the next step alone.",
        "That is what our <b>workshop in Casablanca, Morocco</b> is for: 2 days with me in our conference rooms. On day one we find your biggest hurdle and build your plan. On day two you meet the nurses who fit that plan, in person. You go home with a finished plan.",
        datesLine,
        "€1,500 per person. 20 seats per date.",
      ], cta: "Request a seat" },
    ],
    fr: [
      { subject: "L'erreur la plus chère avec les infirmières de l'étranger", lines: [
        hello,
        "l'erreur la plus chère n'est pas un prix trop élevé. C'est l'infirmière qui part pendant la période d'essai. Vous payez alors tout deux fois : la recherche, l'intégration, le poste vide.",
        "Posez trois questions à chaque agence : <b>1.</b> Qui vérifie son allemand, et comment ? <b>2.</b> Qui gère la reconnaissance et le visa ? <b>3.</b> Que se passe-t-il si elle part pendant l'essai ?",
        "Si les réponses sont floues : passez votre chemin. Les 10 questions sont dans le check agence de notre premier e-mail.",
      ], cta: "Voir l'atelier" },
      { subject: "La première semaine décide", lines: [
        hello,
        "qu'une infirmière reste se décide souvent la première semaine. Trois choses font la différence :",
        "<b>1.</b> Quelqu'un vient la chercher. <b>2.</b> Le logement est prêt avant son arrivée. <b>3.</b> 10 minutes chaque jour : comment ça s'est passé ?",
        firstWeek,
        "Le plan complet de 90 jours est dans votre plan.",
      ], cta: "Rencontrer les infirmières" },
      { subject: "Ce que vaut une infirmière qui reste", lines: [
        hello,
        `une infirmière qui reste vous rapporte environ <b>${per} par mois</b>. C'est ce que vous coûte un poste vide aujourd'hui.`,
        `Avec trois infirmières, c'est environ <b>${three} par mois</b>. Chaque mois d'attente est de l'argent perdu.`,
        "À l'atelier à Casablanca, nous calculons vos vrais chiffres avec vous.",
      ], cta: "Voir l'atelier" },
      { subject: "Votre plan en 2 jours. Et les infirmières pour le réaliser.", lines: [
        hello,
        "vous avez maintenant votre plan. Beaucoup ne veulent pas faire la prochaine étape seuls.",
        "C'est le but de notre <b>atelier à Casablanca</b> : 2 jours avec moi, dans nos salles de conférence. Le premier jour, nous trouvons votre plus gros obstacle et construisons votre plan. Le deuxième, vous rencontrez en personne les infirmières qui correspondent à ce plan. Vous repartez avec un plan prêt.",
        datesLine,
        "1 500 € par personne. 20 places par date.",
      ], cta: "Demander une place" },
    ],
  };
  const m = S[lang][n];
  if (!m) return null;
  // no discovery calls (founder 2026-11-08): every tip mail points to the workshop
  const url = WORKSHOP_URL;
  const lines = m.lines.filter(Boolean);
  const html = shell(lang, lines.map(p).join("") + btn(url, m.cta) + p(BYE[lang]), unsubFooter(lang, o.unsubscribeUrl));
  const text = [...lines.map((l) => l.replace(/<[^>]+>/g, "")), `${m.cta}: ${url}`, BYE[lang].replace("<br>", "\n"), `${unsubLabel(lang)}: ${o.unsubscribeUrl}`].join("\n\n");
  return { subject: m.subject, html, text };
}
