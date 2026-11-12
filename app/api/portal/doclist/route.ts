import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimitDistributed } from "@/lib/rateLimit";
import { fxDb, newId, nowIso } from "@/lib/facility/db";
import { journeyOwner, askedId } from "@/lib/facility/portalAccess";
import { cleanLabel, cleanPhase, cleanView, listExtras, viewKey, type DocView } from "@/lib/facility/extraDocs";

/**
 * Her papers list (founder 2026-11-12): the extra papers added for her alone, and the filter that stays.
 *   GET    ?userId=                     → { extras, view }   (a nurse: her own; an admin: the nurse's)
 *   PUT    { userId?, view }            → the filter (admin choice is shared by her admins; hers is hers)
 *   POST   { userId, label, phase }     → add an extra paper (admins only)
 *   DELETE { userId, id }               → remove one (admins only, and only while nothing is uploaded in it)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function readView(key: string): Promise<DocView> {
  const db = (await fxDb())!;
  const r = (await db.run(`SELECT mode FROM fx_docview WHERE key = ?`, [key])).results[0] as { mode?: string } | undefined;
  return cleanView(r?.mode) ?? "all";
}

export async function GET(req: NextRequest) {
  const w = await journeyOwner(req, askedId(req.nextUrl.searchParams.get("userId")));
  if (w instanceof NextResponse) return w;
  const [extras, view] = await Promise.all([listExtras(w.userId), readView(viewKey(w.userId, w.admin))]);
  return NextResponse.json({ extras, view }, { headers: NO_STORE });
}

export async function PUT(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "doclist-w", { limit: 600, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  const view = cleanView(b.view);
  if (!view) return NextResponse.json({ error: "bad_view" }, { status: 400 });
  const db = (await fxDb())!;
  await db.run(
    `INSERT INTO fx_docview (key, mode, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [viewKey(w.userId, w.admin), view, nowIso(), w.by],
  );
  return NextResponse.json({ view }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const rl = await enforceRateLimitDistributed(req, "doclist-w", { limit: 600, windowMs: 3_600_000 });
  if (!rl.ok) return NextResponse.json({ error: "too_many" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  if (!w.admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const label = cleanLabel(b.label);
  if (!label) return NextResponse.json({ error: "bad_label" }, { status: 400 });
  const db = (await fxDb())!;
  const n = Number(((await db.run(`SELECT COUNT(*) AS n FROM fx_extra_docs WHERE user_id = ?`, [w.userId])).results[0] as { n?: number })?.n ?? 0);
  if (n >= 30) return NextResponse.json({ error: "too_many_extras" }, { status: 400 });
  const extra = { id: newId(), label, phase: cleanPhase(b.phase) };
  await db.run(`INSERT INTO fx_extra_docs (id, user_id, label, phase, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [extra.id, w.userId, extra.label, extra.phase, nowIso(), w.by]);
  return NextResponse.json({ extra }, { headers: NO_STORE });
}

export async function DELETE(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const w = await journeyOwner(req, askedId(b.userId));
  if (w instanceof NextResponse) return w;
  if (!w.admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = askedId(b.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const db = (await fxDb())!;
  // never lose a paper: an extra that already holds a file stays (its file would have no home)
  const used = (await db.run(`SELECT id FROM documents WHERE user_id = ? AND file_type = ? AND superseded_at IS NULL LIMIT 1`, [w.userId, id])).results.length > 0;
  if (used) return NextResponse.json({ error: "has_files" }, { status: 409 });
  await db.run(`DELETE FROM fx_extra_docs WHERE id = ? AND user_id = ?`, [id, w.userId]);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
