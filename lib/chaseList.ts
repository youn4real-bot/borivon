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
import { waNumber, type ChaseReason } from "@/lib/whatsapp";

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
  /**
   * The employer intake this candidate is assigned to, or null.
   *
   * The founder chases the batch, not the roster: someone with no intake date has
   * nothing to be late for, so nagging them is noise that buries the people who
   * are actually holding up a seat at UKSH. 17 of the 78 are in a batch. The list
   * still computes everyone — hiding a real blocker completely would be worse —
   * but the batch is what it leads with.
   */
  batch: string | null;
};

/**
 * People who filled in the registration form and never confirmed, so no account
 * was ever opened for them.
 *
 * They live ONLY in the auth records: no `candidate_profiles` row is written
 * until confirmation, so nothing in the portal has ever shown them. Eight of the
 * eighty-four accounts are in this state, and one person is in it twice — she
 * registered on a Gmail address and then, ten minutes later, on an iCloud one,
 * with the same phone number. That is not somebody losing interest, that is
 * somebody who never received the code and tried another mailbox.
 *
 * The phone number is what makes this worth surfacing: they typed it into the
 * form, so there is a way to reach every one of them.
 */
type UnconfirmedSignup = {
  userId: string; email: string; name: string; firstName: string;
  phone: string | null; createdAt: number;
};

async function unconfirmedSignups(): Promise<(UnconfirmedSignup & { attempts: number })[]> {
  const db = getServiceSupabase();
  const out: UnconfirmedSignup[] = [];
  try {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data?.users?.length) break;
      for (const u of data.users) {
        if (u.email_confirmed_at) continue;
        // Accounts the founder soft-deleted keep a scrambled address; they are
        // not people waiting to be let in.
        const email = (u.email ?? "").toLowerCase();
        if (!email || email.endsWith("@borivon.invalid")) continue;
        const m = (u.user_metadata ?? {}) as Record<string, unknown>;
        const first = typeof m.first_name === "string" ? m.first_name.trim() : "";
        const full = typeof m.full_name === "string" ? m.full_name.trim() : "";
        out.push({
          userId: u.id,
          email,
          name: full || first || email,
          firstName: first || full.split(/\s+/)[0] || "",
          phone: typeof m.phone === "string" && m.phone.trim() ? m.phone.trim() : null,
          createdAt: Date.parse(u.created_at) || Date.now(),
        });
      }
      if (data.users.length < 200) break;
    }
  } catch {
    // Never let this sink the whole chase list — the four reasons above are the
    // ones tied to a live batch.
  }
  return dedupeByPhone(out);
}

/**
 * One row per PERSON, not per abandoned account.
 *
 * Somebody who never receives the code often just tries again with another
 * address, so the same person can hold two or three unconfirmed accounts. Doha
 * Zini has exactly two, ten minutes apart, on the same number. Listing both
 * would have the founder message her twice about the same problem.
 *
 * Keyed on the dialable number, since that is what a message would actually go
 * to. The EARLIEST attempt wins — it is the one that says how long she has been
 * waiting — and the retry count rides along, because someone who tried twice
 * tried harder than someone who tried once.
 */
function dedupeByPhone<T extends { phone: string | null; createdAt: number }>(rows: T[]): (T & { attempts: number })[] {
  const byPhone = new Map<string, T & { attempts: number }>();
  const noPhone: (T & { attempts: number })[] = [];
  for (const r of rows) {
    const key = waNumber(r.phone);
    if (!key) { noPhone.push({ ...r, attempts: 1 }); continue; }
    const seen = byPhone.get(key);
    if (!seen) { byPhone.set(key, { ...r, attempts: 1 }); continue; }
    byPhone.set(key, {
      ...(r.createdAt < seen.createdAt ? r : seen),
      attempts: seen.attempts + 1,
    });
  }
  return [...byPhone.values(), ...noPhone];
}

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

  // Which employer intake each candidate is assigned to. Schema-tolerant: if the
  // employer_batches migration has not been run, every row simply comes back with
  // batch=null and the page still works — it must never return an empty list
  // because a column is missing.
  const batchOf = new Map<string, string>();
  {
    const { data: pipe } = await db.from("candidate_pipeline").select("user_id, batch_id");
    const ids = [...new Set(((pipe ?? []) as { batch_id: string | null }[]).map(r => r.batch_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: batches } = await db.from("employer_batches").select("id, name").in("id", ids);
      const nameOf = new Map(((batches ?? []) as { id: string; name: string }[]).map(b => [b.id, b.name]));
      for (const r of (pipe ?? []) as { user_id: string; batch_id: string | null }[]) {
        if (r.batch_id && nameOf.has(r.batch_id)) batchOf.set(r.user_id, nameOf.get(r.batch_id)!);
      }
    }
  }

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
      batch: batchOf.get(userId) ?? null,
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

  // 5 — She never got IN. Registered with her real name and phone, and the
  //     confirmation code never reached her, so there is no account, no profile
  //     row, and nothing anywhere shows her: she is invisible to every list in
  //     the portal, including the four reasons above, which all read
  //     candidate_profiles. She has to be pulled out of the auth records.
  //
  //     Never batched (she has no account to be batched into), so she can only
  //     ever appear under her own filter — the founder's rule is that the
  //     default view is the batch, and a signup that never completed is not
  //     holding up a seat. She is still worth one message: her phone number is
  //     right there and she wanted in.
  for (const u of await unconfirmedSignups()) {
    if (staff.has(u.userId)) continue;
    out.push({
      userId: u.userId,
      name: u.name || u.email || "—",
      firstName: u.firstName,
      phone: u.phone,
      lang: null,
      placementReady: false,
      batch: null,
      reason: "never_confirmed",
      urgency: 6,
      days: Math.round((now - u.createdAt) / DAY),
      detail: u.attempts > 1
        ? `tried to sign up ${u.attempts} times, ${Math.round((now - u.createdAt) / DAY)} days ago — the confirmation code never arrived`
        : `signed up ${Math.round((now - u.createdAt) / DAY)} days ago and never got in — the confirmation code never arrived`,
    });
  }

  // Batch members first, then by urgency. Someone holding up a seat at UKSH
  // outranks an equally-urgent problem on a candidate with no intake date.
  out.sort((a, b) =>
    (a.batch ? 0 : 1) - (b.batch ? 0 : 1) ||
    a.urgency - b.urgency ||
    (a.days ?? 0) - (b.days ?? 0) ||
    a.name.localeCompare(b.name));
  return out;
}
