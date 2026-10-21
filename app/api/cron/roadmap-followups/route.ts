import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { sendRoadmapFollowupEmail } from "@/lib/email";
import { followupMail } from "@/lib/roadmap/emails";
import { dueFollowup, parseDetails } from "@/lib/roadmap/leadState";
import { signLeadToken, tokensEnabled } from "@/lib/roadmap/token";
import { LANGS, type Lang } from "@/lib/roadmap/content";
import type { RoadmapResult } from "@/lib/roadmap/score";
import { COST_PER_OPEN_POST_MONTH } from "@/lib/roadmap/score";

/**
 * Daily 09:30 UTC (morning in Germany): the Fahrplan follow-up series.
 *
 * Only leads that ticked "tips" AND confirmed by button (double opt-in), never
 * after an unsubscribe, one mail per lead per run, at most 4 in total
 * (FOLLOWUP_DAYS). Step is saved right after each send, so a rerun the same day
 * sends nothing twice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PER_RUN = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("forbidden", { status: 403 });
  }
  if (!tokensEnabled()) return NextResponse.json({ ok: true, skipped: "no token secret" });

  const db = getServiceSupabase();
  const { data, error } = await db.from("leads")
    .select("id,email,name,details,created_at")
    .eq("kind", "roadmap")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const now = new Date();
  let sent = 0, failed = 0;
  for (const row of (data ?? []) as { id: string; email: string; name: string; details: unknown }[]) {
    if (sent >= MAX_PER_RUN) break;
    const d = parseDetails(row.details);
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
    const next = { ...d, seq: { step: n + 1, lastSentAt: now.toISOString() } };
    const { error: upErr } = await db.from("leads").update({ details: next }).eq("id", row.id);
    if (upErr) console.error("[roadmap-followups] step save failed:", row.id, upErr.message);
  }
  console.warn(`[roadmap-followups] sent=${sent} failed=${failed}`);
  return NextResponse.json({ ok: true, sent, failed });
}
