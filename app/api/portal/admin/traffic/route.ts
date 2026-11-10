import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { trackDb } from "@/lib/track/server";

/**
 * The founder's traffic & funnel numbers ("Besucher & Quellen"). SUPREME ADMIN ONLY.
 *   GET  ?days=30          → totals, sources, links, quiz drop-off, answers, daily, visits, leads
 *   POST { name, channel, target, code? } → a new tracked link  borivon.com/l/<code>
 *   PATCH { code, archived } → hide / show a link
 * Every block is read on its own: one failing query leaves the others standing.
 */
export const dynamic = "force-dynamic";

async function supreme(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { error: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (auth.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { auth };
}

type Q = { run(sql: string, params?: unknown[]): Promise<{ results: Record<string, unknown>[] }> };
async function rows(db: Q, sql: string, params: unknown[], errors: string[], label: string) {
  try { return (await db.run(sql, params)).results; }
  catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`); return []; }
}

const SOURCE = `CASE WHEN src <> '' THEN src WHEN ref <> '' THEN ref ELSE '(direkt)' END`;

export async function GET(req: NextRequest) {
  const s = await supreme(req);
  if (s.error) return s.error;
  const db = await trackDb().catch(() => null);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const errors: string[] = [];

  const [totals, sources, quiz, fields, answers, daily, visits, links, leads] = await Promise.all([
    rows(db, `SELECT
        SUM(type='click') AS clicks,
        COUNT(DISTINCT CASE WHEN type='view' THEN visitor END) AS visitors,
        COUNT(DISTINCT CASE WHEN type='view' THEN sid END) AS visits,
        COUNT(DISTINCT CASE WHEN type='view' AND path='/fahrplan' THEN sid END) AS fahrplan,
        COUNT(DISTINCT CASE WHEN type='q_answer' AND path='/fahrplan' THEN sid END) AS quiz,
        SUM(type='form_submit') AS submits,
        COUNT(DISTINCT CASE WHEN type='confirm' THEN lead_id END) AS confirms,
        COUNT(DISTINCT CASE WHEN type IN ('pdf_open','pdf_download') THEN lead_id END) AS pdf,
        COUNT(DISTINCT CASE WHEN type='pdf_cta' THEN lead_id END) AS pdfCta,
        COUNT(DISTINCT CASE WHEN type='platform_open' THEN lead_id END) AS platformOpen,
        COUNT(DISTINCT CASE WHEN type='platform_signup' THEN lead_id END) AS platformSignup,
        COUNT(DISTINCT CASE WHEN type='view' AND path='/workshop' THEN sid END) AS workshop,
        COUNT(DISTINCT CASE WHEN type='book_time' THEN sid END) AS bookPick,
        SUM(type='book_done') AS bookings,
        COUNT(DISTINCT CASE WHEN type='consent' THEN value END) AS consents
      FROM track_events WHERE at >= ?`, [since], errors, "totals"),
    rows(db, `SELECT ${SOURCE} AS source,
        SUM(type='click') AS clicks,
        COUNT(DISTINCT CASE WHEN type='view' THEN visitor END) AS visitors,
        COUNT(DISTINCT CASE WHEN type='q_answer' THEN sid END) AS quiz,
        SUM(type='form_submit') AS submits,
        SUM(type='book_done') AS bookings,
        ROUND(AVG(CASE WHEN type='leave' THEN CAST(value AS INTEGER) END) / 1000) AS avgSec
      FROM track_events WHERE at >= ? GROUP BY source ORDER BY visitors DESC, clicks DESC LIMIT 40`, [since], errors, "sources"),
    rows(db, `SELECT name AS q, MIN(CAST(value AS INTEGER)) AS pos, COUNT(DISTINCT sid) AS reached
      FROM track_events WHERE at >= ? AND type='q_view' AND path='/fahrplan' GROUP BY name ORDER BY pos`, [since], errors, "quiz"),
    rows(db, `SELECT name AS field,
        COUNT(DISTINCT CASE WHEN type='field_focus' THEN sid END) AS entered,
        COUNT(DISTINCT CASE WHEN type='field_done' AND value='1' THEN sid END) AS filled
      FROM track_events WHERE at >= ? AND path='/fahrplan' AND type IN ('field_focus','field_done') AND name <> 'c-web'
      GROUP BY name ORDER BY entered DESC LIMIT 20`, [since], errors, "fields"),
    rows(db, `SELECT name AS q, value AS v, COUNT(DISTINCT sid) AS n
      FROM track_events WHERE at >= ? AND type='q_answer' AND path='/fahrplan' AND name IN ('art','rolle','standorte','bedarf','leasing','erfahrung','start','land')
      GROUP BY name, value ORDER BY name, n DESC LIMIT 120`, [since], errors, "answers"),
    rows(db, `SELECT substr(at, 1, 10) AS d,
        COUNT(DISTINCT CASE WHEN type='view' THEN visitor END) AS visitors,
        SUM(type='click') AS clicks, SUM(type='form_submit') AS submits, SUM(type='book_done') AS bookings
      FROM track_events WHERE at >= ? GROUP BY d ORDER BY d`, [since], errors, "daily"),
    rows(db, `SELECT sid, MIN(at) AS start, MAX(at) AS last,
        MAX(src) AS src, MAX(ref) AS ref, MAX(country) AS country, MAX(city) AS city, MAX(org) AS org,
        MAX(device) AS device, MAX(os) AS os, MAX(browser) AS browser, MAX(ip) AS ip,
        GROUP_CONCAT(DISTINCT path) AS paths,
        MAX(CASE WHEN type='scroll' THEN CAST(name AS INTEGER) END) AS scroll,
        MAX(CASE WHEN type='leave' THEN CAST(value AS INTEGER) END) AS ms,
        SUM(type='q_answer') AS answers, SUM(type='form_submit') AS submitted, SUM(type='book_done') AS booked,
        MAX(lead_id) AS lead
      FROM track_events WHERE at >= ? AND sid <> '' GROUP BY sid ORDER BY start DESC LIMIT 80`, [since], errors, "visits"),
    rows(db, `SELECT l.code, l.name, l.channel, l.target, l.created_at AS createdAt, l.archived,
        (SELECT COUNT(*) FROM track_events e WHERE e.type='click' AND e.src=l.code AND e.at >= ?) AS clicks,
        (SELECT COUNT(DISTINCT e.visitor) FROM track_events e WHERE e.type='view' AND e.src=l.code AND e.at >= ?) AS visitors,
        (SELECT COUNT(*) FROM track_events e WHERE e.type='form_submit' AND e.src=l.code AND e.at >= ?) AS submits
      FROM track_links l ORDER BY l.archived, l.created_at DESC LIMIT 200`, [since, since, since], errors, "links"),
    rows(db, `SELECT l.id, l.created_at AS createdAt, l.email, l.name, l.message,
        json_extract(l.details, '$.track.src') AS src, json_extract(l.details, '$.track.ref') AS ref,
        json_extract(l.details, '$.facility') AS facility,
        json_extract(l.details, '$.result.level') AS level,
        json_extract(l.details, '$.consent.confirmedAt') AS confirmedAt,
        json_extract(l.details, '$.delivery.sentAt') AS sentAt,
        json_extract(l.details, '$.consent.ip') AS ip,
        (SELECT COUNT(*) FROM track_events e WHERE e.lead_id = l.id AND e.type IN ('pdf_open','pdf_download')) AS pdf,
        (SELECT COUNT(*) FROM track_events e WHERE e.lead_id = l.id AND e.type = 'pdf_cta') AS pdfCta,
        (SELECT COUNT(*) FROM track_events e WHERE e.lead_id = l.id AND e.type = 'view' AND e.path = '/workshop') AS workshop,
        (SELECT COUNT(*) FROM bookings b WHERE lower(b.email) = lower(l.email)) AS booked
      FROM leads l WHERE l.kind = 'roadmap' AND l.created_at >= ? ORDER BY l.created_at DESC LIMIT 100`, [since], errors, "leads"),
  ]);

  return NextResponse.json({
    days, since, totals: totals[0] ?? {}, sources, quiz, fields, answers, daily, visits, links, leads,
    ...(errors.length ? { errors } : {}),
  }, { headers: { "Cache-Control": "no-store" } });
}

const CHANNELS: Record<string, string> = {
  linkedin: "li", youtube: "yt", instagram: "ig", facebook: "fb", tiktok: "tt",
  email: "mail", whatsapp: "wa", xing: "xing", podcast: "pod", ads: "ad", other: "go",
};
const TARGETS = ["/fahrplan", "/workshop", "/workshop#termin", "/", "/plattform"];

export async function POST(req: NextRequest) {
  const s = await supreme(req);
  if (s.error) return s.error;
  const db = await trackDb().catch(() => null);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(b.name ?? "").trim().slice(0, 120);
  const channel = CHANNELS[String(b.channel)] ? String(b.channel) : "other";
  const target = TARGETS.includes(String(b.target)) ? String(b.target) : "/fahrplan";
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  let code = String(b.code ?? "").trim().toLowerCase();
  if (code && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(code)) return NextResponse.json({ error: "bad_code" }, { status: 400 });
  for (let tries = 0; tries < 5; tries++) {
    if (!code || tries > 0) {
      const a = new Uint8Array(3);
      crypto.getRandomValues(a);
      code = `${CHANNELS[channel]}-${[...a].map((x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("")}`;
    }
    const exists = (await db.run(`SELECT 1 FROM track_links WHERE code = ?`, [code])).results.length > 0;
    if (exists) { if (b.code && tries === 0) return NextResponse.json({ error: "code_taken" }, { status: 409 }); continue; }
    await db.run(`INSERT INTO track_links (code, name, channel, target, created_at, archived) VALUES (?, ?, ?, ?, ?, 0)`,
      [code, name, channel, target, new Date().toISOString()]);
    return NextResponse.json({ ok: true, code, url: `https://borivon.com/l/${code}` });
  }
  return NextResponse.json({ error: "try_again" }, { status: 500 });
}

export async function PATCH(req: NextRequest) {
  const s = await supreme(req);
  if (s.error) return s.error;
  const db = await trackDb().catch(() => null);
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const code = String(b.code ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(code)) return NextResponse.json({ error: "bad_code" }, { status: 400 });
  await db.run(`UPDATE track_links SET archived = ? WHERE code = ?`, [b.archived ? 1 : 0, code]);
  return NextResponse.json({ ok: true });
}
