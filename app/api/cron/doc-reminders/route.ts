/**
 * Daily automatic document reminders to candidates (lib/docRemindersRun).
 * 10:00 UTC = 11:00 Casablanca. Sends nothing while the Chase-page switch is
 * off or the reminder log table is missing.
 *
 * Unlike the founder-facing crons this one writes to CANDIDATES, so it refuses
 * to run at all without a configured CRON_SECRET rather than falling open.
 */
import { NextRequest } from "next/server";
import { runDocReminders } from "@/lib/docRemindersRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("forbidden", { status: 403 });
  }
  return Response.json(await runDocReminders());
}
