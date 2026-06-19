/**
 * Boundary "answer-tightener" — makes the bot READ like the founder wants (terse,
 * direct, no fluff), enforced in CODE so it holds no matter how the model phrases
 * things. Same philosophy as stripMarkdown: a small model reliably forgets the
 * "no preamble / no closers" rule, so we strip the worst offenders at the edge.
 *
 * The founder's pet peeves (seen repeatedly in his real chat):
 *   • robotic OPENERS — "Okay, …", "Alright, …", "Sure, …", "Of course, …"
 *   • trailing CLOSERS — "Anything else?", "Let me know if…", "What do you need?"
 *   • UNSOLICITED model-identity preamble before the real answer — e.g.
 *     "The API I'm using is Claude, not Gemini. Here's the email …"
 *
 * Conservative on purpose: it only strips clearly-canned filler, and never empties a
 * genuine one-word answer (a bare "Okay." with nothing after is kept; "which model?"
 * → the identity sentence IS the whole answer, so it survives).
 */

// Canned acknowledgement openers (kept: "Got it" / "Done" — the founder USES those).
const OPENER = /^(?:okay|ok|alright|all right|sure|certainly|of course|no problem|absolutely|understood|great|perfect|right)[,.:!]+\s+(?=\S)/i;

// Trailing closer/filler lines the founder dislikes (anchored to the very end).
const CLOSER = /\s*(?:\n+\s*)?(?:(?:is there |is there anything |anything |something )?(?:else|anything else)[^.\n?]*\?|let me know if[^\n.]*\.?|hope (?:this|that) helps[^\n.]*\.?|what (?:do you need|else)\b[^\n]*\??|what'?s up\??|happy to help[^\n]*\.?|feel free to[^\n.]*\.?)\s*$/i;

export function tightenReply(s: string): string {
  let t = (s || "").trim();
  if (!t) return t;

  // 1) Drop a robotic opener (only when real content follows).
  t = t.replace(OPENER, "");

  // 2) Drop an UNSOLICITED model-identity sentence prepended before the real answer.
  //    Only when there's substantive content AFTER it — so a genuine "which model?"
  //    answer (where the identity IS the whole reply) is left intact.
  const idLead = t.match(/^[^.!?\n]*\bclaude\b[^.!?\n]*[.!?]+\s+/i);
  if (idLead && /\b(gemini|anthropic|google|api|model)\b/i.test(idLead[0]) && t.length > idLead[0].length + 12) {
    t = t.slice(idLead[0].length).trimStart();
  }

  // 3) Strip trailing canned closers (twice, in case two are stacked).
  t = t.replace(CLOSER, "").trimEnd();
  t = t.replace(CLOSER, "").trimEnd();

  return t.trim();
}
