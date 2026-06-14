/**
 * Plain-language confirm / cancel detection (EN / DE / FR) for the bot's
 * CODE-ENFORCED confirm step. A weak model can't reliably tell "stage" from
 * "confirm" — on "yes"/"senden" it re-runs the staging tool and asks again
 * forever. So the Telegram webhook detects a bare affirmation/negation HERE and
 * applies/cancels the pending action itself, no model needed. Pure + tested so
 * this critical path can't silently regress.
 */
const CONFIRM_RE = /^(y|ye|yes+|yep|yeah|yup|ok|okay|kk?|sure|fine|do it|send|send it|send it now|send the e?mail|send the mail|go|go ahead|confirm|confirmed|approve|approved|yes please|please do|ja|jaa+|jawohl|senden|abschicken|schick(e|s)?( es| ihn| sie)?( ab)?|mach(e|s)?( es)?|los( gehts)?|bestätigen|bestaetigen|oui|envoie|envoie[- ]le|envoyer|confirme[rz]?|vas[- ]?y|d.?accord)$/i;
const CANCEL_RE = /^(n|no+|nope|nah|nope|cancel|stop|don.?t|dont|never ?mind|nvm|forget it|nein|nee|noe|n[oö]+|abbrechen|nicht senden|nicht|vergiss( es)?|lass( es)?|macht nichts|non|annule[rz]?|laisse tomber|stopp?)$/i;
// Also treat a SHORT message that clearly says cancel/stop as a cancel, even with
// a few extra words ("actually cancel that", "ne lass es", "nope don't send it").
const CANCEL_SUBSTR = /\b(cancel|stop|abbrechen|nicht senden|never ?mind|forget it|vergiss|lass es|annule|laisse tomber)\b/i;

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
  if (!n) return false;
  if (n.length <= 30 && CANCEL_RE.test(n)) return true;
  // A short message that explicitly says cancel/stop (with a little extra wording).
  if (n.length <= 60 && CANCEL_SUBSTR.test(n)) return true;
  return false;
}
