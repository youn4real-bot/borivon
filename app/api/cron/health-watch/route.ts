import { NextRequest, NextResponse } from "next/server";
import { runHealthProbes, driveOnlyDocCount, publicSummary, type Probe } from "@/lib/healthProbes";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { tgSend, telegramConfigured } from "@/lib/telegram";
import { sendAdminAlertEmail } from "@/lib/email";

/**
 * HOURLY dependency watchdog — the thing that stops the founder being the bug finder.
 *
 * Every integration this portal leans on fails SILENTLY, by design:
 *   • Google: booking's busyIntervals() catches everything and returns [], so a dead
 *     calendar client produces a perfectly normal-looking slot list. The agency Drive
 *     mirror likewise just stops mirroring.
 *   • R2: the download/preview routes answer with an error the candidate reads as
 *     "the portal is broken", and she messages support instead of anyone reading a log.
 *   • Resend: a missing key means NO email goes out at all — including the one telling
 *     her a document blocking her job application was refused.
 * NOBODY reads Worker logs. So a broken integration used to surface as a candidate
 * complaint days later — that is the loop this closes.
 *
 * ALERT POLICY: SILENT WHEN HEALTHY. A message means something is genuinely broken.
 *
 * CHECKS hourly, ALERTS at most once per dependency per 6h (see the de-dup below).
 * Those are deliberately different numbers: it was daily, which meant a dependency
 * dying at 06:00 went unreported for 23 hours while candidates hit broken documents —
 * but alerting hourly would send 24 messages for one outage, and an alarm that fires
 * all day is one you stop reading.
 *
 * Recovery is signalled by the nagging stopping, not by a second message. Tracking
 * state to say "recovered" would need a table, and a watchdog that breaks because a
 * migration was not run is worse than no watchdog. So: no table, no migration, nothing
 * to run before this works — the de-dup rides the rate limiter that already exists.
 *
 * The probes live in lib/healthProbes.ts and are shared with GET /api/health?deep=1,
 * so the calibration of this alert can be checked from outside without a secret.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const probes = await runHealthProbes();
  const broken = probes.filter((p) => !p.ok);

  if (broken.length) {
    // Log FIRST — the alert can fail, the log is the fallback record.
    console.error("[health-watch] BROKEN:", broken.map((p) => `${p.name}: ${p.detail ?? ""}`).join(" | "));

    // ONE MESSAGE PER BROKEN DEPENDENCY PER 6 HOURS.
    //
    // This runs HOURLY, so without de-duplication a single dead dependency would
    // send 24 Telegram messages a day. An alarm that fires all day is one you
    // learn to swipe away, and then the real one gets swiped away too — the same
    // failure mode that made the per-isolate throttle in lib/reportError.ts
    // dangerous rather than merely noisy.
    //
    // So: hourly DETECTION (a break is noticed within the hour instead of within
    // a day, which is the whole point of the change) but a first alert
    // immediately and then at most one nag per dependency per 6 hours until it
    // recovers. Keyed PER DEPENDENCY, so Google breaking while R2 is already
    // broken still pages — the two are unrelated failures.
    //
    // Reuses the existing Postgres-backed limiter rather than inventing a state
    // table: one row, already shared across isolates, already fail-open. When the
    // DATABASE is the broken thing that fail-open means the alert may repeat —
    // which is correct, a dead database is worth being loud about.
    const ALERT_EVERY_MS = 6 * 60 * 60_000;
    const alertable: Probe[] = [];
    for (const p of broken) {
      try {
        const gate = await enforceUserRateLimit("health-alert", `dep:${p.name}`, { limit: 1, windowMs: ALERT_EVERY_MS });
        if (gate.ok) alertable.push(p);
      } catch {
        alertable.push(p); // never let the de-dup swallow a real alert
      }
    }
    if (alertable.length === 0) {
      return NextResponse.json({
        ok: false,
        probes: publicSummary(probes),
        alerted: false,   // still broken, already reported within the last 6h
        ts: new Date().toISOString(),
      });
    }

    if (telegramConfigured() && process.env.TELEGRAM_CHAT_ID) {
      // Minimalist per the founder's standing rule: the facts, nothing else.
      const lines = alertable.map((p) => `${p.name}: ${p.detail ?? "failed"}`);
      // Only when Google is what broke: say how many documents that actually takes
      // offline, so the message carries a decision rather than a shrug.
      if (alertable.some((p) => p.name === "google")) {
        const n = await driveOnlyDocCount();
        if (n !== null && n > 0) lines.push(`${n} document(s) served only from Drive are unreachable`);
      }
      try {
        await tgSend(process.env.TELEGRAM_CHAT_ID, `Portal dependency down\n${lines.join("\n")}`);
      } catch (e) {
        console.error("[health-watch] alert send failed:", e instanceof Error ? e.message : e);
      }
    }

    // ALSO EMAIL THE FOUNDER — the channel that survives the Telegram mute.
    //
    // When the whole portal went dark (the Supabase project dropped offline) the
    // only alarm was Telegram, which was deliberately silenced, so nobody was
    // told until users complained. A dependency being down is an emergency, not
    // a reminder: it must reach him even when the bot is parked. Email does not
    // touch the database or the Telegram gate, so it fires precisely when
    // everything else is down. Best-effort — an alert that can't send must not
    // break the cron.
    try {
      const lines = alertable.map((p) => `${p.name}: ${p.detail ?? "failed"}`);
      const dbDown = alertable.some((p) => p.name === "database");
      const subject = dbDown
        ? "🔴 Borivon portal DOWN — database unreachable"
        : `⚠️ Borivon portal — dependency down: ${alertable.map((p) => p.name).join(", ")}`;
      const body = [
        dbDown
          ? "The portal is DOWN: the Supabase database is unreachable, so login and all data fail."
          : "A portal dependency is failing:",
        "",
        ...lines,
        "",
        dbDown
          ? "Most likely the Supabase project is paused/suspended. Open https://supabase.com/dashboard, find the project and Restore/Resume it. Then check https://status.supabase.com."
          : "Check the affected service.",
        "",
        `Checked at ${new Date().toISOString()}.`,
      ].join("\n");
      await sendAdminAlertEmail(subject, body);
    } catch (e) {
      console.error("[health-watch] admin email alert failed:", e instanceof Error ? e.message : e);
    }
  }

  // ── UNREACHABLE DOCUMENTS — a standalone check, not a footnote ─────────────
  //
  // driveOnlyDocCount() was only ever called INSIDE the Google-broke branch
  // above, as blast-radius colour on an alert that was already firing. That made
  // sense when Drive was a working fallback and the count meant "temporarily
  // unreachable". It is not true any more: the legacy Drive client is built from
  // GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY, neither of which exists
  // on the Worker, so a document with no r2_key is unreachable PERMANENTLY and
  // no probe reports it — Google isn't "down", it is simply not wired up, so the
  // branch that would have mentioned this never runs.
  //
  // One such document exists today: a candidate's nursing diploma, uploaded in
  // May, still showing "waiting for review", with nothing behind it. Nobody
  // noticed for three months. This is the check that would have said so.
  //
  // Daily rather than 6-hourly: this is a backlog, not an outage. It cannot
  // "recover" on its own — somebody has to re-collect the file — so nagging
  // faster than once a day only teaches him to ignore it.
  try {
    const stranded = await driveOnlyDocCount();
    if (stranded !== null && stranded > 0 && telegramConfigured() && process.env.TELEGRAM_CHAT_ID) {
      const gate = await enforceUserRateLimit("health-alert", "docs:stranded", { limit: 1, windowMs: 24 * 60 * 60_000 });
      if (gate.ok) {
        await tgSend(
          process.env.TELEGRAM_CHAT_ID,
          `${stranded} candidate document(s) cannot be opened by anyone — the file was never copied to storage. They still show as waiting for review. Ask those candidates to upload again.`,
        );
      }
    }
  } catch (e) {
    // Never let this sink the healthy-path response.
    console.error("[health-watch] stranded-doc check failed:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({
    ok: broken.length === 0,
    probes: publicSummary(probes),
    ts: new Date().toISOString(),
  });
}
