import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { requireAdminRole } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/uuid";
import { generatePartnerKey, hashPartnerKey, keyPrefixOf } from "@/lib/partnerKeys";

/**
 * Issue / list / revoke the API keys handed to partner agencies.
 *
 * SUPREME ADMIN ONLY. A key lets an outside company read candidate documents,
 * passports included — that is not a sub-admin's call, and certainly not an
 * agency admin's (they would be minting their own access).
 *
 * The key is returned exactly ONCE, from POST, and is never recoverable
 * afterwards: only its SHA-256 is stored. Losing it means issuing a new one and
 * revoking the old, which is the correct trade — it means a database backup can
 * never be turned into working credentials.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSupreme(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ error: auth.error }, { status: auth.status }) };
  if (auth.role !== "admin") return { ok: false as const, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true as const, email: auth.email };
}

/** GET — the keys that exist, never the keys themselves. */
export async function GET(req: NextRequest) {
  const gate = await requireSupreme(req);
  if (!gate.ok) return gate.res;
  const db = getServiceSupabase();

  const { data, error } = await db
    .from("partner_api_keys")
    .select("id, org_id, key_prefix, label, created_at, created_by, last_used_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) {
    // The migration may not be run yet — say so plainly rather than 500.
    return NextResponse.json({ keys: [], needsMigration: true, hint: "Run supabase/partner_api.sql" });
  }

  const { data: orgs } = await db.from("organizations").select("id, name");
  const orgName = new Map(((orgs ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));

  return NextResponse.json({
    keys: ((data ?? []) as Record<string, unknown>[]).map((k) => ({
      id: k.id,
      orgId: k.org_id,
      agency: orgName.get(String(k.org_id)) ?? null,
      // "bv_live_a1b2c3d4" — enough to identify, never enough to use.
      prefix: k.key_prefix,
      label: k.label,
      createdAt: k.created_at,
      createdBy: k.created_by,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
    })),
    organizations: (orgs ?? []),
  });
}

/** POST { orgId, label? } — mint a key. Returns it ONCE, in plain text. */
export async function POST(req: NextRequest) {
  const gate = await requireSupreme(req);
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => ({}));
  const orgId = String((body as { orgId?: unknown }).orgId ?? "").trim();
  const label = String((body as { label?: unknown }).label ?? "").trim().slice(0, 80);
  if (!UUID_RE.test(orgId)) return NextResponse.json({ error: "bad_org" }, { status: 400 });

  const db = getServiceSupabase();
  const { data: org } = await db.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
  if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });

  const key = generatePartnerKey();
  const { error } = await db.from("partner_api_keys").insert({
    org_id: orgId,
    key_hash: await hashPartnerKey(key),
    key_prefix: keyPrefixOf(key),
    label,
    created_by: gate.email,
  });
  if (error) {
    console.error("[partner-keys POST] insert failed:", error.message);
    return NextResponse.json({ error: "create_failed", hint: "Run supabase/partner_api.sql" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    agency: (org as { name: string }).name,
    // THE ONLY TIME this is ever readable. Copy it now or issue another.
    key,
    warning: "Copy this key now — it cannot be shown again.",
  });
}

/** DELETE { id } — revoke. Takes effect on the partner's very next request. */
export async function DELETE(req: NextRequest) {
  const gate = await requireSupreme(req);
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => ({}));
  const id = String((body as { id?: unknown }).id ?? "").trim();
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  // Revoke, never delete: the row is the audit trail of who was given access.
  const { error } = await getServiceSupabase()
    .from("partner_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "revoke_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
