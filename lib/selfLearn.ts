/**
 * SELF-LEARNING — so the founder corrects the bot ONCE and it sticks, without
 * ever saying "remember this". When a message looks like a correction / teaching /
 * frustration, the CODE (not the flaky Flash model) runs a tiny reflection pass
 * that distils a durable RULE and saves it to assistant_memory — which is injected
 * into every future chat as a binding standing instruction. The bot then behaves
 * differently next time. This is the "it learns me like normal Claude/ChatGPT"
 * the founder asked for, made reliable in code instead of hoping the model calls
 * rememberAboutMe.
 */
import { generateText } from "ai";
import { saveMemory } from "@/lib/assistantMemory";

// Language that signals a correction, a lasting preference, or frustration worth
// reflecting on. Broad on purpose (missing a correction = not learning), but the
// reflection itself returns NONE for anything with no lasting rule, so a false
// trigger just costs one tiny call and saves nothing.
const CORRECTION_RE =
  /\b(don'?t|do not|stop|never|always|from now on|going forward|i (told|said|asked|want)|you (should|shouldn'?t|keep|always|never|need to|must|can'?t)|why (do|are|did|is|does) (you|it|this|that)|that'?s not|not what i|i prefer|prefer(red)? (that|if|to)|remember (to|that)|make sure|next time|instead of|rather than|quit|no more|i hate|too (much|many|often)|every (time|single)|keep (doing|forgetting|reminding|sending|asking)|lied|wrong|fix (it|this|that)|fucking|bullshit|annoying|insane)\b/i;

/** Does this message look like a correction / teaching / frustration? */
export function looksLikeCorrection(text: string): boolean {
  const n = (text || "").trim();
  if (n.length < 4 || n.length > 700) return false;
  return CORRECTION_RE.test(n);
}

const REFLECT_SYS =
  "You are the self-improvement reflector for a Telegram ops bot used by the founder of a Moroccan-nurses-to-Germany recruitment agency. The founder just said something that may teach a LASTING rule about how the bot should behave. Output ONE durable, general, imperative rule (max 180 chars) the bot should follow FROM NOW ON — or the single word NONE if there is nothing lasting to learn (a one-off task, transient fact, or just venting). Capture HOW the founder wants the bot to behave, never one-time data, a specific candidate's status, or a single task. Examples of good rules: \"Never list missing/pending documents in reminders unless I ask.\" \"When showing an email I'm about to send, show the exact attachment filenames.\" \"Answer questions about how you work directly; never repeat a canned status line.\" \"Be blunt and brief; skip the apologies.\" Output ONLY the rule text, or NONE — no quotes, no preamble, no explanation.";

/** Reflect on a correction and, if there's a durable rule, learn it (save to
 *  memory). Returns the rule learned, or null. Never throws. */
export async function reflectAndLearn(
  adminUserId: string | null,
  userMsg: string,
  botReply: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
): Promise<string | null> {
  if (!adminUserId || !model) return null;
  try {
    const res = await generateText({
      model,
      system: REFLECT_SYS,
      messages: [{
        role: "user",
        content: `Founder said:\n"${(userMsg || "").slice(0, 900)}"\n\nThe bot's last reply / action was:\n"${(botReply || "").slice(0, 500)}"\n\nThe lasting rule (or NONE):`,
      }],
      temperature: 0.2,
      maxOutputTokens: 200, // one short rule (<220 chars) — and Claude REQUIRES max_tokens
    });
    const rule = (res.text || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!rule || /^none\b/i.test(rule) || rule.length < 8 || rule.length > 220) return null;
    const saved = await saveMemory(adminUserId, rule, "correction");
    return saved ? rule : null; // null if it was already known (don't re-announce)
  } catch {
    return null;
  }
}
