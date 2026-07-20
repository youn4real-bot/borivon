import { describe, it, expect } from "vitest";
import { isConfirmText, isCancelText, isSendImperative, isResetText, isShowFilesText, isMuteDocReminders, isUnmuteDocReminders, isMinimalReminders, isBriefingSignalsOn, isSetReminder, parseReminderText, looksLikeDone, looksLikeEmailDraft } from "../lib/confirmIntent";

// looksLikeEmailDraft decides whether a bare "send" is allowed to auto-apply the
// send the model stages this turn. A false POSITIVE could fire an email the model
// invented, so the already-sent "✅ Done" confirmation must never read as a draft.
// Strings below are taken from the founder's REAL Telegram log (2026-06-25).
describe("looksLikeEmailDraft — is a real draft on screen?", () => {
  const REAL_DRAFT = 'To: abenchiir@gmail.com · Subject: Gute Nachrichten zur Anerkennung deines Bruders · 📎 — ——— Hallo Abdelhak, wir haben gute Nachrichten bezüglich der Anerkennung.';
  const REAL_REPLY_DRAFT = 'To: abenchiir@gmail.com · Subject: Re: Gute Nachrichten zur Anerkennung deines Bruders · 📎 — ——— Hallo Abdelhak, hier ist ein neuer Anmeldelink.';
  const ALREADY_SENT = '✅ Done — 📧 To: abenchiir@gmail.com Subject: Gute Nachrichten zur Anerkennung deines Bruders Attachments: none Hallo Abdelhak, wir haben gute Nachrichten.';
  const DEAD_END = "Nothing's staged to send right now — if you just sent one, it already went out.";

  it("detects a drafted email", () => expect(looksLikeEmailDraft(REAL_DRAFT)).toBe(true));
  it("detects a drafted reply", () => expect(looksLikeEmailDraft(REAL_REPLY_DRAFT)).toBe(true));
  it("does NOT treat an already-sent confirmation as a draft", () => expect(looksLikeEmailDraft(ALREADY_SENT)).toBe(false));
  it("does NOT treat the dead-end notice as a draft", () => expect(looksLikeEmailDraft(DEAD_END)).toBe(false));
  for (const t of ["", "ok", "You have 20 unanswered emails.", "Here's a new candidate signup link: https://www.borivon.com/join/candidate/abc"]) {
    it(`not a draft: "${t.slice(0, 40)}"`, () => expect(looksLikeEmailDraft(t)).toBe(false));
  }
});

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

// isSendImperative pins the send-loop fix: a "send" with NOTHING staged must be caught here
// (so the webhook says "nothing staged" instead of letting the model re-draft → re-preview
// loop + duplicate send). A bare "yes" must NOT match (it can answer a model question).
describe("isSendImperative — send-the-email imperatives (subset of confirm)", () => {
  for (const t of ["send", "Send", "send it", "send it now", "Send it now", "send the email", "send the mail", "just send it", "yes send it", "ok send it", "go ahead and send", "senden", "abschicken", "schick es ab", "envoie", "envoie-le", "envoyer"]) {
    it(`is a send-imperative: "${t}"`, () => expect(isSendImperative(t)).toBe(true));
    it(`...and also a confirm: "${t}"`, () => expect(isConfirmText(t)).toBe(true));
  }
  // Bare affirmations / questions / new-recipient corrections must NOT be send-imperatives.
  for (const t of ["yes", "ok", "sure", "ja", "oui", "go ahead", "confirm", "do it", "", "send it to omar@x.com instead", "why are there two events", "draft an email to anna"]) {
    it(`is NOT a send-imperative: "${t}"`, () => expect(isSendImperative(t)).toBe(false));
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
  // COMPOUND corrections carry a NEW instruction — must NOT be swallowed as a bare cancel
  // (else the new action silently vanishes). They go to the model, which cancels + re-does.
  for (const t of [
    "cancel that and email omar@x.com instead",
    "cancel that and email Omar instead",
    "no, send it to anna@klinik.de instead",
    "stop, then send it to the recruiter",
    "cancel the dentist event and book it for Friday",
    "abbrechen und schick es an Omar",
    "annule et envoie-le à Anna",
  ]) {
    it(`does NOT cancel (compound correction): "${t}"`, () => expect(isCancelText(t)).toBe(false));
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

// "remind me about X" — code-enforced because Flash kept NOT calling saveReminder,
// so the thing the founder wanted to be reminded of (e.g. Mercury bank) vanished.
describe("isSetReminder — store a standing personal reminder", () => {
  for (const t of [
    "remind me about the mercury bank thing",
    "remind me to call the embassy Monday",
    "remind me of the deposit deadline",
    "don't let me forget the Mercury bank account",
    "dont let me forget to renew the lease",
    "note to self: book the flights",
    "remember to send Aya the contract",
    "erinnere mich an den Mercury Termin",
    "rappelle-moi d'appeler l'ambassade",
    "please remind me to follow up with the lawyer",
    // TIME-FIRST phrasings — the optional time phrase between "remind me" and to/about.
    "remind me in 30 to call the bank",
    "remind me tomorrow to review the contract",
    "remind me at 3pm to email Anna",
    "remind me tonight about the deposit",
  ]) {
    it(`is a reminder: "${t}"`, () => expect(isSetReminder(t)).toBe(true));
  }
  // Questions ("tell me now") and unrelated chat must NOT be stored as reminders.
  for (const t of [
    "",
    "remind me what Anna said",
    "remind me who is in the UKSH batch",
    "what do I need to do today",
    "how is Hajar doing?",
    "approve the diploma",
    // MULTI-INTENT — a reminder PLUS a separate bot action (a comma+conjunction or a
    // multiword conjunction before a clear bot verb) → must go to the model, not be saved
    // as one garbage reminder with the rest dropped. (A bare "X and email Y" with no comma
    // stays a single compound reminder by design — the deterministic path handles that.)
    "remind me to call the embassy, and email Anna the CV",
    "remind me to follow up, then set Hajar to waiting",
    "remind me about the deposit and also nudge the stuck candidates",
  ]) {
    it(`is NOT a reminder: "${t}"`, () => expect(isSetReminder(t)).toBe(false));
  }
});

describe("parseReminderText — pull just the task out of the phrasing", () => {
  const cases: [string, string][] = [
    ["remind me to call the embassy Monday", "call the embassy Monday"],
    ["remind me about the mercury bank thing", "the mercury bank thing"],
    ["don't let me forget the Mercury bank account", "the Mercury bank account"],
    ["note to self: book the flights", "book the flights"],
    ["remember to send Aya the contract", "send Aya the contract"],
    // TIME-FIRST — the time phrase is consumed out of the saved task text.
    ["remind me in 30 to call the bank", "call the bank"],
    ["remind me tomorrow to review the contract", "review the contract"],
    ["remind me at 3pm to email Anna", "email Anna"],
  ];
  for (const [input, want] of cases) {
    it(`"${input}" -> "${want}"`, () => expect(parseReminderText(input)).toBe(want));
  }
  it("returns '' when there's no task after the lead-in", () => expect(parseReminderText("remind me to")).toBe(""));
});

// Gate for the post-turn auto-close. Biased to fire on completion-ish messages.
describe("looksLikeDone — founder signalling a task is handled", () => {
  for (const t of [
    "done",
    "it's done",
    "the mercury thing is handled",
    "I already paid the Mercury invoice",
    "I called the embassy",
    "I just sent it",
    "mark that done",
    "no longer need that reminder",
    "erledigt",
    "c'est fait",
  ]) {
    it(`looks done: "${t}"`, () => expect(looksLikeDone(t)).toBe(true));
  }
  for (const t of [
    "",
    "how is Hajar doing?",
    "what should I do today",
    "remind me to call the embassy",
    "send the email to Anna",
  ]) {
    it(`does NOT look done: "${t}"`, () => expect(looksLikeDone(t)).toBe(false));
  }
});

describe("isMinimalReminders — only push my dictated reminders", () => {
  for (const t of [
    "only remind me of what I tell you",
    "only remind me of what i tell you to remind me of",
    "just remind me of my own reminders",
    "stop reminding me of everything",
    "stop reminding me of all that stuff",
    "don't remind me of everything, only what I tell you",
    "only remind me when I tell you to",
  ]) {
    it(`is MINIMAL: "${t}"`, () => expect(isMinimalReminders(t)).toBe(true));
  }
  // A normal "remind me to X" task must NOT be swallowed as minimal-mode.
  for (const t of [
    "remind me to call the embassy Monday",
    "only remind me to call her at 3pm",
    "remind me about the mercury bank thing",
    "what do I need to do today",
  ]) {
    it(`is NOT minimal: "${t}"`, () => expect(isMinimalReminders(t)).toBe(false));
  }
});

describe("isBriefingSignalsOn — bring the auto-signals back", () => {
  for (const t of [
    "turn the briefing signals back on",
    "turn the signals on again",
    "show passports and b2 in my briefing again",
    "include passports in the briefing",
  ]) {
    it(`turns signals ON: "${t}"`, () => expect(isBriefingSignalsOn(t)).toBe(true));
  }
  for (const t of ["only remind me of what I tell you", "stop reminding me of everything"]) {
    it(`does NOT turn signals on: "${t}"`, () => expect(isBriefingSignalsOn(t)).toBe(false));
  }
});
