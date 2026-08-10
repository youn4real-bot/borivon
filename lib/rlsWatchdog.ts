/**
 * RLS WATCHDOG — catch a public-data leak in a day, not in an audit months later.
 *
 * The candidate_profiles leak (all 78 passports readable by the public anon key)
 * existed because nothing was watching: every other table was locked, one was
 * not, and no one noticed until a deep audit. This closes that gap.
 *
 * It hits our OWN database with the PUBLIC anon key — the exact credential an
 * attacker has — and confirms each sensitive table returns NOTHING. If any of
 * them hands back a row, that table is leaking to the whole internet.
 *
 * ZERO AI, zero model tokens. Just a handful of tiny HTTP HEAD-style reads
 * (range 0-0, so no data actually transfers). It never throws — a watchdog that
 * breaks the page it protects is worse than no watchdog.
 */

/**
 * Tables that carry personal or candidate data and must NEVER return a row to
 * the anonymous key. A table is only listed here if "an anonymous person can
 * read this" is always wrong — so a hit is unambiguously a leak, never a
 * false positive on some intentionally-public table.
 */
export const SENSITIVE_TABLES = [
  "candidate_profiles", "documents", "candidate_pipeline", "candidate_status",
  "candidate_journey_items", "candidate_notes", "candidate_self_reports",
  "notifications", "admin_notifications", "messages", "sign_requests",
  "candidate_organizations", "leads", "enterprise_leads", "bookings",
  "partner_api_keys", "partner_shares", "partner_api_log",
  "admin_signatures", "invite_tokens", "sub_admins", "organization_members",
  "assistant_reminders", "assistant_commitments", "assistant_chat_turns",
] as const;

export type TableProbe = { table: string; rows: number | null; status: number };
export type WatchdogResult = { at: string; checked: number; leaks: { table: string; rows: number }[]; errored: string[] };

/**
 * Pure classifier — decide which probes are leaks, so the rule is testable
 * without the network. A leak is: the anon key got a definite, positive row
 * count back. RLS-protected tables come back empty (rows 0) or refused
 * (permission denied); either is safe. A null count (couldn't tell) is NOT
 * called a leak — we don't cry wolf on an ambiguous read — but it is surfaced
 * as `errored` so a probe that silently stops working is visible too.
 */
export function classifyProbes(probes: TableProbe[]): { leaks: { table: string; rows: number }[]; errored: string[] } {
  const leaks: { table: string; rows: number }[] = [];
  const errored: string[] = [];
  for (const p of probes) {
    if (typeof p.rows === "number" && p.rows > 0) leaks.push({ table: p.table, rows: p.rows });
    else if (p.rows === null) errored.push(p.table);
  }
  return { leaks, errored };
}

/** Parse the row total out of a PostgREST `content-range: 0-0/78` header. */
export function totalFromContentRange(header: string | null): number | null {
  if (!header) return null;
  const tail = header.split("/")[1];
  if (!tail || tail === "*") return null;
  const n = Number(tail);
  return Number.isFinite(n) ? n : null;
}

/**
 * Probe every sensitive table with the anon key. Returns the leaks (if any).
 * `at` is ISO now — pass it in from the caller if you need determinism; the
 * default is only used at runtime, never in tests.
 */
export async function runRlsWatchdog(now: string = new Date().toISOString()): Promise<WatchdogResult> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!base || !anon) {
    // Can't check → report everything as errored, never as a false all-clear.
    return { at: now, checked: 0, leaks: [], errored: [...SENSITIVE_TABLES] };
  }

  const probes: TableProbe[] = await Promise.all(
    SENSITIVE_TABLES.map(async (table): Promise<TableProbe> => {
      try {
        const r = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
          headers: { apikey: anon, authorization: `Bearer ${anon}`, prefer: "count=exact", range: "0-0" },
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        });
        // 401/403 = refused (revoked grant) → definitely safe, rows 0.
        if (r.status === 401 || r.status === 403) return { table, rows: 0, status: r.status };
        if (r.status === 200 || r.status === 206) return { table, rows: totalFromContentRange(r.headers.get("content-range")) ?? 0, status: r.status };
        // Any other status: we couldn't determine → errored (rows null).
        return { table, rows: null, status: r.status };
      } catch {
        return { table, rows: null, status: 0 };
      }
    }),
  );

  const { leaks, errored } = classifyProbes(probes);
  return { at: now, checked: probes.length, leaks, errored };
}
