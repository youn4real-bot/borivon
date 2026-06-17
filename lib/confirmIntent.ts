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

// "New chat / fresh start" — ANCHORED to the whole message so it can ONLY fire on
// a bare reset command and NEVER on "reset Hajar's password" / "new candidate Sara".
const RESET_RE =
  /^(\/(reset|new|clear)|reset|start over( please)?|start fresh|fresh start|new (chat|topic|conversation)|clear (the )?(chat|context|history|memory)|forget (everything|all of (that|this)|this (chat|conversation|context))|von vorne|neues thema|neu anfangen|vergiss alles|on recommence|nouveau sujet|nouvelle conversation)$/i;

/** True when the message is an explicit "start a fresh conversation" command. */
export function isResetText(t: string): boolean {
  const n = normShort(t);
  if (!n || n.length > 40) return false; // must be essentially just the command
  return RESET_RE.test(n);
}

// "Show me the files that are about to be sent" — so the CODE (not the model) can
// pull the REAL attachments off the pending draft and deliver them. Detected here
// so the model can NEVER fake/narrate the file list: the bytes come straight from
// the draft. Must NOT fire on an actual send command ("send the files to Anna").
const SHOW_FILES_OBJ = /\b(file|files|attachment|attachments|attached|content|document|documents|photo|photos|pic|pics|image|images|pdf|anhang|anh[aä]nge|datei|dateien|fichiers?|pi[eè]ces?)\b/i;
const SHOW_FILES_VERB = /\b(show|see|view|display|pull|give me|gimme|let me (see|check)|double[- ]?check|verify|zeig|montre)\b/i;
const SHOW_FILES_QWORD = /^(what|which|welche|quel|quels|quelles)\b/i;
// A real send/address command — exclude so we don't intercept "send the files to X".
const LOOKS_LIKE_SEND = /@|\bemail\b|\bcc\b|\bbcc\b|\b(send|attach|forward|schick|envoie)\b.{0,20}\bto\b|\bto\s+[a-z]/i;

/** True when the message is asking to SEE the files of the email about to be sent
 *  (a verification request), not a command to send/attach them somewhere. */
export function isShowFilesText(t: string): boolean {
  const n = (t || "").trim().toLowerCase();
  if (!n || n.length > 90) return false;
  if (LOOKS_LIKE_SEND.test(n)) return false;
  if (!SHOW_FILES_OBJ.test(n)) return false;
  return SHOW_FILES_VERB.test(n) || SHOW_FILES_QWORD.test(n);
}

// MUTE / UNMUTE the "documents waiting for review" nag in the briefing + nudges.
// Detected in CODE because the model repeatedly mis-handled "stop the doc
// reminders" — it saved a useless "preference" the cron ignored. Here we flip the
// real doc_reminders switch so it ACTUALLY stops.
const MUTE_VERB = /\b(stop|no more|don.?t|do not|quit|cut|kill|disable|turn off|shut off|mute|silence|pause|ne plus|arr[eê]tes?|h[oö]r auf|stopp?|keine? mehr)\b/i;
const REMINDISH = /\b(remind|reminder|reminders|reminding|nudg\w*|telling me|tell me|showing me|show me|list\w*|mention\w*|notif\w*|spam\w*|bug\w*)\b/i;
const DOCISH = /\b(doc|docs|document|documents|missing|pending|review\w*|paper\w*|unterlag\w*|dokument\w*|dossier\w*)\b/i;

/** True when the founder is telling the bot to STOP nagging about documents. */
export function isMuteDocReminders(t: string): boolean {
  const n = (t || "").toLowerCase();
  if (!n || n.length > 220) return false;
  return MUTE_VERB.test(n) && REMINDISH.test(n) && DOCISH.test(n);
}

const UNMUTE_VERB = /\b(resume|again|back|re-?enable|re-?activate|turn (it )?(back )?on|switch (it )?on|bring back|start (again|reminding|showing))\b/i;

/** True when the founder wants the document-review reminders BACK. */
export function isUnmuteDocReminders(t: string): boolean {
  const n = (t || "").toLowerCase();
  if (!n || n.length > 140) return false;
  return DOCISH.test(n) && UNMUTE_VERB.test(n);
}
