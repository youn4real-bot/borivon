import { describe, it, expect } from "vitest";
import { isConfirmText, isCancelText } from "../lib/confirmIntent";

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
