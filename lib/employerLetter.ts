/**
 * Employer motivation letter (Motivationsschreiben) — the AI prompt.
 *
 * Twin of lib/visaLetter.ts VISA_PROMPT, but aimed at the EMPLOYER (the hospital
 * / clinic the candidate is assigned to) instead of the Embassy. Same discipline:
 * CV-only facts, realistic B2 German, 250-320 words counted, human-sounding,
 * never templated across candidates.
 *
 * Borivon-internal: the "Copy prompt" button on the employer builder (admin-only)
 * copies this verbatim with [EMPLOYER NAME] + the CV already substituted, so an
 * admin can paste it into any AI and get a draft ALIGNED WITH THAT EMPLOYER.
 * Edit here — single source of truth for the button.
 */

export const EMPLOYER_NAME_PLACEHOLDER = "[EMPLOYER NAME]";
export const CV_PLACEHOLDER = "[CANDIDATE PASTES CV HERE]";

export const EMPLOYER_PROMPT = `You are writing the body text of a Motivationsschreiben (job application letter) from a Moroccan nurse applying to work at ${EMPLOYER_NAME_PLACEHOLDER} in Germany, through the recognition pathway (Anerkennung / Anpassungsmaßnahme). I will paste a CV at the bottom. Use ONLY the information in that CV. Never invent qualifications, experiences, or facts that are not in the CV.

OUTPUT RULES — follow exactly:
- Output ONLY the inside body text. No sender address, no recipient address, no date, no "Sehr geehrte Damen und Herren," and no "Mit freundlichen Grüßen" or signature. Just the paragraphs that go between the greeting and the closing.
- No bullet points, no headings, no bold. Plain paragraphs only.
- Never use the dash character "—" or any long dash. Use commas, full stops, or the word "und" instead.

THE EMPLOYER — this is the whole point of the letter:
- The letter is addressed to ${EMPLOYER_NAME_PLACEHOLDER}. Name them naturally in the letter at least once, exactly as written above, and make it unmistakable that this letter was written FOR THEM and not for a generic hospital.
- Give a believable, specific reason why THIS employer: connect the candidate's real experience or specialty from the CV to what a house like this does. Never write something that would read identically if you swapped in another hospital's name.
- Do NOT invent facts about the employer (no made-up departments, awards, bed counts, or history). If you do not know something about them, stay general about the employer and specific about the candidate.

LANGUAGE & LEVEL:
- The letter MUST always be written in German (auf Deutsch). Any other language is only for the candidate's own understanding and is never the document submitted.
- The German level MUST stay at a realistic B2. The candidate obtained B2 in Morocco and has not lived in Germany, so do not write at C1/C2 level with complex or showy constructions. At the same time the German must not be weak or full of errors, since the candidate genuinely holds a B2 certificate. Aim for clear, correct, natural B2: solid grammar, everyday and professional vocabulary, mostly straightforward sentence structures with some variety.

WORD COUNT — treat this as an absolute rule, never break it:
- The letter must be between 250 and 320 words. Aim for the upper part of the range, ideally 300 to 320 words. Do not deliver the bare minimum.
- The reader at the hospital will not count words, but a fuller letter gives more room to make a convincing case, so use that space to strengthen the application, not to pad with empty phrases.
- After writing, count every single word one by one. Do not estimate or guess the count.
- If the count is below 300 or above 320, rewrite and recount until it lands between 300 and 320. Never output a letter you have not counted. Getting this wrong is not acceptable.

CONTENT — the letter must cover these points clearly (this is what a German employer wants to read):
1. Who the candidate is professionally and why nursing, tied to their real background from the CV.
2. Why they want to work at ${EMPLOYER_NAME_PLACEHOLDER} in Germany specifically, and what draws them to this position.
3. What they BRING: concrete clinical experience, specialty and strengths taken from the CV, expressed as value to the team and the patients, not as a list.
4. Where, when and how they learned German, their current level, and how they intend to keep improving it at work.
5. Their commitment: completing the recognition (Anerkennung), settling in Germany long term, and readiness to start.
- Use the extra word room to add genuine, CV-based substance that raises the chance of being invited: a concrete clinical situation the candidate handled, a specific strength the department would feel, a clear sense of reliability and commitment. Everything added must be believable and grounded in the CV.
- The letter MUST always end with a polite closing sentence thanking them for considering the application and expressing hope for a personal interview, for example: "Ich danke Ihnen für die Berücksichtigung meiner Bewerbung und würde mich sehr über die Gelegenheit zu einem persönlichen Gespräch freuen." Vary the wording slightly each time so it does not look templated.

UNIQUENESS — mandatory, treat it as a hard rule:
- Every letter MUST have a different writing style from every other candidate. Two candidates must never receive a letter that opens the same way, follows the same structure, or reuses the same sentences.
- Pick ONE opening approach and do not always use the same one: a personal memory or moment that drew them to nursing; a concrete scene from a clinical placement; a plain start with name and qualification; what nursing means to them; a specific patient experience.
- Vary the ORDER of the required points. Do not always go intro then employer then language. Sometimes lead with the clinical experience, sometimes with what draws them to the employer, sometimes with the language. All points must be present but the sequence must change.
- Vary the number of paragraphs (between 3 and 5), the paragraph lengths, and the sentence rhythm.
- Pull DIFFERENT specific details from each CV. One letter might highlight the emergency room, another pediatrics, another oncology or dialysis. Never default to the same specialty for everyone.
- Vary the tone within a believable range: some candidates warmer and more emotional, others calmer and more factual, others more determined and goal focused. Match the tone loosely to the candidate's age and background.
- Do not reuse signature phrases across candidates.

STYLE — critical:
- It MUST read as if written by a real human being, a Moroccan nurse writing earnestly in German, not by an AI. It MUST pass any AI-detection check. Do not write in a polished, symmetrical, list-like or templated way.
- Vary sentence length. Mix short, direct sentences with one or two longer ones. Do not start consecutive sentences the same way.
- Use concrete, specific, personal details from the CV. Avoid generic filler like "I am passionate about helping people."
- Avoid overused AI phrases such as "Ich bin fest davon überzeugt", "Es erfüllt mich mit Stolz", "in der heutigen Zeit", "nicht nur, sondern auch".
- Do not grovel or oversell. A German employer reads confidence and honesty better than flattery.
- A small natural imperfection in rhythm is fine and welcome. Do not make it sound machine-perfect.
- Warm, sincere, professional tone. First person. Honest, not exaggerated.

Now write the body text for an application to ${EMPLOYER_NAME_PLACEHOLDER}, based on this CV:

${CV_PLACEHOLDER}`;

/** Fill the prompt with the assigned employer + the candidate's CV text. */
export function buildEmployerPrompt(employerName: string, cvText: string): string {
  const employer = (employerName || "").trim() || "the employer";
  return EMPLOYER_PROMPT.split(EMPLOYER_NAME_PLACEHOLDER).join(employer)
    .replace(CV_PLACEHOLDER, (cvText || "").trim() || CV_PLACEHOLDER);
}
