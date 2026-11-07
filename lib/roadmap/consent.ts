/**
 * The Fahrplan's one consent box and the way we address people.
 *
 * Founder, 2026-11-07: ONE empty, required box on the last screen, right under
 * the email field. Its words cover the PDF and the tips/offers mails together,
 * and they only count after the double opt-in (confirm link in the mail).
 *
 * CONSENT_TEXT is what we store as proof (Art. 7(1) GDPR), word for word. The
 * page (content/pflege/fahrplan.html) shows `consent` + " " + `privacyLink`;
 * a test makes sure the page and this file never drift apart.
 */
import type { Lang } from "./content";

export const CONSENT_TEXT: Record<Lang, string> = {
  de: "Ich möchte meinen Fahrplan sowie Tipps und Angebote von Borivon per E-Mail erhalten. Abmeldung jederzeit möglich. Datenschutzerklärung",
  en: "I want to receive my roadmap and tips and offers from Borivon by email. Unsubscribe at any time. Privacy policy",
  fr: "Je souhaite recevoir mon plan ainsi que des conseils et des offres de Borivon par e-mail. Désabonnement à tout moment. Politique de confidentialité",
};

export type Salutation = "frau" | "herr" | "none";
export const SALUTATIONS: Salutation[] = ["frau", "herr", "none"];

const TITLE: Record<Lang, Record<Exclude<Salutation, "none">, string>> = {
  de: { frau: "Frau", herr: "Herr" },
  en: { frau: "Ms", herr: "Mr" },
  fr: { frau: "Madame", herr: "Monsieur" },
};

export function asSalutation(v: unknown): Salutation {
  return v === "frau" || v === "herr" ? v : "none";
}

/** "Frau Müller", or "" when there is no title to put in front. */
export function addressName(lang: Lang, sal: Salutation, lastName: string): string {
  const last = (lastName || "").trim();
  return sal === "none" || !last ? "" : `${TITLE[lang][sal]} ${last}`;
}

/** First line of every mail: "Hallo Frau Müller," or just "Hallo,". */
export function greeting(lang: Lang, sal: Salutation, lastName: string): string {
  const n = addressName(lang, sal, lastName);
  const hi = lang === "de" ? "Hallo" : lang === "fr" ? "Bonjour" : "Hello";
  return n ? `${hi} ${n},` : `${hi},`;
}

/** What the admin list shows in the name column: "Frau Müller" or "Müller". */
export function leadName(sal: Salutation, lastName: string): string {
  return addressName("de", sal, lastName) || (lastName || "").trim();
}

/** The visitor's IP as Cloudflare sees it (proof of consent), or "". */
export function clientIp(h: Headers): string {
  return (h.get("cf-connecting-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || "").trim().slice(0, 64);
}
