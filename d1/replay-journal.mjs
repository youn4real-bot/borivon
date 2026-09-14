/**
 * ROLLBACK, the part that loses nothing: replay D1's write journal into Supabase.
 *
 *   node d1/replay-journal.mjs <repo-root>                  DRY RUN (default): list what would be sent
 *   node d1/replay-journal.mjs <repo-root> --i-mean-it      send it to Supabase, in order
 *     --limit N       stop after N entries (resume by running again)
 *     --allow-late    see "late entries" below
 *   node d1/replay-journal.mjs <repo-root> --archive [--i-mean-it]
 *                   after a COMPLETED rollback: rename the journal tables aside
 *                   so a later switch attempt starts from an empty journal
 *
 * "0 still pending" proves only that every write the journal RECORDED reached
 * Supabase. A write whose journal insert failed ("[write-journal] LOST") is in
 * D1 and nowhere else, so the flip back is gated on a row-by-row comparison
 * too: node d1/cutover.mjs <repo-root> --rollback --i-mean-it.
 *
 * While DATA_BACKEND="d1", every successful write the portal makes lands in D1
 * only, and lib/d1/writeJournal.ts appends each one to `_write_journal`. Flipping
 * back to Supabase without replaying that table would silently throw away every
 * upload record, approval, message and lead since the switch.
 *
 * Run it ONLY while writes are frozen (docs/cutover-runbook.md, rollback): a
 * portal still writing to D1 keeps adding entries behind the replay, and a portal
 * already writing to Supabase races the replay on the same rows.
 *
 * Idempotent, resumable:
 *   • Each entry is marked in `_write_journal_replayed` (in D1, keyed by entry id
 *     and the Supabase project) the moment Supabase accepts it; a re-run skips
 *     every marked entry. The only entry in doubt after a crash is the one being
 *     sent — an insert of it answers 23505 on the re-run, the row is looked up by
 *     primary key (a GET), and it is recorded "already present" instead of halting.
 *   • PATCH / DELETE carry absolute values and filters, so re-sending one is a no-op.
 *   • It HALTS on the first refusal it cannot explain, before anything later is
 *     sent — later writes may depend on that one (a message on a new thread).
 *
 * Late entries: journal inserts run after the response (waitUntil), so one can
 * land AFTER a replay has already passed its place in the order. The replay
 * refuses to continue past such an entry unless --allow-late is given, because
 * replaying it now puts an older write after a newer one.
 *
 * Nothing it prints carries a value — table, method and filter column names
 * only (the same rule as lib/d1/shadow.ts): the bodies are candidate data.
 * READ-ONLY against D1 in a dry run (it creates nothing); the only D1 write in a
 * real run is the replayed-marks table. Never touches Supabase in a dry run.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const JOURNAL_TABLE = "_write_journal";
export const JOURNAL_PART_TABLE = "_write_journal_part";
export const REPLAYED_TABLE = "_write_journal_replayed";

export const REPLAYED_DDL = `CREATE TABLE IF NOT EXISTS "${REPLAYED_TABLE}" (
  "journal_id" INTEGER NOT NULL,
  "target" TEXT NOT NULL,
  "at" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  PRIMARY KEY ("journal_id", "target")
)`;

/** Notes the journal leaves on an entry whose replay cannot be exact. */
const NOTE_WARNINGS = {
  "fill-unkeyed": "an upserted row had no conflict key; a newly inserted row gets a new id on Supabase",
  "fill-partial": "some generated values could not be read back; those rows get new ids on Supabase",
  "fill-failed": "generated values could not be read back; newly inserted rows get new ids on Supabase",
};

/**
 * Columns Supabase recomputes ITSELF when a replayed write lands, so after a
 * replay they differ from D1 by design, not by loss. The journal cannot carry
 * them: a BEFORE UPDATE trigger overwrites whatever value the request sends.
 * The rollback's parity gate compares everything except exactly these, and
 * says so (d1/parity-args.mjs). Kept in step with the Supabase catalog's
 * triggers by tests/parityArgs.test.ts.
 */
export const REPLAY_RECOMPUTED = {
  "employers.updated_at": "Supabase's BEFORE UPDATE trigger employers_set_updated_at stamps it with the replay time",
};

const isMissingTable = (err) => /no such table/i.test(String(err?.message ?? err));

/**
 * `PATCH candidate_profiles user_id=eq` — what an entry does, with every value
 * stripped. PostgREST puts the operator before the first dot, so the part before
 * it is code (a column and an operator) and everything after is data.
 */
export function describeEntry(e) {
  const u = new URL(e.path, "http://journal.invalid");
  const m = u.pathname.match(/\/rest\/v1\/(.*)$/);
  const what = m ? m[1] : "?";
  const keys = [];
  for (const [k, v] of u.searchParams) {
    if (k === "select" || k === "columns") keys.push(k);
    else if (k === "on_conflict") keys.push(`on_conflict=${v}`);
    else {
      const dot = v.indexOf(".");
      keys.push(dot > 0 ? `${k}=${v.slice(0, dot).replace(/[^A-Za-z0-9_(]/g, "")}` : k);
    }
  }
  return `#${e.id} ${e.method} ${what}${keys.length ? " " + [...new Set(keys)].join(" ") : ""}`;
}

/**
 * Prefer for the replay: whatever shaped the write (resolution=, missing=default)
 * stays; return= becomes minimal and count= goes. The portal needed rows back,
 * the replay does not — and asking for them would pull candidate data over the
 * wire for nothing.
 */
export function replayPrefer(prefer, isRpc) {
  const tokens = String(prefer ?? "").split(",").map((t) => t.trim()).filter(Boolean)
    .filter((t) => !t.startsWith("return=") && !t.startsWith("count="));
  if (!isRpc) tokens.push("return=minimal");
  return tokens.join(",");
}

/**
 * Put the generated values an upsert's database invented back into its rows,
 * and name them in `columns=` — PostgREST writes ONLY the listed columns, so a
 * merged id that is not listed would be silently dropped. The query string is
 * otherwise kept byte for byte: re-serialising it through URLSearchParams would
 * re-encode filter values PostgREST reads literally.
 */
export function mergeFill(pathAndQuery, bodyText, fill) {
  if (!fill || bodyText == null) return { path: pathAndQuery, body: bodyText };
  const parsed = JSON.parse(bodyText);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const added = [];
  rows.forEach((row, i) => {
    const f = fill[i];
    if (!f || !row || typeof row !== "object") return;
    for (const [k, v] of Object.entries(f)) {
      if (Object.prototype.hasOwnProperty.call(row, k)) continue;
      row[k] = v;
      if (!added.includes(k)) added.push(k);
    }
  });
  let outPath = pathAndQuery;
  const q = pathAndQuery.indexOf("?");
  if (added.length && q >= 0) {
    const segments = pathAndQuery.slice(q + 1).split("&");
    const i = segments.findIndex((s) => s.startsWith("columns="));
    if (i >= 0) {
      const list = decodeURIComponent(segments[i].slice("columns=".length).replace(/\+/g, " "))
        .split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
      for (const k of added) if (!list.includes(k)) list.push(k);
      segments[i] = `columns=${encodeURIComponent(list.map((c) => `"${c}"`).join(","))}`;
      outPath = `${pathAndQuery.slice(0, q)}?${segments.join("&")}`;
    }
  }
  return { path: outPath, body: JSON.stringify(Array.isArray(parsed) ? rows : rows[0]) };
}

/** The request that replays one entry against Supabase. */
export function buildReplayRequest(entry, bodyText, fill, target) {
  const merged = mergeFill(entry.path, bodyText, fill);
  const isRpc = /\/rest\/v1\/rpc\//.test(entry.path);
  const headers = { apikey: target.key, Authorization: `Bearer ${target.key}` };
  if (merged.body != null) headers["Content-Type"] = "application/json";
  const prefer = replayPrefer(entry.prefer, isRpc);
  if (prefer) headers.Prefer = prefer;
  const base = String(target.url).replace(/\/+$/, "");
  return { url: `${base}${merged.path}`, init: { method: entry.method, headers, body: merged.body ?? undefined } };
}

/**
 * A PostgREST error message without values. Constraint, relation, column and
 * function names are code and stay; any other quoted string (22P02 quotes the
 * input it could not parse) is data and goes.
 */
export function redactMessage(message) {
  return String(message ?? "")
    .replace(/(?<!(?:constraint|relation|column|function|table|type) )"[^"]*"/g, '"…"')
    .slice(0, 160);
}

async function loadJournal(d1, targetKey) {
  let entries;
  try {
    entries = (await d1.run(
      `SELECT "id", "at_ms", "seq", "method", "path", "prefer", "body_parts", "status", "note" FROM "${JOURNAL_TABLE}" ORDER BY "at_ms", "seq", "id"`,
    )).results;
  } catch (err) {
    if (isMissingTable(err)) return { exists: false, entries: [], applied: new Set() };
    throw err;
  }
  let applied = new Set();
  try {
    applied = new Set((await d1.run(`SELECT "journal_id" FROM "${REPLAYED_TABLE}" WHERE "target" = ?`, [targetKey])).results.map((r) => Number(r.journal_id)));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  return { exists: true, entries, applied };
}

/** One entry's body (reassembled from parts when it was too big for a row) and fill. */
async function loadBody(d1, entry) {
  const [row] = (await d1.run(`SELECT "body", "fill" FROM "${JOURNAL_TABLE}" WHERE "id" = ?`, [entry.id])).results;
  let body = row?.body ?? null;
  if (Number(entry.body_parts) > 0) {
    const parts = (await d1.run(`SELECT "n", "data" FROM "${JOURNAL_PART_TABLE}" WHERE "journal_id" = ? ORDER BY "n"`, [entry.id])).results;
    if (parts.length !== Number(entry.body_parts) || parts.some((p, i) => Number(p.n) !== i)) {
      throw new Error(`body has ${parts.length} of ${entry.body_parts} parts`);
    }
    body = parts.map((p) => p.data).join("");
  }
  return { body, fill: row?.fill ? JSON.parse(row.fill) : null };
}

/**
 * After a 23505 on a plain insert: are all its rows already in Supabase, by
 * primary key? Only then is it the in-doubt entry from an interrupted run.
 */
async function alreadyPresent(entry, bodyText, target, registry) {
  if (entry.method !== "POST" || /resolution=/.test(entry.prefer ?? "")) return false;
  const m = new URL(entry.path, "http://journal.invalid").pathname.match(/\/rest\/v1\/([A-Za-z0-9_]+)$/);
  const meta = m && registry?.[m[1]];
  if (!meta?.pk?.length || bodyText == null) return false;
  let rows;
  try { const p = JSON.parse(bodyText); rows = Array.isArray(p) ? p : [p]; } catch { return false; }
  if (!rows.length || rows.some((r) => !r || meta.pk.some((k) => r[k] === null || r[k] === undefined))) return false;
  const base = String(target.url).replace(/\/+$/, "");
  const headers = { apikey: target.key, Authorization: `Bearer ${target.key}` };
  // Row by row, so a composite key needs no special case; an insert the portal
  // makes is a handful of rows, and this only runs for the one entry in doubt.
  for (const row of rows) {
    const filters = meta.pk.map((k) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(String(row[k]))}`).join("&");
    const res = await target.fetch(`${base}/rest/v1/${m[1]}?select=${meta.pk.map(encodeURIComponent).join(",")}&${filters}&limit=1`, { method: "GET", headers });
    if (!res.ok) return false;
    const found = await res.json().catch(() => []);
    if (!Array.isArray(found) || found.length !== 1) return false;
  }
  return true;
}

/**
 * Replay the journal. Everything it talks to is injected, so the tests drive it
 * against node:sqlite and a fake Supabase:
 *   d1        { run(sql, params) → { results } }
 *   target    { url, key, fetch }   the Supabase project
 *   registry  d1/types.json         primary keys, for the in-doubt check
 */
export async function replayJournal({ d1, target, registry, dryRun = true, limit = Infinity, allowLate = false, log = console.log }) {
  const targetKey = new URL(target.url).host;
  const journal = await loadJournal(d1, targetKey);
  const summary = { ok: true, dryRun, journaled: journal.entries.length, alreadyReplayed: 0, pending: 0, sent: 0, alreadyPresent: 0, late: 0, warnings: [], haltedAt: null };
  if (!journal.exists) {
    log("journal: no _write_journal table in D1 — D1 has never answered a write. Nothing to replay.");
    return summary;
  }

  let lastApplied = -1;
  journal.entries.forEach((e, i) => { if (journal.applied.has(Number(e.id))) lastApplied = i; });
  const pending = journal.entries.filter((e) => !journal.applied.has(Number(e.id)));
  const late = journal.entries.slice(0, lastApplied + 1).filter((e) => !journal.applied.has(Number(e.id)));
  summary.alreadyReplayed = journal.entries.length - pending.length;
  summary.pending = pending.length;
  summary.late = late.length;
  for (const e of pending) {
    if (e.note === "body-unrecordable") summary.warnings.push(`${describeEntry(e)}: body was not recorded — cannot be replayed, redo by hand`);
    else if (NOTE_WARNINGS[e.note]) summary.warnings.push(`${describeEntry(e)}: ${NOTE_WARNINGS[e.note]}`);
  }

  log(`journal: ${journal.entries.length} write(s) · ${summary.alreadyReplayed} already replayed into ${targetKey} · ${pending.length} pending${late.length ? ` · ${late.length} LATE` : ""}`);
  for (const w of summary.warnings) log(`  WARN ${w}`);

  if (late.length && !allowLate) {
    for (const e of late) log(`  LATE ${describeEntry(e)}`);
    log("HALT: entries were journaled after the replay passed their place in the order. Check nothing else is still writing, then re-run with --allow-late.");
    summary.ok = false;
    return summary;
  }

  const batch = pending.slice(0, Number.isFinite(limit) ? Math.max(0, limit) : pending.length);
  if (dryRun) {
    for (const e of batch) log(`  would replay ${describeEntry(e)}`);
    log(`DRY RUN — nothing was sent to Supabase. Re-run with --i-mean-it to replay ${batch.length} write(s).`);
    summary.ok = pending.length === 0;
    return summary;
  }

  await d1.run(REPLAYED_DDL);
  for (const e of batch) {
    let outcome, status;
    try {
      if (e.note === "body-unrecordable") throw new Error("its body was not recorded; replay it by hand, then mark it replayed");
      const { body, fill } = await loadBody(d1, e);
      const req = buildReplayRequest(e, body, fill, target);
      const res = await target.fetch(req.url, req.init);
      status = res.status;
      if (res.ok) {
        outcome = "applied";
      } else {
        const err = await res.json().catch(() => ({}));
        if ((res.status === 409 || err?.code === "23505") && await alreadyPresent(e, req.init.body ?? null, target, registry)) {
          outcome = "already-present";
        } else {
          throw new Error(`Supabase answered HTTP ${res.status}${err?.code ? ` ${err.code}` : ""}${err?.message ? `: ${redactMessage(err.message)}` : ""}`);
        }
      }
    } catch (err) {
      log(`HALT at ${describeEntry(e)}: ${redactMessage(err instanceof Error ? err.message : err)}`);
      log("Nothing after it was sent. Fix the cause, then re-run: every write already replayed is skipped.");
      summary.ok = false;
      summary.haltedAt = Number(e.id);
      return summary;
    }
    try {
      await d1.run(
        `INSERT OR REPLACE INTO "${REPLAYED_TABLE}" ("journal_id", "target", "at", "status", "outcome") VALUES (?, ?, ?, ?, ?)`,
        [Number(e.id), targetKey, new Date().toISOString(), status, outcome],
      );
    } catch (err) {
      log(`HALT after ${describeEntry(e)}: Supabase accepted it but the mark could not be saved (${redactMessage(err instanceof Error ? err.message : err)}). A re-run re-sends only this entry.`);
      summary.ok = false;
      summary.haltedAt = Number(e.id);
      return summary;
    }
    summary.sent++;
    if (outcome === "already-present") summary.alreadyPresent++;
    log(`  ${outcome === "applied" ? "ok  " : "had "} ${describeEntry(e)}${outcome === "already-present" ? " (already in Supabase)" : ""}`);
  }
  summary.pending = pending.length - batch.length;
  summary.ok = summary.pending === 0;
  log(`replayed ${summary.sent} write(s); ${summary.pending} still pending${summary.pending
    ? " (re-run to continue)"
    : " — every JOURNALED write is replayed. Before flipping back, prove nothing else is missing: node d1/cutover.mjs <repo-root> --rollback --i-mean-it"}`);
  return summary;
}

export const ARCHIVE_PREFIX = "_archived_";
const JOURNAL_ORDER_INDEX = `${JOURNAL_TABLE}_order`;

async function existingTables(d1, names) {
  const rows = (await d1.run(
    `SELECT "name" FROM sqlite_master WHERE "type" = 'table' AND "name" IN (${names.map(() => "?").join(", ")})`,
    names,
  )).results;
  return new Set(rows.map((r) => String(r.name)));
}

/**
 * After a COMPLETED rollback, move the journal aside so the next switch attempt
 * can start. d1/cutover.mjs refuses to re-copy while `_write_journal` has rows
 * (an import would erase writes D1 alone holds) — right while a rollback is
 * pending, but permanent once it is done, leaving hand-dropped tables as the
 * only way out. Renamed, never dropped: the history of what D1 took stays.
 *
 * Refuses unless EVERY entry is marked replayed into this Supabase project.
 * Order matters for a crash half-way: the journal goes first (its order index
 * is dropped before, or the next journal's CREATE INDEX IF NOT EXISTS would
 * find the name taken and skip it), then its parts and marks. A re-run that
 * finds no journal but those leftovers renames them too — a leftover parts
 * table would otherwise collide with the next journal's ids.
 */
export async function archiveJournal({ d1, target, dryRun = true, now = () => new Date(), log = console.log }) {
  const targetKey = new URL(target.url).host;
  const stamp = now().toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "_");
  const rename = (t) => `${ARCHIVE_PREFIX}${stamp}${t}`;
  const present = await existingTables(d1, [JOURNAL_TABLE, JOURNAL_PART_TABLE, REPLAYED_TABLE]);

  let plan;
  if (present.has(JOURNAL_TABLE)) {
    const journal = await loadJournal(d1, targetKey);
    const pending = journal.entries.filter((e) => !journal.applied.has(Number(e.id)));
    if (pending.length) {
      log(`REFUSING to archive: ${pending.length} of ${journal.entries.length} journaled write(s) are not replayed into ${targetKey}. Replay them first.`);
      return { ok: false, archived: false, pending: pending.length };
    }
    log(`archive: all ${journal.entries.length} journaled write(s) are replayed into ${targetKey}.`);
    plan = [JOURNAL_TABLE, JOURNAL_PART_TABLE, REPLAYED_TABLE].filter((t) => present.has(t));
  } else {
    plan = [JOURNAL_PART_TABLE, REPLAYED_TABLE].filter((t) => present.has(t));
    if (!plan.length) {
      log("archive: no journal tables in D1 — nothing to archive.");
      return { ok: true, archived: false, pending: 0 };
    }
    log("archive: the journal is already archived; its leftover tables are renamed too.");
  }

  for (const t of plan) log(`  ${dryRun ? "would rename" : "rename"} ${t} -> ${rename(t)}`);
  if (dryRun) {
    log("DRY RUN — nothing was renamed. Re-run with --archive --i-mean-it.");
    return { ok: true, archived: false, pending: 0, tables: plan.map(rename) };
  }
  if (plan.includes(JOURNAL_TABLE)) await d1.run(`DROP INDEX IF EXISTS "${JOURNAL_ORDER_INDEX}"`);
  for (const t of plan) await d1.run(`ALTER TABLE "${t}" RENAME TO "${rename(t)}"`);
  log(`archived ${plan.length} table(s). A new switch starts with an empty journal.`);
  return { ok: true, archived: true, pending: 0, tables: plan.map(rename) };
}

/* ─────────────────────────────── CLI ─────────────────────────────── */

export function readEnv(root) {
  return Object.fromEntries(
    fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
  );
}

export const DEFAULT_D1_DATABASE_ID = "ffb9dcff-a501-4dc2-a94a-e5301e2595f0"; // borivon-db (WEUR)

/** D1 over Cloudflare's HTTP API, with the same busy-retry as lib/d1/client.ts. */
export function httpD1(env, database = process.env.D1_DATABASE_ID || DEFAULT_D1_DATABASE_ID) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/d1/database/${database}/query`;
  return {
    async run(sql, params = []) {
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(api, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ sql, params }),
        });
        const j = await res.json().catch(() => ({}));
        if (j.success) return { results: j.result?.[0]?.results ?? [] };
        const msg = (j.errors ?? []).map((e) => e.message).join("; ") || `D1 HTTP ${res.status}`;
        if (attempt < 4 && /overload|busy|timeout|temporarily/i.test(msg)) { await new Promise((r) => setTimeout(r, 400 * attempt)); continue; }
        throw new Error(msg);
      }
    },
  };
}

function argValue(args, name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return undefined;
  return args[i].includes("=") ? args[i].slice(name.length + 1) : args[i + 1];
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const root = args[0] && !args[0].startsWith("--") ? args[0] : null;
  if (!root) {
    console.error("usage: node d1/replay-journal.mjs <repo-root> [--i-mean-it] [--limit N] [--allow-late] | --archive [--i-mean-it]");
    process.exit(1);
  }
  const env = readEnv(root);
  const dryRun = !args.includes("--i-mean-it");
  let ok;
  if (args.includes("--archive")) {
    ({ ok } = await archiveJournal({ d1: httpD1(env), target: { url: env.NEXT_PUBLIC_SUPABASE_URL }, dryRun }));
  } else {
    const limitRaw = argValue(args, "--limit");
    ({ ok } = await replayJournal({
      d1: httpD1(env),
      target: { url: env.NEXT_PUBLIC_SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetch },
      registry: JSON.parse(fs.readFileSync(path.join(root, "d1", "types.json"), "utf8")),
      dryRun,
      limit: limitRaw === undefined ? Infinity : Number(limitRaw),
      allowLate: args.includes("--allow-late"),
    }));
  }
  // exitCode, not exit(): killing the process while a fetch socket closes trips
  // a libuv assertion on Windows (see d1/shadow-report.mjs).
  process.exitCode = ok ? 0 : 1;
}
