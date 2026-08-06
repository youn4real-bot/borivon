/**
 * WhatsApp click-to-chat links.
 *
 * No API, no Meta Business account, no approved templates, no monthly fee: a
 * wa.me link opens WhatsApp with the message already typed, and a human presses
 * send. That is deliberate — the founder chose it over automated sending so the
 * chasing can start this week instead of after a Meta template review.
 *
 * Everything an automated sender would need later lives here too: the recipient,
 * the reason, and the finished message text in her own language. Swapping in the
 * Cloud API means calling it with `text` instead of building a URL — the message
 * catalogue below does not change.
 */

/** Reasons a candidate gets chased. Keep in sync with lib/chaseList.ts. */
export type ChaseReason =
  | "passport_expired"
  | "passport_expiring"
  | "id_card_not_passport"
  | "doc_rejected"
  | "stalled";

/**
 * Normalise a Moroccan number to the digits-only form wa.me needs.
 *
 * Stored numbers look like "+212 652 628 769". wa.me wants "212652628769" — no
 * plus, no spaces. A local "0652…" is rewritten to the 212 country code, which
 * is what a Moroccan candidate will have typed if she forgot the prefix.
 * Returns "" when there is nothing dialable, so the caller can show WHY the
 * button is missing rather than opening a broken chat.
 */
export function waNumber(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("212")) return d.length >= 11 ? d : "";
  if (d.startsWith("0"))   return d.length >= 10 ? "212" + d.slice(1) : "";
  // A bare 9-digit national number ("652628769").
  if (d.length === 9)      return "212" + d;
  // Anything else already carries some country code — trust it if it is long
  // enough to be a real number.
  return d.length >= 11 ? d : "";
}

type Lang = "fr" | "en" | "de";

/** Her language if we know it, else French — these are Moroccan candidates. */
export function chaseLang(stored: string | null | undefined): Lang {
  return stored === "en" || stored === "de" || stored === "fr" ? stored : "fr";
}

/**
 * The message itself. Written to be sent by a person, not a robot: it opens with
 * her first name, says exactly what is needed and why it matters, and asks for
 * one specific thing. No emoji, no marketing tone — these are people whose visa
 * depends on the answer.
 */
export function chaseMessage(
  reason: ChaseReason,
  opts: { firstName: string; lang: Lang; days?: number; docType?: string },
): string {
  const name = (opts.firstName || "").trim().split(/\s+/)[0] || "";
  const hi = { fr: `Bonjour ${name},`, en: `Hello ${name},`, de: `Hallo ${name},` }[opts.lang];
  const signoff = { fr: "Merci beaucoup,\nL'équipe Borivon", en: "Thank you,\nThe Borivon team", de: "Vielen Dank,\nDein Borivon-Team" }[opts.lang];
  const d = opts.days ?? 0;

  const body: Record<ChaseReason, Record<Lang, string>> = {
    passport_expired: {
      fr: `ton passeport a expiré. Sans passeport valide, ton dossier de visa ne peut pas avancer — c'est la seule chose qui bloque en ce moment.\n\nPeux-tu lancer le renouvellement cette semaine et nous envoyer une photo de la nouvelle page dès que tu l'as ?`,
      en: `your passport has expired. Without a valid passport your visa file cannot move forward — right now it is the only thing blocking it.\n\nCould you start the renewal this week and send us a photo of the new page as soon as you have it?`,
      de: `dein Reisepass ist abgelaufen. Ohne gültigen Pass kann dein Visumantrag nicht weitergehen — im Moment ist das der einzige Blocker.\n\nKannst du die Verlängerung diese Woche starten und uns ein Foto der neuen Seite schicken, sobald du sie hast?`,
    },
    passport_expiring: {
      fr: `ton passeport expire dans ${d} jours. L'ambassade demande une validité suffisante, donc il faut le renouveler avant de déposer le dossier.\n\nPeux-tu prendre rendez-vous cette semaine ? Envoie-nous une photo de la nouvelle page dès que tu l'as.`,
      en: `your passport expires in ${d} days. The embassy requires enough remaining validity, so it needs renewing before we submit.\n\nCould you book an appointment this week? Send us a photo of the new page as soon as you have it.`,
      de: `dein Reisepass läuft in ${d} Tagen ab. Die Botschaft verlangt ausreichende Restgültigkeit, er muss also vor der Einreichung verlängert werden.\n\nKannst du diese Woche einen Termin machen? Schick uns ein Foto der neuen Seite, sobald du sie hast.`,
    },
    id_card_not_passport: {
      fr: `nous avons bien reçu ton document, mais c'est ta carte nationale d'identité — pas ton passeport. Pour l'Allemagne il nous faut la page photo du PASSEPORT (le livret), celle avec ton nom et le numéro en haut.\n\nPeux-tu nous envoyer une photo de cette page ? Si tu n'as pas encore de passeport, dis-le-nous et on t'explique la démarche.`,
      en: `we received your document, but it is your national ID card — not your passport. For Germany we need the photo page of the PASSPORT (the booklet), the one with your name and the number at the top.\n\nCould you send a photo of that page? If you do not have a passport yet, tell us and we will walk you through it.`,
      de: `wir haben dein Dokument erhalten, aber es ist dein Personalausweis — nicht dein Reisepass. Für Deutschland brauchen wir die Fotoseite des REISEPASSES, die mit deinem Namen und der Nummer oben.\n\nKannst du ein Foto dieser Seite schicken? Falls du noch keinen Reisepass hast, sag uns Bescheid, wir erklären dir den Weg.`,
    },
    doc_rejected: {
      fr: `ton document « ${opts.docType ?? ""} » n'a pas pu être accepté et on attend toujours la nouvelle version.\n\nTu trouves la raison exacte dans ton espace Borivon. Peux-tu le renvoyer quand tu as un moment ?`,
      en: `your document "${opts.docType ?? ""}" could not be accepted and we are still waiting for the new version.\n\nThe exact reason is in your Borivon account. Could you re-send it when you have a moment?`,
      de: `dein Dokument „${opts.docType ?? ""}" konnte nicht angenommen werden und wir warten noch auf die neue Version.\n\nDen genauen Grund findest du in deinem Borivon-Konto. Kannst du es bei Gelegenheit neu hochladen?`,
    },
    stalled: {
      fr: `ça fait un moment qu'on n'a pas eu de nouvelles et ton dossier est en pause.\n\nEst-ce que tout va bien ? Dis-nous simplement où tu en es — même si tu as besoin de plus de temps, ça nous aide à savoir.`,
      en: `we have not heard from you in a while and your file is on hold.\n\nIs everything alright? Just let us know where you stand — even if you need more time, it helps us to know.`,
      de: `wir haben länger nichts von dir gehört und dein Dossier liegt still.\n\nIst alles in Ordnung? Sag uns einfach kurz, wo du stehst — auch wenn du mehr Zeit brauchst, hilft uns das.`,
    },
  };

  return `${hi}\n\n${body[reason][opts.lang]}\n\n${signoff}`;
}

/** The wa.me link that opens WhatsApp with the message pre-typed. "" if unreachable. */
export function whatsappLink(phone: string | null | undefined, message: string): string {
  const n = waNumber(phone);
  if (!n) return "";
  return `https://wa.me/${n}?text=${encodeURIComponent(message)}`;
}
