import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";

/**
 * Telegram webhook INSPECT + REPOINT — the last thing standing between us and
 * deleting Vercel.
 *
 * Why this exists: if the bot's webhook still points at a *.vercel.app URL, the
 * bot keeps working ONLY because Vercel is still alive — and would silently die
 * the moment the project is deleted. There was no way to see or change the
 * webhook: TELEGRAM_BOT_TOKEN is a Worker secret, so nobody (including a laptop
 * with the repo) can call getWebhookInfo locally. This route asks Telegram
 * server-side, where the token already lives.
 *
 *   GET  → where the webhook currently points (host + path only)
 *   POST → repoint it at THIS deployment's canonical URL
 *
 * SECURITY:
 *  • Supreme-admin only (requireAdminRole + role check). Hijacking a bot webhook
 *    would hand an attacker every message the founder sends the bot.
 *  • The target URL is HARDCODED to the site's own origin — deliberately NOT
 *    taken from the request body, so this can never be used to redirect the bot
 *    to an attacker's server.
 *  • The bot token and the webhook secret are NEVER returned. GET reports the
 *    host/path and strips any query string (Telegram echoes the URL back, and
 *    some setups put a token in it).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The ONLY URL this route will ever set. Not client-controllable. */
const CANONICAL_WEBHOOK = "https://www.borivon.com/api/telegram/webhook";

const tgApi = (method: string) => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  return token ? `https://api.telegram.org/bot${token}/${method}` : null;
};

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  const url = tgApi("getWebhookInfo");
  if (!url) return NextResponse.json({ error: "no_bot_token", hint: "TELEGRAM_BOT_TOKEN isn't set on this deployment." }, { status: 503 });

  try {
    const r = await fetch(url);
    const j = await r.json() as { ok?: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number } };
    if (!j.ok) return NextResponse.json({ error: "telegram_error" }, { status: 502 });
    const raw = j.result?.url || "";
    // Report host+path only — never echo a query string (it can carry a token).
    let host = "", path = "";
    try { const u = new URL(raw); host = u.host; path = u.pathname; } catch { /* empty/!url */ }
    return NextResponse.json({
      configured: !!raw,
      host,
      path,
      onCloudflare: host === "www.borivon.com" || host === "borivon.com",
      onVercel: /vercel\.app$/i.test(host),
      pendingUpdates: j.result?.pending_update_count ?? 0,
      lastError: j.result?.last_error_message ?? null,
      canonical: CANONICAL_WEBHOOK,
    });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Supreme admin only" }, { status: 403 });

  const url = tgApi("setWebhook");
  if (!url) return NextResponse.json({ error: "no_bot_token" }, { status: 503 });

  // Carry the same secret the webhook route validates, so repointing can't
  // downgrade security (webhook/route.ts rejects calls without this header).
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: CANONICAL_WEBHOOK,
        ...(secret ? { secret_token: secret } : {}),
        // Don't replay a backlog aimed at the old host.
        drop_pending_updates: false,
      }),
    });
    const j = await r.json() as { ok?: boolean; description?: string };
    if (!j.ok) return NextResponse.json({ error: "telegram_rejected", detail: j.description ?? null }, { status: 502 });
    return NextResponse.json({ ok: true, pointedAt: CANONICAL_WEBHOOK, secretAttached: !!secret });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
