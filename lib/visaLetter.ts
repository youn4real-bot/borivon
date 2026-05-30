/**
 * Visa motivation letter (Motivationsschreiben) — fixed pieces.
 *
 * The Visum cover letter is a SEPARATE letter from the Essentials one (its own
 * body), but two things are permanent and never editable by the candidate:
 *   • the recipient is ALWAYS the German Embassy in Rabat (the visa office),
 *   • the subject (Betreff) is a fixed professional visa title.
 * Everything else (sender block, body, closing, word limits, generation) is the
 * same as the Essentials builder. Shared by the builder (preview) and the
 * generate route (authoritative PDF) so the two can't drift.
 */

/** Recipient block — German Embassy Rabat, visa section. Permanent. */
export const VISA_RECIPIENT_LINES = [
  "Botschaft der Bundesrepublik Deutschland",
  "7, Zankat Madnine",
  "10 000, Rabat, Marokko",
  "Telefon: +212 537 635 400",
];

/** Subject line — fixed visa motivation-letter title (no "Betreff:" prefix). Permanent. */
export const VISA_SUBJECT = "Motivationsschreiben zur Visumantragstellung";

/**
 * AI prompt for drafting the visa Motivationsschreiben body. Borivon-internal:
 * the "Copy prompt" button (visa builder, admin-only) copies this verbatim so a
 * Borivon admin can paste it + the candidate's CV into any AI and get a draft.
 * Edit here — single source of truth for the button.
 */
export const VISA_PROMPT = `You are writing the body text of a Motivationsschreiben for a German nursing visa application (§16d / §16a AufenthG, recognition of foreign qualifications). I will paste a CV at the bottom. Use ONLY the information in that CV. Never invent qualifications, experiences, or facts that are not in the CV.

OUTPUT RULES — follow exactly:
- Output ONLY the inside body text. No sender address, no recipient address, no date, no "Sehr geehrte Damen und Herren," and no "Mit freundlichen Grüßen" or signature. Just the paragraphs that go between the greeting and the closing.
- No bullet points, no headings, no bold. Plain paragraphs only.
- Never use the dash character "—" or any long dash. Use commas, full stops, or the word "und" instead.

LANGUAGE & LEVEL:
- The letter MUST always be written in German (auf Deutsch). Any other language is only for the candidate's own understanding and is never the document submitted.
- The German level MUST stay at a realistic B2. The candidate obtained B2 in Morocco and has not lived in Germany, so do not write at C1/C2 level with complex or showy constructions. At the same time the German must not be weak or full of errors, since the candidate genuinely holds a B2 certificate. Aim for clear, correct, natural B2: solid grammar, everyday and professional vocabulary, mostly straightforward sentence structures with some variety.

WORD COUNT — treat this as an absolute rule, never break it:
- The letter must be between 250 and 320 words. Aim for the upper part of the range, ideally 300 to 320 words. Do not deliver the bare minimum.
- The reader at the embassy will not count words, but a fuller letter gives more room to make a convincing case, so use that space to strengthen the application, not to pad with empty phrases.
- After writing, count every single word one by one. Do not estimate or guess the count.
- If the count is below 300 or above 320, rewrite and recount until it lands between 300 and 320. Never output a letter you have not counted. Getting this wrong is not acceptable.

CONTENT — the letter must cover these three points clearly (this is exactly what the German embassy requires):
1. The reasons for wanting to do the recognition / qualification measure (Anpassungsmaßnahme) in Germany, and why nursing. Tie it to the candidate's real background from the CV.
2. The candidate's plans for their professional future in Germany after the recognition is complete.
3. Where, when and how the candidate learned German, current level, and how they intend to improve it.
- Use the extra word room to add genuine, CV-based substance that raises the chance of acceptance: a concrete clinical situation the candidate handled, a specific reason Germany suits their goals, a clear sense of commitment to staying and completing the recognition. Everything added must be believable and grounded in the CV.
- The letter MUST always end with a polite closing sentence thanking the embassy for reviewing the application, for example: "Ich danke Ihnen herzlich für die Prüfung meines Antrags und freue mich auf die Gelegenheit, meinen Beruf in Deutschland ausüben zu dürfen." Vary the wording slightly each time so it does not look templated.

UNIQUENESS — mandatory, treat it as a hard rule:
- Every letter MUST have a different writing style from every other candidate. Two candidates must never receive a letter that opens the same way, follows the same structure, or reuses the same sentences.
- Pick ONE opening approach and do not always use the same one: a personal memory or moment that drew them to nursing; a concrete scene from a clinical placement; a plain start with name and qualification; what nursing means to them; a specific patient experience.
- Vary the ORDER of the three required points. Do not always go intro then Germany then language. Sometimes lead with the language, sometimes with the future goal, sometimes with the clinical experience. All three must be present but the sequence must change.
- Vary the number of paragraphs (between 3 and 5), the paragraph lengths, and the sentence rhythm.
- Pull DIFFERENT specific details from each CV. One letter might highlight the emergency room, another pediatrics, another oncology or dialysis. Never default to the same specialty for everyone.
- Vary the tone within a believable range: some candidates warmer and more emotional, others calmer and more factual, others more determined and goal focused. Match the tone loosely to the candidate's age and background.
- Do not reuse signature phrases across candidates.

STYLE — critical:
- It MUST read as if written by a real human being, a Moroccan nurse writing earnestly in German, not by an AI. It MUST pass any AI-detection check. Do not write in a polished, symmetrical, list-like or templated way.
- Vary sentence length. Mix short, direct sentences with one or two longer ones. Do not start consecutive sentences the same way.
- Use concrete, specific, personal details from the CV. Avoid generic filler like "I am passionate about helping people."
- Avoid overused AI phrases such as "Ich bin fest davon überzeugt", "Es erfüllt mich mit Stolz", "in der heutigen Zeit", "nicht nur, sondern auch".
- A small natural imperfection in rhythm is fine and welcome. Do not make it sound machine-perfect.
- Warm, sincere, professional tone. First person. Honest, not exaggerated.

Now write the body text based on this CV:

[CANDIDATE PASTES CV HERE]`;
