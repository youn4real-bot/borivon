import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { tgSend } from "@/lib/telegram";
import { looksLikeAffiliateCode } from "@/lib/affiliates";
import { isWriteFrozenError, maintenanceResponse } from "@/lib/maintenance";

/**
 * Public lead-capture endpoint for the homepage funnel (components/Funnel.tsx).
 *
 * The funnel submits several shapes — person / org / work / general /
 * fachkraefte — each with different fields. We store the common fields as
 * columns and every kind-specific extra in a `details` JSONB so NOTHING is
 * lost, then surface it all to admins at /portal/admin/leads.
 *
 * (Previously this wrote into admin_notifications, whose `type` CHECK only
 * allows signup/upload/doc-* → every lead 500'd and was lost. Fixed by the
 * dedicated `leads` table — run supabase/leads.sql first.)
 *
 * Spam mitigation: Cloudflare Turnstile in front of the form + server-side IP
 * rate-limit + body-size cap + 1h dedupe.
 */
const MAX = (s: unknown, n: number) => (typeof s === "string" ? s : "").trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Kind-specific extra fields the funnel may send — captured into `details`.
const DETAIL_FIELDS = ["level", "company", "service", "format", "field", "sector", "positions", "city"] as const;

export async function POST(req: NextRequest) {
  // Tight rate-limit on the public lead endpoint — bots love forms. A real
  // user fills the funnel once, maybe twice; 5/min is generous.
  const rl = await enforceRateLimitDistributed(req, "leads", { limit: 10, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  // Hard cap the body so a bot can't POST megabytes in a loop. A real lead is
  // well under 1 KB; 8 KB leaves headroom for accents + custom messages.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 8 * 1024) return NextResponse.json({ error: "too_large" }, { status: 413 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }

  const email = MAX(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const kind = MAX(body.kind, 24) || "person";

  // Collect kind-specific extras (only non-empty known fields) into details.
  const details: Record<string, string> = {};
  for (const f of DETAIL_FIELDS) {
    const v = MAX(body[f], 500);
    if (v) details[f] = v;
  }

  // Affiliate attribution: /r/<code> left a bv_ref cookie (sent on this same-site
  // POST). Record which affiliate this lead came from — for analytics + a manual
  // fallback if the nurse never self-registers. Bonus only, never required.
  const refCode = req.cookies.get("bv_ref")?.value ?? "";
  const row = {
    kind,
    email,
    name:    MAX(body.name, 120),
    phone:   MAX(body.phone, 40),
    message: MAX(body.message, 1000),
    details,
    ...(looksLikeAffiliateCode(refCode) ? { ref_code: refCode } : {}),
  };

  const db = getServiceSupabase();

  // WRITE FREEZE (MAINTENANCE_WRITES, lib/maintenance.ts): for the few minutes of
  // the final database copy, middleware lets this route run but the service
  // client refuses its write. A lead is the one thing that must not be lost to a
  // planned pause, so it still goes to the founder on Telegram (below), and the
  // answer is the freeze's 503 — see the end of this handler.
  let notSaved = false;

  // De-dupe accidental double-submits: same email + kind within the last hour.
  // Legitimate re-engagement days later still gets through.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: dup } = await db
    .from("leads")
    .select("id").eq("email", email).eq("kind", kind).gte("created_at", oneHourAgo).maybeSingle();
  if (dup) {
    // A second submission inside the hour is almost always the SAME person
    // fixing something — a mistyped phone number, a message they cut short.
    // This used to answer "ok" and drop the new values on the floor, so the
    // version the founder called back on was the wrong one. Keep one row, but
    // let the correction win: overwrite only the fields that arrived non-empty
    // so a shorter second pass can never blank out detail from the first.
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "phone", "message"] as const) if (row[k]) patch[k] = row[k];
    if (Object.keys(details).length) patch.details = details;
    if (Object.keys(patch).length) {
      const { error: updErr } = await db.from("leads").update(patch).eq("id", (dup as { id: string }).id);
      if (isWriteFrozenError(updErr)) notSaved = true;
      else if (updErr) console.error("[/api/leads] duplicate update failed:", updErr.message);
    }
    if (!notSaved) return NextResponse.json({ ok: true, duplicate: true });
  }

  let insErr = notSaved ? null : (await db.from("leads").insert(row)).error;
  if (insErr && "ref_code" in row && /ref_code|column|schema cache|does not exist/i.test(insErr.message ?? "")) {
    // Pre-migration: leads.ref_code not added yet. NEVER lose a lead over an
    // analytics nicety — retry the insert without it.
    const rest: Record<string, unknown> = { ...row };
    delete rest.ref_code;
    insErr = (await db.from("leads").insert(rest)).error;
  }
  if (isWriteFrozenError(insErr)) {
    notSaved = true;
  } else if (insErr) {
    console.error("[/api/leads] insert error:", insErr.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // ── Telegram ping — the lead is worthless if nobody is told it arrived ──────
  //
  // This route stored the lead and stopped. /api/v2/contact — the ENTERPRISE
  // form — has pinged the founder from day one, so B2B enquiries buzzed his
  // phone while the homepage funnel, which is where NURSES apply, was silent:
  // a lead only surfaced if he happened to open /portal/admin/leads. Eleven
  // arrived that way between May and July and every one was still marked "new".
  //
  // Deliberately awaited, not fire-and-forget: on Workers an unawaited promise
  // is cancelled when the response is sent, which is what silently killed five
  // other notifications after the Cloudflare cutover. tgSend is one HTTPS call
  // and the whole thing is wrapped, so a Telegram outage cannot cost the lead
  // that is already safely in the table.
  const tgChat = (process.env.TELEGRAM_CHAT_ID || "").trim();
  if (tgChat) {
    const KIND_LABEL: Record<string, string> = {
      person:      "👩‍⚕️ Nouvelle candidate — INFIRMIÈRE",
      fachkraefte: "👩‍⚕️ Nouvelle candidate — FACHKRÄFTE",
      work:        "💼 Nouvelle demande — TRAVAIL",
      org:         "🏢 Nouvelle demande — ORGANISATION",
      general:     "✉️ Nouveau message — SITE",
    };
    const extras = Object.entries(details).map(([k, v]) => `${k} : ${v}`);
    const tgText = [
      `${KIND_LABEL[kind] ?? `✉️ Nouveau lead — ${kind}`} — borivon.com`,
      "",
      notSaved ? "Maintenance : pas encore enregistré dans le portail" : null,
      row.name ? `Nom      : ${row.name}` : null,
      `E-mail   : ${row.email}`,
      row.phone ? `Téléphone: ${row.phone}` : null,
      ...extras,
      row.message ? "" : null,
      row.message || null,
      "",
      "→ /portal/admin/leads",
    ].filter((l) => l !== null).join("\n");
    try { await tgSend(tgChat, tgText); }
    catch (e) { console.error("[/api/leads] telegram ping failed:", e instanceof Error ? e.message : e); }
  }

  // Not in the table yet: answer the freeze's own 503, never "ok". The funnel
  // (components/Funnel.tsx) keeps a lead that did not get a 2xx in localStorage
  // and re-sends it on the visitor's next visit, when it lands in the table too;
  // the visitor's screen is the same either way. The founder already has it above.
  if (notSaved) return maintenanceResponse(req.headers.get("accept-language"));
  return NextResponse.json({ ok: true });
}
