import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin-auth";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * SUPREME-ADMIN-ONLY (test phase): document-expiry radar. Passports drive the
 * whole visa pipeline — an expired one blocks everything — so we surface every
 * candidate whose passport is expired or expiring soon, computed live from the
 * OCR-captured passport_expiry (German DD.MM.YYYY). Sorted soonest-first.
 *
 * GET → { rows: [{ userId, name, type, expiry, daysUntil, status }], today }
 */
export const dynamic = "force-dynamic";

/** Parse "DD.MM.YYYY" (OCR format) or ISO "YYYY-MM-DD" → epoch ms, or null. */
function parseExpiry(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  const de = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (de) return Date.UTC(+de[3], +de[2] - 1, +de[1]);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden — supreme admin only" }, { status: 403 });

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, passport_expiry, passport_status");
  if (error) { console.error("[expiry-radar] error:", error.message); return NextResponse.json({ error: "load_failed" }, { status: 500 }); }

  const now = Date.now();
  const DAY = 86_400_000;
  type Row = { userId: string; name: string; type: string; expiry: string; daysUntil: number; status: "expired" | "critical" | "soon" | "ok" };
  const rows: Row[] = [];
  for (const p of (data ?? []) as { user_id: string; first_name: string | null; last_name: string | null; passport_expiry: string | null; passport_status: string | null }[]) {
    const ms = parseExpiry(p.passport_expiry);
    if (ms == null) continue;
    const daysUntil = Math.round((ms - now) / DAY);
    // Only surface what needs attention — expired or within a year.
    if (daysUntil > 365) continue;
    const status = daysUntil < 0 ? "expired" : daysUntil < 90 ? "critical" : daysUntil < 180 ? "soon" : "ok";
    rows.push({
      userId: p.user_id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "—",
      type: "passport",
      expiry: p.passport_expiry!.trim(),
      daysUntil,
      status,
    });
  }
  rows.sort((a, b) => a.daysUntil - b.daysUntil);

  return NextResponse.json({ rows, today: new Date(now).toISOString() });
}
