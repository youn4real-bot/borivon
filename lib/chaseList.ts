/**
 * Who needs chasing, and why.
 *
 * The founder's actual bottleneck is not knowing WHO to contact — it is that
 * nothing surfaces the list, so people go quiet and nobody notices until a
 * passport has expired or a visa file has sat still for a month.
 *
 * Every reason here is computed from data the portal already holds. Nothing is
 * a guess, and each row carries the specific fact that triggered it so the
 * message can say something true and concrete instead of "just checking in".
 *
 * Ordering is by urgency: an expired passport on a placed candidate outranks
 * someone who has been quiet for three weeks.
 */

import { getServiceSupabase } from "@/lib/supabase";
import { getStaffUserIdsAmong } from "@/lib/admin-auth";
import type { ChaseReason } from "@/lib/whatsapp";

const DAY = 86_400_000;
const STALL_DAYS = 21;
const REJECT_GRACE_DAYS = 3;

export type ChaseRow = {
  userId: string;
  name: string;
  firstName: string;
  phone: string | null;
  lang: string | null;
  reason: ChaseReason;
  /** Human sentence naming the exact fact — shown in the list, not in the message. */
  detail: string;
  /** Lower sorts first. */
  urgency: number;
  days?: number;
  docType?: string;
  placementReady: boolean;
};

function parseDate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const de = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (de) return Date.UTC(+de[3], +de[2] - 1, +de[1]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export async function computeChaseList(now = Date.now()): Promise<ChaseRow[]> {
  const db = getServiceSupabase();

  const { data: profs } = await db
    .from("candidate_profiles")
    .select("user_id, first_name, last_name, phone, lang, passport_expiry, passport_status, passport_no, passport_feedback, placement_ready, is_test_account");
  const rows = (profs ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];

  // Never chase ourselves. The founder's own test account looks exactly like a
  // stalled candidate, and a sub-admin with a profile row would too.
  const staff = await getStaffUserIdsAmong(rows.map(r => String(r.user_id)));

  const { data: docsRaw } = await db
    .from("documents")
    .select("*") // '*' so a not-yet-migrated superseded_at column never errors
    .order("uploaded_at", { ascending: false });
  const docs = (docsRaw ?? []) as Record<string, unknown>[];

  // Newest LIVE document per candidate — archived rows are not evidence (LAW #33).
  const latestDoc = new Map<string, { status: string | null; type: string | null; at: number | null }>();
  for (const d of docs) {
    if (d.superseded_at) continue;
    const uid = String(d.user_id);
    if (latestDoc.has(uid)) continue;
    latestDoc.set(uid, {
      status: (d.status as string) ?? null,
      type: (d.file_type as string) ?? null,
      at: parseDate(d.uploaded_at as string),
    });
  }

  const out: ChaseRow[] = [];
  for (const p of rows) {
    const userId = String(p.user_id);
    if (staff.has(userId) || p.is_test_account === true) continue;

    const firstName = String(p.first_name ?? "").trim();
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "—";
    const base = {
      userId, name, firstName,
      phone: (p.phone as string) ?? null,
      lang: (p.lang as string) ?? null,
      placementReady: p.placement_ready === true,
    };

    // 1 — She sent a national ID card instead of a passport. Highest priority:
    //     the file cannot move at all, and she almost certainly does not know.
    if (typeof p.passport_feedback === "string" && p.passport_feedback.includes("Carte Nationale")) {
      out.push({ ...base, reason: "id_card_not_passport", urgency: 0,
        detail: p.placement_ready === true
          ? "sent an ID card, not a passport — and is marked ready to place"
          : "sent an ID card, not a passport" });
      continue;
    }

    // 2 — Passport expired or close to it. A placed candidate outranks the rest.
    const expMs = parseDate(p.passport_expiry as string);
    if (expMs != null) {
      const days = Math.round((expMs - now) / DAY);
      if (days < 0) {
        out.push({ ...base, reason: "passport_expired", days: -days, urgency: p.placement_ready === true ? 1 : 2,
          detail: `passport expired ${-days} days ago` });
        continue;
      }
      if (days <= 180) {
        out.push({ ...base, reason: "passport_expiring", days, urgency: days <= 30 ? 1 : 3,
          detail: `passport expires in ${days} days` });
        continue;
      }
    }

    // 3 — Her most recent document was rejected and she has not re-sent it.
    const last = latestDoc.get(userId);
    if (last && last.status === "rejected" && last.at != null && now - last.at > REJECT_GRACE_DAYS * DAY) {
      out.push({ ...base, reason: "doc_rejected", urgency: 4, docType: last.type ?? undefined,
        detail: `"${last.type ?? "a document"}" was refused ${Math.round((now - last.at) / DAY)} days ago and not re-sent` });
      continue;
    }

    // 4 — Gone quiet. Only counts once she has actually started (has a document);
    //     someone who registered and never uploaded is a lead, not a stalled file.
    if (last && last.at != null && now - last.at > STALL_DAYS * DAY && p.passport_status !== null) {
      out.push({ ...base, reason: "stalled", urgency: 5,
        days: Math.round((now - last.at) / DAY),
        detail: `nothing new for ${Math.round((now - last.at) / DAY)} days` });
    }
  }

  out.sort((a, b) => a.urgency - b.urgency || (a.days ?? 0) - (b.days ?? 0) || a.name.localeCompare(b.name));
  return out;
}
