import { NextRequest, NextResponse } from "next/server";
import { runHealthProbes, driveOnlyDocCount, publicSummary, type Probe } from "@/lib/healthProbes";
import { enforceUserRateLimit } from "@/lib/rateLimit";
import { tgSend, telegramConfigured } from "@/lib/telegram";

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
  }

  return NextResponse.json({
    ok: broken.length === 0,
    probes: publicSummary(probes),
    ts: new Date().toISOString(),
  });
}
