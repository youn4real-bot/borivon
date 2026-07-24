/**
 * Orchestration for dropped-commitment tracking — kept separate from the PURE
 * helpers in lib/commitments.ts (which stay import-light + unit-tested).
 *
 * Two jobs:
 *   SCAN  — read recent INBOUND email, have the model pull out promises other
 *           people made to the founder, store the new ones.
 *   CHASE — surface the ones that went past due, minimalist, once per gate.
 *
 * Rides the crons that already fire (Hobby caps crons at once/day), exactly like
 * lib/inboxSlaRun.ts. Fail-safe throughout: no Gmail, no model, or an un-run
 * migration all degrade to a silent no-op — never a crash, never spam.
 */
import { generateText } from "ai";
import { gmailSearch, gmailGet } from "@/lib/gmailApi";
import { vertexModel, GEMINI_SAFETY } from "@/lib/vertexModel";
import { tgSend } from "@/lib/telegram";
import { isBotQuiet } from "@/lib/botQuiet";
import { isAutomationEnabled } from "@/lib/automationSettings";
import {
  recordCommitments, listOpenCommitments, markCommitmentNudged,
  isCommitmentNudgeable, formatCommitments,
  type ExtractedCommitment, type Commitment,
} from "@/lib/commitments";

const EXTRACT_SYS = `You read a business email and extract ONLY explicit promises the SENDER made to the recipient.

A promise is the sender committing to DELIVER or DO something specific — "I'll send the Fahrplan", "we will forward the contract Friday", "ich schicke dir die Unterlagen morgen".

STRICT RULES:
- ONLY promises made BY THE SENDER. Never anything the recipient owes.
- Ignore pleasantries, vague intent ("let's stay in touch", "we'll see"), marketing, auto-replies, newsletters.
- Ignore anything already delivered in that same email (e.g. "attached you'll find X").
- "what" = the specific thing, 2-8 words, no leading article. e.g. "Fahrplan", "signed contract", "list of open positions".
- "due" = ISO date YYYY-MM-DD ONLY if the sender stated a concrete deadline. Otherwise null.

Output STRICT JSON, no prose, no code fence:
{"promises":[{"what":"...","due":"YYYY-MM-DD"|null}]}
If there are no real promises output exactly {"promises":[]}`;

/** Parse the model's JSON. Tolerant of a stray code fence. Never throws. PURE-ish. */
export function parseExtractedPromises(raw: string): { what: string; due: string | null }[] {
  try {
    const cleaned = (raw || "").replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as { promises?: unknown };
    if (!Array.isArray(obj.promises)) return [];
    return obj.promises
      .map((p) => {
        const o = p as { what?: unknown; due?: unknown };
        const what = typeof o.what === "string" ? o.what.trim() : "";
        const dueRaw = typeof o.due === "string" ? o.due.trim() : "";
        const due = /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
        return { what, due };
      })
      .filter((p) => p.what.length > 2 && p.what.length <= 120);
  } catch { return []; }
}

/**
 * SCAN recent inbound email for promises. Returns how many NEW ones were stored.
 * Bounded on purpose (a handful of recent messages) so it stays cheap on the
 * cron and can never run away.
 */
export async function runCommitmentScan(ownerUserId: string, lookbackDays = 7, maxEmails = 12): Promise<number> {
  if (!ownerUserId) return 0;
  try {
    if (!(await isAutomationEnabled("commitments"))) return 0;
    const model = vertexModel("flash");
    if (!model) return 0;
    // Real inbound mail only — skip my own sends, promos, and noise.
    const found = await gmailSearch(
      `in:inbox newer_than:${lookbackDays}d -from:me -category:promotions -category:social`,
      maxEmails,
    );
    if (!found?.length) return 0;

    const extracted: ExtractedCommitment[] = [];
    for (const s of found) {
      const full = await gmailGet(s.id, 6000);
      if (!full?.body) continue;
      let text = "";
      try {
        const res = await generateText({
          model,
          system: EXTRACT_SYS,
          messages: [{
            role: "user",
            content: `From: ${full.fromName} <${full.from}>\nSubject: ${full.subject}\nDate: ${full.date}\n\n${full.body.slice(0, 4000)}`,
          }],
          temperature: 0,
          // Flash shares this budget with thinking tokens; thinking is pure
          // overhead for a small extraction, so disable it and leave room for JSON.
          maxOutputTokens: 800,
          providerOptions: {
            vertex: { thinkingConfig: { thinkingBudget: 0 }, safetySettings: GEMINI_SAFETY },
            google: { thinkingConfig: { thinkingBudget: 0 }, safetySettings: GEMINI_SAFETY },
          },
        });
        text = res.text || "";
      } catch { continue; }

      for (const p of parseExtractedPromises(text)) {
        extracted.push({
          who_email: full.from,
          who_name: full.fromName,
          what: p.what,
          due_at: p.due ? new Date(`${p.due}T12:00:00Z`).toISOString() : null,
          source_message_id: full.id,
          source_subject: full.subject,
          promised_at: full.date ? new Date(full.date).toISOString() : new Date().toISOString(),
        });
      }
    }
    return await recordCommitments(ownerUserId, extracted);
  } catch { return 0; }
}

/**
 * CHASE the promises that went past due. Minimalist by standing rule — the bare
 * list, nothing else. Honours the global quiet switch (proactive messages are
 * suppressed while it's on; the on-demand bot tool still works).
 */
export async function runCommitmentChase(
  chatId: string, ownerUserId: string,
): Promise<{ sent: boolean; count: number; skipped?: string }> {
  if (!chatId || !ownerUserId) return { sent: false, count: 0, skipped: "no_chat" };
  try {
    if (await isBotQuiet()) return { sent: false, count: 0, skipped: "quiet" };
    if (!(await isAutomationEnabled("commitments"))) return { sent: false, count: 0, skipped: "disabled" };
    const open = await listOpenCommitments(ownerUserId, 50);
    const now = Date.now();
    const due: Commitment[] = open.filter((c) => isCommitmentNudgeable(c, now));
    if (!due.length) return { sent: false, count: 0 };
    await tgSend(chatId, `Not delivered yet:\n${formatCommitments(due, now)}`);
    await markCommitmentNudged(ownerUserId, due);
    return { sent: true, count: due.length };
  } catch { return { sent: false, count: 0, skipped: "error" }; }
}
