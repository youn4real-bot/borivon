/** The platform's two mails: a login link and a team invite. Plain, short, the site's look. */
import type { Lang } from "./steps";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shell(lang: Lang, body: string): string {
  const legal = lang === "de" ? ["Impressum", "Datenschutz"] : lang === "fr" ? ["Mentions légales", "Confidentialité"] : ["Legal notice", "Privacy"];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fcfaf7;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#15130f">
<div style="max-width:520px;margin:0 auto">${body}
<div style="margin-top:48px;text-align:center">
<img src="https://borivon.com/email-logo.png" alt="Borivon." width="150" height="48" style="display:inline-block;border:0" />
<p style="font-size:12px;line-height:1.6;margin:12px 0 0;color:#5b6573">Borivon LLC, 30 N Gould St Ste R, Sheridan, WY 82801, USA<br><a href="https://borivon.com/impressum" style="color:#5b6573">${legal[0]}</a> · <a href="https://borivon.com/datenschutz" style="color:#5b6573">${legal[1]}</a></p>
</div></div></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:26px 0"><a href="${esc(href)}" style="display:inline-block;background:#15130f;color:#fbfaf6;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 22px;border-radius:4px">${esc(label)}</a></p>`;
const p = (s: string) => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${s}</p>`;

const T = {
  de: {
    loginS: "Ihr Login-Link für die Borivon-Plattform", loginH: "Hier ist Ihr Login-Link.", loginP: "Ein Klick, und Sie sind angemeldet. Der Link gilt 15 Minuten und nur einmal.", loginB: "Jetzt anmelden",
    ignore: "Sie haben das nicht angefordert? Dann ignorieren Sie diese E-Mail einfach.",
    invS: "{who} lädt Sie zur Borivon-Plattform ein", invH: "Sie sind eingeladen.", invP: "{who} hat Sie zum Team von {fac} auf der Borivon-Plattform eingeladen. Dort sehen Sie für jede neue Pflegekraft den Ankunftsplan: Behörden, Bank und Krankenkasse in der Nähe.", invB: "Einladung annehmen", invT: "Der Link gilt 7 Tage.",
  },
  en: {
    loginS: "Your login link for the Borivon platform", loginH: "Here is your login link.", loginP: "One click and you are signed in. The link works once, for 15 minutes.", loginB: "Sign in now",
    ignore: "Didn't ask for this? Just ignore this email.",
    invS: "{who} invites you to the Borivon platform", invH: "You're invited.", invP: "{who} invited you to the {fac} team on the Borivon platform: the arrival plan for every new nurse, with offices, bank and health insurer nearby.", invB: "Accept the invitation", invT: "The link works for 7 days.",
  },
  fr: {
    loginS: "Votre lien de connexion à la plateforme Borivon", loginH: "Voici votre lien de connexion.", loginP: "Un clic et vous êtes connecté. Le lien est valable 15 minutes, une seule fois.", loginB: "Se connecter",
    ignore: "Vous n'avez rien demandé ? Ignorez simplement cet e-mail.",
    invS: "{who} vous invite sur la plateforme Borivon", invH: "Vous êtes invité.", invP: "{who} vous a invité dans l'équipe {fac} sur la plateforme Borivon : le plan d'arrivée de chaque nouvelle infirmière, avec administrations, banque et caisse maladie à proximité.", invB: "Accepter l'invitation", invT: "Le lien est valable 7 jours.",
  },
} as const;

export function loginMail(lang: Lang, url: string) {
  const t = T[lang];
  return {
    subject: t.loginS,
    html: shell(lang, `<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:28px;margin:0 0 18px">${esc(t.loginH)}</h1>${p(esc(t.loginP))}${button(url, t.loginB)}${p(`<span style="color:#6b6458;font-size:13px">${esc(t.ignore)}</span>`)}`),
    text: `${t.loginH}\n\n${t.loginP}\n\n${url}\n\n${t.ignore}`,
  };
}

export function inviteMail(lang: Lang, url: string, who: string, facility: string) {
  const t = T[lang];
  const fill = (s: string) => s.replace("{who}", who).replace("{fac}", facility);
  return {
    subject: fill(t.invS),
    html: shell(lang, `<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:28px;margin:0 0 18px">${esc(t.invH)}</h1>${p(esc(fill(t.invP)))}${button(url, t.invB)}${p(`<span style="color:#6b6458;font-size:13px">${esc(t.invT)}</span>`)}`),
    text: `${t.invH}\n\n${fill(t.invP)}\n\n${url}\n\n${t.invT}`,
  };
}
