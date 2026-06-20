/**
 * Boundary "answer-tightener" — makes the bot READ like the founder wants (terse,
 * direct, no fluff), enforced in CODE so it holds no matter how the model phrases
 * things. Same philosophy as stripMarkdown: a small model reliably forgets the
 * "no preamble / no closers" rule, so we strip the worst offenders at the edge.
 *
 * Pet peeves (from his real chat): robotic OPENERS ("Okay,"/"Alright,"/"Sure,"),
 * trailing CLOSERS ("Anything else?"/"Let me know if…"), unsolicited next-step
 * OFFERS ("Want me to also…?"/"Should I…?"), and a model-identity preamble prepended
 * before the real answer ("The API I'm using is Claude, not Gemini. Here's the email…").
 *
 * CRITICAL: when the reply carries an email/message preview ("info ——— body"), the
 * BODY is the exact content that will be sent — it must pass through VERBATIM. So we
 * only tighten the head (the info line / normal chat) and never the body. And we never
 * EMPTY a reply that was only a genuine clarifying question.
 */

// Canned acknowledgement openers (kept: "Got it" / "Done" — the founder USES those).
const OPENER = /^(?:okay|ok|alright|all right|sure|certainly|of course|no problem|absolutely|understood|great|perfect|right)[,.:!]+\s+(?=\S)/i;

// Trailing closer/filler lines the founder dislikes (anchored to the very end).
const CLOSER = /\s*(?:\n+\s*)?(?:(?:is there |is there anything |anything |something )?(?:else|anything else)[^.\n?]*\?|let me know if[^\n.]*\.?|hope (?:this|that) helps[^\n.]*\.?|what (?:do you need|else)\b[^\n]*\??|what'?s up\??|happy to help[^\n]*\.?|feel free to[^\n.]*\.?)\s*$/i;

// Trailing UNSOLICITED next-step offer ("Want me to also…?", "Should I…?") — he hates
// these (they re-surface topics he told it to stop volunteering).
const OFFER = /\s*(?:\n+\s*)?(?:do you (?:also )?want|want me to|should i|shall i|would you like(?: me)? to|m[öo]chtest du|soll ich|veux-?tu que je|tu veux que je)\b[^\n]*\?\s*$/i;

// An email/message preview divider ("info ——— body"); 3+ em/en/hyphen dashes on a line.
const DIVIDER = /\n[ \t]*[—–-]{3,}[ \t]*(?:\n|$)/;

function tightenHead(s: string): string {
  let t = s.trim();
  if (!t) return t;
  t = t.replace(OPENER, "");
  // Drop an UNSOLICITED model-identity sentence prepended before the real answer (only
  // when substantive content follows — a genuine "which model?" answer survives).
  const idLead = t.match(/^[^.!?\n]*\bclaude\b[^.!?\n]*[.!?]+\s+/i);
  if (idLead && /\b(gemini|anthropic|google|api|model)\b/i.test(idLead[0]) && t.length > idLead[0].length + 12) {
    t = t.slice(idLead[0].length).trimStart();
  }
  const beforeStrip = t;
  for (let i = 0; i < 2; i++) {
    t = t.replace(CLOSER, "").trimEnd();
    t = t.replace(OFFER, "").trimEnd();
  }
  // Never empty a reply that was ONLY a (clarifying) question/closer.
  if (!t.trim()) t = beforeStrip;
  return t.trim();
}

/** Turn a raw internal write-error CODE into one plain human line (the founder must
 *  never see a stack-trace-y 'attachment_missing:<uuid>' / 'out_of_scope'). */
export function humanizeWriteError(code: string): string {
  const c = (code || "").trim();
  const base = c.split(":")[0]; // drop ":<ids>" suffixes (e.g. attachment_missing:<uuid>)
  const map: Record<string, string> = {
    attachment_missing: "one of the files isn't ready (e.g. no CV on file yet)",
    out_of_scope: "I'm not allowed to act on that candidate",
    no_email: "that candidate has no email on file",
    no_recipients: "no one matched that group",
    workspace_not_connected: "email/calendar isn't connected right now",
    draft_failed: "email isn't connected right now",
    calendar_not_connected: "your calendar isn't connected right now",
    write_failed: "the save didn't go through — try once more",
    all_failed: "none of it went through — try once more",
    save_failed: "the save didn't go through — try once more",
    not_found: "I couldn't find that",
    unknown_or_inactive_employer: "that employer isn't on file / is retired",
    bad_email: "that email address looks off",
    bad_id: "I couldn't resolve that — try giving the name",
    leads_not_set_up: "the leads table isn't set up yet (run the migration)",
    leads_status_not_set_up: "the lead-status migration hasn't been run yet",
    needs_migration: "that needs a one-time database migration first",
    nothing_pending: "there was nothing pending to apply",
    confirm_in_new_message: 'send "yes" once more as its own message',
    email_not_configured: "email isn't configured right now",
  };
  return map[base] || map[c] || "something didn't go through — try once more";
}

export function tightenReply(s: string): string {
  const full = (s || "").trim();
  if (!full) return full;
  // If this carries an email/message preview, tighten ONLY the info head; the body
  // (everything from the divider on) passes through verbatim.
  const div = full.match(DIVIDER);
  if (div && div.index !== undefined) {
    return (tightenHead(full.slice(0, div.index)) + full.slice(div.index)).trim();
  }
  return tightenHead(full);
}
