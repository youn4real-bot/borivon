import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireUser, requireAdminRole, canActOnCandidate } from "@/lib/admin-auth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { sanitizeLetterHtml } from "@/lib/sanitizeHtml";

/**
 * Cover-letter body read + write.
 *
 * Dual-auth target resolution (mirrors the CV-draft pattern):
 *   • No ?userId param          → caller acts on their OWN row
 *                                 (candidate editing their own letter)
 *   • ?userId=<uid> param       → caller is acting on another candidate's
 *                                 row → must be admin / sub_admin AND
 *                                 canActOnCandidate(uid) → 403 otherwise
 *
 * Server is single source of truth; the editor autosaves on every keystroke
 * with last-write-wins (admin edit replaces candidate edit, candidate edit
 * replaces admin edit — the active editor's PUT lands last and reigns).
 *
 * Schema-tolerant: if cover_letter_body column hasn't been migrated yet
 * (supabase/add_cover_letter_body.sql), GET returns body:null and PUT
 * 503s with a clear message — won't 500 the whole letter page.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 6 KB caps the worst-case innerHTML for the editor (MAX_WORDS=320 +
// minimal HTML wrapping). Guards against a buggy/abusive client.
const MAX_BODY_BYTES = 6_000;
const MIGRATION_RE = /cover_letter(_visa)?_body|column .* does not exist|schema cache/i;

/** Which body column this request targets: essentials vs the visa letter. */
function bodyColumn(req: NextRequest): "cover_letter_body" | "cover_letter_visa_body" {
  return req.nextUrl.searchParams.get("variant") === "visa" ? "cover_letter_visa_body" : "cover_letter_body";
}

/**
 * Resolve { ok, userId } — the user whose row this request reads or writes.
 * Handles BOTH candidate-self and admin-acting-on-candidate cases.
 */
async function resolveTarget(req: NextRequest, paramUid: string | null) {
  if (paramUid) {
    if (!UUID_RE.test(paramUid)) return { ok: false as const, status: 400, error: "Invalid userId" };
    const auth = await requireAdminRole(req);
    if (!auth.ok) return { ok: false as const, status: auth.status, error: auth.error };
    if (!(await canActOnCandidate(auth.role, auth.email, paramUid))) {
      return { ok: false as const, status: 403, error: "Forbidden" };
    }
    return { ok: true as const, userId: paramUid };
  }
  const auth = await requireUser(req);
  if (!auth.ok) return { ok: false as const, status: auth.status, error: auth.error };
  return { ok: true as const, userId: auth.userId };
}

export async function GET(req: NextRequest) {
  const paramUid = req.nextUrl.searchParams.get("userId");
  const target = await resolveTarget(req, paramUid);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  const col = bodyColumn(req);
  const db = getServiceSupabase();
  const res = await db
    .from("candidate_profiles")
    .select(col)
    .eq("user_id", target.userId)
    .maybeSingle();
  if (res.error && MIGRATION_RE.test(res.error.message ?? "")) {
    return NextResponse.json({ body: null, migrated: false });
  }
  const row = (res.data ?? null) as Record<string, string | null> | null;
  return NextResponse.json({ body: row?.[col] ?? null, migrated: true });
}

export async function PUT(req: NextRequest) {
  // Autosave fires on every keystroke (debounced ~700ms) — generous cap
  // covers active editing on both candidate + admin sides.
  const rl = enforceRateLimit(req, "letter-body", { limit: 90, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many saves — slow down" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const paramUid = req.nextUrl.searchParams.get("userId");
  const target = await resolveTarget(req, paramUid);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES * 2) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let body: { body?: unknown };
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Body is the contentEditable's innerHTML — string or empty/null to clear.
  // SANITIZE before persist: this body is later rendered via innerHTML in the
  // admin's session (LAW #37 review) — unsanitized HTML = stored XSS. Cap
  // length AFTER sanitizing so a padded payload can't smuggle past the cap.
  let html: string | null = null;
  if (body.body === null || body.body === "") html = null;
  else if (typeof body.body === "string") html = sanitizeLetterHtml(body.body).slice(0, MAX_BODY_BYTES);
  else return NextResponse.json({ error: "body must be a string or null" }, { status: 400 });

  const col = bodyColumn(req);
  const db = getServiceSupabase();
  const { error } = await db
    .from("candidate_profiles")
    .upsert({ user_id: target.userId, [col]: html }, { onConflict: "user_id" });
  if (error) {
    if (MIGRATION_RE.test(error.message ?? "")) {
      return NextResponse.json(
        { error: `Migration pending — run supabase/add_${col === "cover_letter_visa_body" ? "cover_letter_visa_body" : "cover_letter_body"}.sql` },
        { status: 503 },
      );
    }
    console.error("[letter-body PUT] failed:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
