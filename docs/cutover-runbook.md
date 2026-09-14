# Supabase → D1 cutover runbook

The database moves to Cloudflare D1. Logins stay on Supabase. Files follow the storage branch's own switch
(`STORAGE_BACKEND`). Nothing in this document happens by itself: every switch is a wrangler var that ships
OFF, and every flip is a human editing `wrangler.jsonc` and deploying.

| Var (wrangler.jsonc `vars`) | Off (ships like this) | On | What "on" does |
|---|---|---|---|
| `MAINTENANCE_WRITES` | `"0"` | `"1"` | Every mutating `/api/*` request answers **503** `{ error, code: "maintenance", retryAfter }` in FR/EN/DE. `/api/health` still answers. Cron routes answer `200 {skipped}` without running, and `scheduled()` stops dispatching. The service client refuses data and storage writes. GETs keep working. |
| `DATA_BACKEND` | `"supabase"` | `"d1"` | The service client's `/rest/v1` reads, writes and RPC are answered by D1. Every successful write is appended to `_write_journal`. Shadow reads stop. Auth, storage and realtime still reach Supabase. |
| `SHADOW_D1_RATE` | `"0.25"` today | `"0"` at the flip | That share of reads is replayed against D1 and compared. It only works while Supabase is the backend. |

Wrangler vars win over `.env.local` (OpenNext's `populateProcessEnv` sets the Worker env first and only fills
gaps from `.env.local`). Even so, **never put these three names in `.env.local`**: a missing wrangler var would
then fall back to the baked value.

Every deploy is **`npm run cf:build && npm run cf:deploy`**. `cf:deploy` alone ships the previous bundle.

---

## Before switch day (go / no-go)

- [ ] `node d1/shadow-report.mjs <repo-root> 24` prints **DIFFERENCES: none** over at least the last 24 hours.
- [ ] The adapter branch and every prep branch are merged. On that main: `npx tsc --noEmit` = 0, `npm test` green, `npm run cf:build` exit 0.
- [ ] The orchestrator has applied the pending D1 schema changes (`d1/schema.sql`).
- [ ] `node d1/cutover.mjs <repo-root>` (dry run) prints its steps without error.
- [ ] `npx wrangler deployments list`: write down the current Version ID as **PRE-SWITCH**.
- [ ] Pick the quietest hour (night in Casablanca). Candidates only notice the freeze if they save something during the window.

Two operations lose data if run after the flip. Neither may run then: `d1/import.mjs` and any "refresh" of D1,
because they empty tables that now hold the only copy of new writes. `cutover.mjs` refuses to import once
`_write_journal` has rows.

---

## Switch day, minute by minute

T = the moment you start. Build and copy times are placeholders. Take the real numbers from the Day-1 rehearsal.

| T | Do | Healthy means |
|---|---|---|
| T+0 | In `wrangler.jsonc`, set `"MAINTENANCE_WRITES": "1"`, then `npm run cf:build && npm run cf:deploy` | build exits 0 and prints a Version ID |
| T+build | Write that Version ID down as **FREEZE**. It is the emergency rollback target. | |
| +1 min | `curl -s -X POST https://www.borivon.com/api/_cutover/freeze-probe` | **503** with `"code":"maintenance"` |
| | `curl -s "https://www.borivon.com/api/health?deep=1"` | `deps.writesFrozen: true`, `deps.d1Backend: false` |
| | Open the portal and try a save | the calm maintenance notice appears (FR/EN/DE), and nothing crashes |
| +3 min | Wait 2 minutes so requests already in flight finish | |
| +5 min | `node d1/cutover.mjs <repo-root> --i-mean-it` | freeze ok, journal ok, drift ok, export, import, **parity 0 mismatch(es)**, then it prints FLIP |
| | If it prints **REFUSING**: stop. Fix the cause and re-run, or abort (below). | |
| +copy | In `wrangler.jsonc`, set `"DATA_BACKEND": "d1"`, `"SHADOW_D1_RATE": "0"`, `"MAINTENANCE_WRITES": "0"`, then `npm run cf:build && npm run cf:deploy` | build exits 0 |
| | Write that Version ID down as **FLIP** | |
| +1 min | `curl -s "https://www.borivon.com/api/health?deep=1"` | `deps.d1Backend: true`, `deps.writesFrozen: false`, `deps.database: true` (that count now runs on D1) |
| | `curl -s -X POST https://www.borivon.com/api/_cutover/freeze-probe` | **404**, not 503 |
| +5 min | Smoke test: log in, open the dashboard, upload a small document, approve it as admin, send a chat message, open the bell | each works; the approval and the message show up at once |
| | `node d1/replay-journal.mjs <repo-root>` (dry run, read-only) | `N pending`, with N growing with each save; no `WARN … not recorded` |
| +60 min | Watch the logs (below) | no `LOST` or `REFUSED` lines |

**Abort before the flip** (nothing has changed yet): set `"MAINTENANCE_WRITES": "0"`, build and deploy. Or, faster,
run `npx wrangler rollback <PRE-SWITCH>`. Both are safe up to the flip deploy and only then.

---

## What "healthy" means after the flip

**URLs**
- `GET /api/health` returns 200 `healthy`. This is the uptime monitor's signal.
- `GET /api/health?deep=1` returns `d1Backend: true`, `writesFrozen: false`, and `database`, `r2`, `google`, `email` all as true as they were before the switch. `database` is a counted read of `documents`, which D1 now answers.
- `POST /api/_cutover/freeze-probe` returns 404. A 503 means some isolate still serves the frozen version.
- A new API route returns JSON, not the HTML of `app/[slug]`.

**Logs** (`npx wrangler tail borivon --search "[write-journal]"`, or Workers Observability)
- `[write-journal] ok POST …` appears (the first three per isolate). This proves the journal is recording.
- **Zero** `[write-journal] LOST`. Each one is a write a rollback would miss. Stop and investigate.
- **Zero** `[d1-backend] DATA REQUEST REFUSED` and zero `[d1-backend] adapter failed to load`. D1 cannot be reached from the Worker, and data requests are failing closed.
- **Zero** `[write-freeze] refused` once the freeze is off.
- **No new** `[shadow-d1]` lines. Shadow reads stop on D1, so a fresh line means an old version is still serving. `node d1/shadow-report.mjs <repo-root> 1` should report 0 lines for the hour after the flip.

**Journal**: the `node d1/replay-journal.mjs <repo-root>` dry run shows the pending count rising with real traffic.
It should list no `body-unrecordable` WARN lines. `fill-*` WARN lines only mean a newly upserted row would get a
fresh id on a rollback.

**Cloudflare dashboard, D1 `borivon-db`**: queries flowing, error rate flat, storage growing slowly.

---

## Rollback, minute by minute (loses nothing)

Roll back when any of these happens: repeated `[write-journal] LOST`, `DATA REQUEST REFUSED`, a core save path
broken with no fix in about 30 minutes, or data visibly wrong.

| T | Do | Healthy means |
|---|---|---|
| R+0 | In `wrangler.jsonc`, set `"DATA_BACKEND": "d1"` and `"MAINTENANCE_WRITES": "1"`, then `npm run cf:build && npm run cf:deploy` | build exits 0 |
| R+build | `curl -s -X POST https://www.borivon.com/api/_cutover/freeze-probe` | **503**. Writes have stopped, D1 still answers reads, and the journal stops growing. |
| +2 min | Wait: journal inserts finish after their responses (`waitUntil`) | |
| +3 min | `node d1/replay-journal.mjs <repo-root>` (dry run) | reads out the pending list and every WARN line |
| | `node d1/replay-journal.mjs <repo-root> --i-mean-it` | `ok` per write, ending with **`0 still pending`** |
| | If it prints **HALT**: fix the named cause, then re-run. Already-replayed writes are skipped, and the insert in doubt is recognised by primary key. `LATE` means a write was journaled after the replay passed its position. Confirm nothing is still writing, then re-run with `--allow-late`. | |
| +replay | In `wrangler.jsonc`, set `"DATA_BACKEND": "supabase"`, `"MAINTENANCE_WRITES": "0"`, `"SHADOW_D1_RATE": "0"`, then `npm run cf:build && npm run cf:deploy` | build exits 0 |
| +1 min | `curl -s "https://www.borivon.com/api/health?deep=1"` | `d1Backend: false`, `writesFrozen: false` |
| | Smoke test (same as above) | the writes made during the D1 period are visible |

**Emergency: D1 itself is failing and the site cannot read.** Run `npx wrangler rollback <FREEZE>`. Supabase answers
reads again with writes still frozen, which is stale but readable. The journal lives in D1, so once D1 is back,
run the replay, then deploy `"MAINTENANCE_WRITES": "0"` (and `DATA_BACKEND` `"supabase"`). Never roll back to
**PRE-SWITCH** after the flip: it reopens writes on Supabase before the journal is replayed, and the replay would
then race live writes.

---

## Known gaps while D1 is the backend

- `app_delete_user` (hard-delete a user) and `admin_force_logout` reach into Supabase's `auth` schema, and D1
  answers them "function not found" (`lib/d1/pgrest/rpc.ts`). They return with the auth move. Do these by hand in
  Supabase if one is needed during the window.
- Files: the journal covers database rows only. If `STORAGE_BACKEND=r2` is on, objects uploaded after that flip
  exist only in R2. The storage branch's `STORAGE_MEDIA_ROUTES=on` keeps their URLs serving after a rollback, but
  nothing copies them back into Supabase Storage. Candidate documents already live in R2 either way.
- The journal's order is the moment D1 answered (`at_ms`, then a per-isolate sequence). Two isolates writing the
  same row in the same millisecond have no defined order. That was true on Supabase too.

## Day 3: downgrading Supabase

Supabase stays the login service and the rollback target. Before downgrading, confirm the journal is healthy
(above) and that nothing reads Supabase data (no new `[shadow-d1]` lines, `d1Backend: true`). Keep every table:
the replay writes back into them.
