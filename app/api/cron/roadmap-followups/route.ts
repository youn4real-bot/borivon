import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { sendRoadmapFollowupEmail } from "@/lib/email";
import { tgSend } from "@/lib/telegram";
import { followupMail } from "@/lib/roadmap/emails";
import {
  dueFollowup, parseDetails, needsListSync, wantedListState, isExpired, anonymizedDetails,
  type RoadmapDetails,
} from "@/lib/roadmap/leadState";
import { addLeadToList, setListSubscribed, removeFromList, listAccess } from "@/lib/roadmap/resendList";
import { signLeadToken, tokensEnabled } from "@/lib/roadmap/token";
import { LANGS, type Lang } from "@/lib/roadmap/content";
import type { RoadmapResult } from "@/lib/roadmap/score";
import { COST_PER_OPEN_POST_MONTH } from "@/lib/roadmap/score";

/**
 * Daily 09:30 UTC (morning in Germany), three jobs for the Fahrplan leads:
 *
 * 1 · Follow-ups. Only leads that ticked "tips" AND confirmed by button (double
 *     opt-in), never after an unsubscribe, one mail per lead per run, at most 4
 *     in total (FOLLOWUP_DAYS). Step is saved right after each send, so a rerun
 *     the same day sends nothing twice.
 * 2 · The Resend email list. Every lead whose list state is not provably right
 *     (details.list) is synced: unsubscribed until the double opt-in. Repairs
 *     any Resend hiccup at submit/confirm/unsubscribe time. A key without
 *     contact rights (401/403) stops the loop and pings the founder once.
 * 3 · Retention (privacy policy §11, 12 months like contact-form data): leads
 *     with no activity for RETENTION_DAYS lose name, email, phone and house;
 *     the numbers stay for statistics; the contact leaves the Resend list.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_MAILS_PER_RUN = 60;
const MAX_LIST_SYNC_PER_RUN = 100;

type Row = { id: string; email: string; name: string; details: unknown; created_at: string };

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db.from("leads")
    .select("id,email,name,details,created_at")
    .eq("kind", "roadmap")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (data ?? []) as Row[];
  const now = new Date();
  // The freshest details per lead: each job saves on top of what the one before wrote.
  const current = new Map<string, RoadmapDetails>(rows.map((r) => [r.id, parseDetails(r.details)]));
  const save = async (id: string, next: RoadmapDetails, tag: string) => {
    const { error: upErr } = await db.from("leads").update({ details: next }).eq("id", id);
    if (upErr) { console.error(`[roadmap-followups] ${tag} save failed:`, id, upErr.message); return false; }
    current.set(id, next);
    return true;
  };

  // 1 · follow-ups
  let sent = 0, failed = 0;
  if (tokensEnabled()) {
    for (const row of rows) {
      if (sent >= MAX_MAILS_PER_RUN) break;
      const d = current.get(row.id)!;
      const n = dueFollowup(d, now);
      if (n === null) continue;
      const lang: Lang = LANGS.includes(d.lang as Lang) ? (d.lang as Lang) : "de";
      const unsubscribeUrl = `https://borivon.com/api/roadmap/unsubscribe?id=${encodeURIComponent(row.id)}&t=${await signLeadToken("unsub", row.id)}`;
      const result = { perNurseMonth: COST_PER_OPEN_POST_MONTH } as RoadmapResult;
      const m = followupMail(n, { lang, firstName: d.firstName || row.name || "", result, unsubscribeUrl });
      if (!m) continue;
      const ok = await sendRoadmapFollowupEmail({ to: row.email, subject: m.subject, html: m.html, text: m.text, unsubscribeUrl });
      if (!ok) { failed++; continue; }
      sent++;
      await save(row.id, { ...d, seq: { step: n + 1, lastSentAt: now.toISOString() } }, "step");
    }
  }

  // 2 · the email list
  const access = await listAccess();
  let listed = 0, listFailed = 0;
  const pending = rows.filter((r) => needsListSync(current.get(r.id)!) && !r.email.endsWith("@invalid"));
  if (pending.length && (access.status === 401 || access.status === 403)) {
    const chat = (process.env.TELEGRAM_CHAT_ID || "").trim();
    if (chat) {
      try { await tgSend(chat, `Resend: der API-Schlüssel darf keine Kontakte verwalten (${access.status}). ${pending.length} Fahrplan-Leads fehlen auf der E-Mail-Liste.`); }
      catch (e) { console.error("[roadmap-followups] telegram failed:", e instanceof Error ? e.message : e); }
    }
  } else if (access.ok) {
    for (const row of pending.slice(0, MAX_LIST_SYNC_PER_RUN)) {
      const d = current.get(row.id)!;
      const want = wantedListState(d);
      const r = want === "subscribed" ? await setListSubscribed(row.email, true)
        : d.unsubscribedAt ? await setListSubscribed(row.email, false)
        : await addLeadToList({ email: row.email, firstName: String(d.firstName ?? ""), lastName: String(d.lastName ?? "") });
      if (!r.ok) { listFailed++; continue; }
      if (await save(row.id, { ...d, list: { state: want, at: now.toISOString() } }, "list")) listed++;
    }
  }

  // 3 · retention
  let anonymized = 0;
  for (const row of rows) {
    const d = current.get(row.id)!;
    if (!isExpired(d, row.created_at, now)) continue;
    if (row.email && !row.email.endsWith("@invalid")) await removeFromList(row.email);
    const level = (d.result as { level?: number } | undefined)?.level;
    const { error: anErr } = await db.from("leads").update({
      email: `anonymized-${row.id}@invalid`, name: "", phone: "",
      message: `Stufe ${level ?? "?"} (anonymisiert)`,
      details: anonymizedDetails(d, now),
    }).eq("id", row.id);
    if (anErr) console.error("[roadmap-followups] anonymize failed:", row.id, anErr.message);
    else anonymized++;
  }

  console.warn(`[roadmap-followups] sent=${sent} failed=${failed} listAccess=${access.status ?? "none"} listed=${listed} listFailed=${listFailed} pending=${pending.length} anonymized=${anonymized}`);
  return NextResponse.json({ ok: true, sent, failed, list: { access: access.status ?? null, synced: listed, failed: listFailed, pending: pending.length }, anonymized });
}
