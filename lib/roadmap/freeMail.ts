/**
 * The Fahrplan is for employers: founder rule (2026-10-23) "it must be a
 * business email". Free mailbox providers are refused, in the page (small red
 * line, no other visible text) and again here on the server.
 *
 * Keep FREE_MAIL_DOMAINS in sync with `var FREE = [...]` in
 * content/pflege/fahrplan.html (tests/roadmap.test.ts checks they match).
 * Note: some very small German care services do run on t-online.de / gmx.de;
 * the founder chose business-only anyway.
 */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  // global
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "rocketmail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "pm.me", "tutanota.com", "tutanota.de", "tuta.io", "tuta.com",
  "gmx.com", "mail.com", "yandex.com", "yandex.ru", "mail.ru", "zohomail.com", "hey.com",
  // Germany / Austria / Switzerland
  "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "web.de", "t-online.de", "freenet.de", "posteo.de",
  "mailbox.org", "arcor.de", "online.de", "email.de", "outlook.de", "hotmail.de", "live.de",
  "yahoo.de", "aol.de", "bluewin.ch", "kabelmail.de", "vodafonemail.de", "ewe.net",
  // France / Belgium
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr", "neuf.fr", "bbox.fr",
  "outlook.fr", "hotmail.fr", "live.fr", "yahoo.fr", "aol.fr", "gmx.fr", "skynet.be",
  // UK / others seen in DACH care
  "hotmail.co.uk", "yahoo.co.uk", "outlook.at", "hotmail.it", "libero.it",
];

const FREE = new Set(FREE_MAIL_DOMAINS);

/** Domain part, lower-cased, or "" when there is none. */
export function emailDomain(email: string): string {
  const at = String(email ?? "").trim().toLowerCase().lastIndexOf("@");
  return at < 0 ? "" : String(email).trim().toLowerCase().slice(at + 1);
}

/** True for addresses at a free mailbox provider (gmail.com, gmx.de, …). */
export function isFreeMail(email: string): boolean {
  return FREE.has(emailDomain(email));
}
