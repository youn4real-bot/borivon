import { describe, it, expect } from "vitest";
import { isConfirmText, isCancelText, isResetText, isShowFilesText, isMuteDocReminders, isUnmuteDocReminders } from "../lib/confirmIntent";

// The bot's CODE-ENFORCED confirm path keys off these. If they regress, the
// "say yes → it just re-asks forever" bug comes back, so the behaviour is pinned.
describe("isConfirmText — plain 'apply the pending action' affirmations", () => {
  for (const t of ["yes", "Yes", "YES", "y", "yep", "yeah", "ok", "okay", "sure", "do it", "send it", "send it now", "send the email", "go ahead", "confirm", "confirmed", "yes please", "ja", "senden", "Senden", "abschicken", "schick es ab", "bestätigen", "oui", "envoie", "envoie le", "vas-y", "d'accord", "yes send it", "ok send the email", "just send it"]) {
    it(`confirms: "${t}"`, () => expect(isConfirmText(t)).toBe(true));
  }
  for (const t of ["", "no", "what's Hajar's status", "send it to omar@x.com instead", "send it to Omar instead", "actually change the subject first", "who is in the UKSH batch", "draft an email about the interview"]) {
    it(`does NOT confirm: "${t}"`, () => expect(isConfirmText(t)).toBe(false));
  }
});

describe("isCancelText — plain negations", () => {
  for (const t of ["no", "No", "nope", "nah", "cancel", "stop", "don't", "never mind", "nvm", "nein", "abbrechen", "non", "annuler",
    "nö", "nee", "vergiss es", "lass es", "macht nichts", "stopp", "actually cancel that", "ne lass es", "actually cancel that, I think we should wait"]) {
    it(`cancels: "${t}"`, () => expect(isCancelText(t)).toBe(true));
  }
  for (const t of ["", "yes", "no wait actually send it to a different person entirely please"]) {
    it(`does NOT cancel: "${t}"`, () => expect(isCancelText(t)).toBe(false));
  }
});

describe("isResetText — only a bare 'new chat' command (must NEVER wipe context by accident)", () => {
  for (const t of ["reset", "Reset", "/reset", "/new", "/clear", "start over", "start over please", "fresh start", "new chat", "new topic", "new conversation", "clear context", "clear the chat", "forget everything", "vergiss alles", "von vorne", "neues thema", "nouveau sujet", "on recommence"]) {
    it(`resets: "${t}"`, () => expect(isResetText(t)).toBe(true));
  }
  // CRITICAL: real commands that merely START with a reset-ish word must NOT reset.
  for (const t of ["", "reset Hajar's password", "new candidate Sara Alami", "start the visa process for Omar", "clear his rejected document and re-request it", "forget about the Tuesday slot, use Wednesday", "yes", "send it"]) {
    it(`does NOT reset: "${t}"`, () => expect(isResetText(t)).toBe(false));
  }
});

describe("isShowFilesText — 'show me the files on the draft' (code pulls the REAL bytes, model can't lie)", () => {
  for (const t of ["show me the files", "show me the attached files", "show me the attachments", "what's attached?", "what are the attached files", "let me see the files", "give me the content", "give me the files", "pull the attachments", "show me the documents you'll send", "double-check the files", "zeig mir die dateien", "which files are attached"]) {
    it(`shows: "${t}"`, () => expect(isShowFilesText(t)).toBe(true));
  }
  // Must NOT fire on an actual send/attach command, or unrelated chat.
  for (const t of ["", "send the files to Anna", "email the attachments to a.gombert@calmaroi.de", "attach the photos and send to Omar", "forward the file to the embassy", "how is Hajar doing?", "yes send it"]) {
    it(`does NOT show: "${t}"`, () => expect(isShowFilesText(t)).toBe(false));
  }
});

describe("isMuteDocReminders — 'stop nagging me about documents' (must actually mute the briefing)", () => {
  for (const t of [
    "stop reminding me about missing docs",
    "I told you stop giving me these fucking reminders of missing docs permanently",
    "stop reminding me of any documents",
    "no more document reminders",
    "turn off the doc reminders",
    "quit telling me about pending documents",
    "stop the documents to review reminder",
  ]) {
    it(`mutes: "${t}"`, () => expect(isMuteDocReminders(t)).toBe(true));
  }
  for (const t of ["", "stop chasing my sent emails", "remind me to call the embassy", "approve the diploma", "how many docs are pending?"]) {
    it(`does NOT mute: "${t}"`, () => expect(isMuteDocReminders(t)).toBe(false));
  }
});

describe("isUnmuteDocReminders — bring the doc reminders back", () => {
  for (const t of ["remind me about docs again", "turn the document reminders back on", "start reminding me about documents again", "re-enable doc reminders"]) {
    it(`unmutes: "${t}"`, () => expect(isUnmuteDocReminders(t)).toBe(true));
  }
  for (const t of ["", "stop the doc reminders", "how is Hajar"]) {
    it(`does NOT unmute: "${t}"`, () => expect(isUnmuteDocReminders(t)).toBe(false));
  }
});
