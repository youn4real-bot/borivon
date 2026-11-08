import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { sendRoadmapFollowupEmail, sendAdminAlertEmail } from "@/lib/email";
import { followupMail } from "@/lib/roadmap/emails";
import {
  dueFollowup, deliveryDue, parseDetails, needsListSync, wantedListState, isExpired, anonymizedDetails,
  type RoadmapDetails,
} from "@/lib/roadmap/leadState";
import { setListSubscribed, removeFromList, listAccess } from "@/lib/roadmap/resendList";
import { tokensEnabled } from "@/lib/roadmap/token";
import { asSalutation } from "@/lib/roadmap/consent";
import { deliverRoadmap, unsubscribeLink, leadLang } from "@/lib/roadmap/delivery";
import { deleteHosted } from "@/lib/roadmap/hosted";
import { scoreRoadmap, normalizeAnswers, type RoadmapAnswers } from "@/lib/roadmap/score";

/**
 * Daily 09:30 UTC (morning in Germany), four jobs for the Fahrplan leads:
 *
 * 0 · PDF retry. A lead that confirmed but whose PDF mail failed gets another
 *     try (at most 3 in total, lib/roadmap/leadState.deliveryDue).
 * 1 · Follow-ups. Only confirmed leads (double opt-in) whose PDF went out,
 *     never after an unsubscribe, one mail per lead per run, at most 4 in total
 *     (FOLLOWUP_DAYS). Step is saved right after each send, so a rerun the same
 *     day sends nothing twice.
 * 2 · The Resend email list. Confirmed leads whose list state is not provably
 *     right (details.list) are synced; unconfirmed ones never touch the list.
 *     A key without contact rights (401/403) stops the loop and emails the
 *     founder.
 * 3 · Retention: confirmed leads with no activity for 12 months, unconfirmed
 *     requests after 30 days, lose name, email and house; the numbers stay for
 *     statistics; the contact leaves the Resend list.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_MAILS_PER_RUN = 60;
const MAX_DELIVERIES_PER_RUN = 10;
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

  // 0 · PDF retry
  let delivered = 0, undelivered = 0;
  if (tokensEnabled()) {
    for (const row of rows) {
      if (delivered + undelivered >= MAX_DELIVERIES_PER_RUN) break;
      const d = current.get(row.id)!;
      if (!deliveryDue(d, now)) continue;
      const r = await deliverRoadmap(db, { id: row.id, email: row.email, details: d });
      current.set(row.id, r.details);
      if (r.ok) delivered++; else undelivered++;
    }
  }

  // 1 · follow-ups
  let sent = 0, failed = 0;
  if (tokensEnabled()) {
    for (const row of rows) {
      if (sent >= MAX_MAILS_PER_RUN) break;
      const d = current.get(row.id)!;
      const n = dueFollowup(d, now);
      if (n === null) continue;
      const lang = leadLang(d);
      const unsubscribeUrl = await unsubscribeLink(row.id);
      // same numbers as their PDF (no agency cost when they have no agency staff)
      const answers = normalizeAnswers((d.answers ?? {}) as Partial<RoadmapAnswers>);
      const facilityType = answers.facilityType;
      const result = scoreRoadmap(answers);
      const m = followupMail(n, { lang, salutation: asSalutation(d.salutation), lastName: String(d.lastName ?? ""), firstName: String(d.firstName ?? ""), result, unsubscribeUrl, facilityType });
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
    await sendAdminAlertEmail(
      "Resend: Schlüssel darf keine Kontakte verwalten",
      `Der Resend-API-Schlüssel darf keine Kontakte verwalten (${access.status}). ${pending.length} bestätigte Fahrplan-Leads fehlen auf der E-Mail-Liste oder sind dort falsch eingetragen.\n\nBitte in Resend einen Schlüssel mit "Full access" anlegen und als RESEND_API_KEY setzen.`,
    );
  } else if (access.ok) {
    for (const row of pending.slice(0, MAX_LIST_SYNC_PER_RUN)) {
      const d = current.get(row.id)!;
      const want = wantedListState(d);
      if (!want) continue;
      const r = await setListSubscribed(row.email, want === "subscribed", fetch, { lastName: String(d.lastName ?? "") });
      if (!r.ok) { listFailed++; continue; }
      if (await save(row.id, { ...d, list: { state: want, at: now.toISOString() } }, "list")) listed++;
    }
  }

  // 3 · retention
  let anonymized = 0;
  for (const row of rows) {
    const d = current.get(row.id)!;
    if (!isExpired(d, row.created_at, now)) continue;
    if (row.email && !row.email.endsWith("@invalid") && d.list?.state) await removeFromList(row.email);
    await deleteHosted(row.id); // the stored PDFs carry name + house
    const level = (d.result as { level?: number } | undefined)?.level;
    const { error: anErr } = await db.from("leads").update({
      email: `anonymized-${row.id}@invalid`, name: "", phone: "",
      message: `Stufe ${level ?? "?"} (anonymisiert)`,
      details: anonymizedDetails(d, now),
    }).eq("id", row.id);
    if (anErr) console.error("[roadmap-followups] anonymize failed:", row.id, anErr.message);
    else anonymized++;
  }

  console.warn(`[roadmap-followups] delivered=${delivered} undelivered=${undelivered} sent=${sent} failed=${failed} listAccess=${access.status ?? "none"} listed=${listed} listFailed=${listFailed} pending=${pending.length} anonymized=${anonymized}`);
  return NextResponse.json({ ok: true, delivered, undelivered, sent, failed, list: { access: access.status ?? null, synced: listed, failed: listFailed, pending: pending.length }, anonymized });
}
