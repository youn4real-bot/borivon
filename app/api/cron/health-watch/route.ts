import { NextRequest, NextResponse } from "next/server";
import { runHealthProbes, driveOnlyDocCount, publicSummary } from "@/lib/healthProbes";
import { tgSend, telegramConfigured } from "@/lib/telegram";

/**
 * Daily dependency watchdog — the thing that stops the founder being the bug finder.
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
 * It repeats daily while still broken — a nag that stops the moment it is fixed is the
 * correct nag — and recovery is signalled by tomorrow's silence rather than a second
 * message. Tracking state to say "recovered" would need a table, and a watchdog that
 * breaks because a migration was not run is worse than no watchdog. So: no table, no
 * migration, nothing to run before this works.
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

    if (telegramConfigured() && process.env.TELEGRAM_CHAT_ID) {
      // Minimalist per the founder's standing rule: the facts, nothing else.
      const lines = broken.map((p) => `${p.name}: ${p.detail ?? "failed"}`);
      // Only when Google is what broke: say how many documents that actually takes
      // offline, so the message carries a decision rather than a shrug.
      if (broken.some((p) => p.name === "google")) {
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
