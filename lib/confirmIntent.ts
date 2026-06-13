/**
 * Plain-language confirm / cancel detection (EN / DE / FR) for the bot's
 * CODE-ENFORCED confirm step. A weak model can't reliably tell "stage" from
 * "confirm" — on "yes"/"senden" it re-runs the staging tool and asks again
 * forever. So the Telegram webhook detects a bare affirmation/negation HERE and
 * applies/cancels the pending action itself, no model needed. Pure + tested so
 * this critical path can't silently regress.
 */
const CONFIRM_RE = /^(y|ye|yes+|yep|yeah|yup|ok|okay|kk?|sure|fine|do it|send|send it|send it now|send the e?mail|send the mail|go|go ahead|confirm|confirmed|approve|approved|yes please|please do|ja|jaa+|jawohl|senden|abschicken|schick(e|s)?( es| ihn| sie)?( ab)?|mach(e|s)?( es)?|los( gehts)?|bestätigen|bestaetigen|oui|envoie|envoie[- ]le|envoyer|confirme[rz]?|vas[- ]?y|d.?accord)$/i;
const CANCEL_RE = /^(n|no+|nope|nah|cancel|stop|don.?t|dont|never ?mind|nvm|forget it|nein|abbrechen|nicht senden|nicht|non|annule[rz]?)$/i;

/** Lowercase, trim, strip surrounding quotes + trailing punctuation. */
export function normShort(s: string): string {
  return (s || "").trim().toLowerCase().replace(/^[\s"']+|[\s"'!.,;:?]+$/g, "");
}

/** True when the message is a plain "apply the pending action" affirmation. */
export function isConfirmText(t: string): boolean {
  const n = normShort(t);
  if (!n) return false;
  // A new/changed request (a new recipient, "instead", …) is NOT a bare confirm.
  if (/@|\binstead\b|\bstattdessen\b|\bau lieu\b/.test(n)) return false;
  if (CONFIRM_RE.test(n)) return true;
  // Short "yes send it" / "ok send the email" / "just send it" style confirmations.
  if (n.length <= 50 && /(^|\b)(send it|send the|just send|yes send|ok send|go ahead and send|abschicken|senden|confirm|envoie)\b/.test(n)) return true;
  return false;
}

/** True when the message is a plain "cancel the pending action" negation. */
export function isCancelText(t: string): boolean {
  const n = normShort(t);
  return !!n && n.length <= 30 && CANCEL_RE.test(n);
}
