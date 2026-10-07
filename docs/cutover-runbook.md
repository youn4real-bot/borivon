# Supabase → D1 cutover runbook

The database moves to Cloudflare D1. Logins stay on Supabase. Files follow the storage branch's own switch
(`STORAGE_BACKEND`). Nothing in this document happens by itself: every switch is a wrangler var that ships
OFF, and every flip is a human editing `wrangler.jsonc` and deploying.

| Var (wrangler.jsonc `vars`) | Off (ships like this) | On | What "on" does |
|---|---|---|---|
| `MAINTENANCE_WRITES` | `"0"` | `"1"` | Every mutating `/api/*` request answers **503** `{ error, code: "maintenance", retryAfter }` in FR/EN/DE. `/api/health` still answers. Cron routes answer `200 {skipped}` without running, and `scheduled()` stops dispatching. The service client refuses data and storage writes. GETs keep working. `POST /api/leads` is the one exception: it still runs (details under the freeze step). |
| `DATA_BACKEND` | `"supabase"` | `"d1"` | The service client's `/rest/v1` reads, writes and RPC are answered by D1. Every successful write is appended to `_write_journal`. Shadow reads stop. Auth, storage and realtime still reach Supabase, and so does the auth-only RPC `admin_force_logout`. The cron alert's silence flag is read from D1. |
| `SHADOW_D1_RATE` | `"0.25"` today | `"0"` at the flip | That share of reads is replayed against D1 and compared. It only works while Supabase is the backend. |
| `STORAGE_BACKEND` | unset | `"r2"` at the flip; `"supabase"` for a rollback | Files are read and written in R2 (`supabase/<bucket>/<path>`), public URLs point at `/api/storage/v1/object/public/…` on our domain, signed URLs at `/api/storage/v1/object/sign/…` with an expiring token, and every upload/remove is mirrored to Supabase Storage. Once it has been `"r2"`, **never delete it**: `"supabase"` redirects the new URLs, while unset 404s them. |

Wrangler vars win over `.env.local` (OpenNext's `populateProcessEnv` sets the Worker env first and only fills
gaps from `.env.local`). Even so, **never put these three names in `.env.local`**: a missing wrangler var would
then fall back to the baked value.

Every deploy is **`npm run cf:build && npm run cf:deploy`**. `cf:deploy` alone ships the previous bundle.

---

## Before switch day (go / no-go)

- [ ] `node d1/shadow-report.mjs <repo-root> 24` prints **DIFFERENCES: none** over at least the last 24 hours.
- [ ] The adapter branch and every prep branch are merged. On that main: `npx tsc --noEmit` = 0, `npm test` green, `npm run cf:build` exit 0.
- [x] **Every screen is off Supabase Realtime.** Realtime follows Supabase's own write log, so on D1 the bell, the
  chat and the admin's live passport draft (LAW #38) would stop updating with no error at all. `node d1/cutover.mjs`
  enforces this as its step 1 (it matches `.on("postgres_changes"` as code, so comments do not count).

  Cleared 2026-10-05: `app/portal/dashboard/page.tsx` was the last file on Realtime, and the polling port was
  re-applied on top of production's version of that page — keeping the LAW #31/#32 guard that stops a failed read
  re-locking a stage the founder had opened, the fix for the wiped passport profiles, and `SessionExpiredNotice`.
  `grep -rn '.on("postgres_changes"' app lib components` now finds nothing.
- [ ] The orchestrator has applied the pending D1 schema changes (`d1/schema.sql`).
- [ ] `node d1/cutover.mjs <repo-root>` and `node d1/cutover.mjs <repo-root> --rollback` (both dry runs) print their steps without error.
- [ ] `npx wrangler deployments list`: write down the current Version ID as **PRE-SWITCH**.
- [ ] Pick the quietest hour (night in Casablanca). Candidates only notice the freeze if they save something during the window.

Two operations lose data if run after the flip. Neither may run then: `d1/import.mjs` and any "refresh" of D1,
because they empty tables that now hold the only copy of new writes. `cutover.mjs` refuses to import once
`_write_journal` has rows.

---

## Switch day, minute by minute

T = the moment you start. Build and copy times are placeholders. Take the real numbers from the Day-1 rehearsal.

**What the freeze costs.** For its length, nothing can be saved:
- Uploads, approvals, profile and passport saves show the calm maintenance notice or its message (FR/EN/DE).
  Chat and passport submit show the same message as their error.
- `POST /api/book` answers 503: **a visitor cannot book a call during the window.** That cost is why the hour matters.
- **Reading keeps working, and so does anything that only reads.** The admin search bar and its filters, the four
  PDF generators (CV, cover letter, both passport data sheets), the B2 report and the signup form's
  address check are POSTs that write nothing, so they are exempt and answer normally
  (`lib/maintenance.ts` `READ_ONLY_POSTS`). Registration itself also still works: the browser calls Supabase
  auth directly, never `/api`, and auth is not part of the copy.
- `POST /api/leads` still runs. The founder gets the lead on Telegram at once, marked
  "Maintenance : pas encore enregistré dans le portail". The funnel keeps it in the visitor's browser and re-sends
  it on their next visit, when it lands in the table. If they never come back, the Telegram message is the only
  record: add it by hand after the flip.

| T | Do | Healthy means |
|---|---|---|
| T+0 | In `wrangler.jsonc`, set `"MAINTENANCE_WRITES": "1"`, then `npm run cf:build && npm run cf:deploy` | build exits 0 and prints a Version ID |
| T+build | Write that Version ID down as **FREEZE**. It is the emergency rollback target. | |
| +1 min | `curl -s -X POST https://www.borivon.com/api/_cutover/freeze-probe` | **503** with `"code":"maintenance"` |
| | `curl -s "https://www.borivon.com/api/health?deep=1"` | `deps.writesFrozen: true`, `deps.d1Backend: false` |
| | Open the portal and try an upload | the calm maintenance notice appears (FR/EN/DE), and nothing crashes |
| +3 min | Wait 2 minutes so requests already in flight finish | |
| +5 min | `node d1/cutover.mjs <repo-root> --i-mean-it` | realtime ok, freeze ok, journal ok, drift ok, export, import, **parity 0 mismatch(es)**, the export directory removed, then it prints FLIP |
| | If the import step refuses with **D1 holds rows the export does not have**: those rows exist in D1 alone (a rehearsal write, a shadow artefact — it names the tables). Check in Supabase that each named table really is missing them, then re-run with `--drop-newer-d1-rows-in=<table>[,…]` to drop D1's copy and take Supabase's. **Never name a table the live site wrote**: that write exists nowhere else. | the re-run passes the import and reaches parity |
| | If it prints **REFUSING**: stop. Fix the cause and re-run, or abort (below). A refusal after the export also removes the export (it holds candidate data). `--keep-export` keeps it, with a warning. | |
| +files | `node storage/copy-to-r2.mjs <repo-root> --dry-run`. If it plans `copy` > 0, run it again without `--dry-run`. Supabase Storage cannot change during the freeze, and the app has never written R2, so no `--flipped-at` yet. | the plan line prints; any copies finish with `failed 0` |
| | `node storage/verify-r2-copy.mjs <repo-root>` | **PARITY OK**. `DOWNLOAD FAILED (side) … HTTP <code>` means the check could not read a file (an expired key, a 404) — not that the copies differ; fix the access and re-run. `CONTENT <key>` is the real mismatch: both sides downloaded and the bytes differ. |
| +copy | In `wrangler.jsonc`, set `"DATA_BACKEND": "d1"`, `"SHADOW_D1_RATE": "0"`, `"MAINTENANCE_WRITES": "0"` and `"STORAGE_BACKEND": "r2"` (leave `STORAGE_SUPABASE_MIRROR` unset: the mirror stays on), then `npm run cf:build && npm run cf:deploy` | build exits 0 |
| | Write that Version ID down as **FLIP**, and the UTC time the deploy finished as **FLIP time** (ISO, e.g. `2026-09-15T01:40:00Z`): the storage scripts need it | |
| +1 min | `curl -s "https://www.borivon.com/api/health?deep=1"` | `deps.d1Backend: true`, `deps.writesFrozen: false`, `deps.database: true` (that count now runs on D1) |
| | `curl -s -X POST https://www.borivon.com/api/_cutover/freeze-probe` | **404**, not 503 |
| +5 min | Smoke test: log in, open the dashboard, upload a small document, approve it as admin, send a chat message, open the bell | each works; the approval and the message show up within a poll |
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
- Files: `curl -s https://www.borivon.com/api/storage/v1/object/public/sign-documents/x` returns JSON
  `{"statusCode":"404","message":"Bucket not found"}` (a private bucket is never public; HTML means an old build).
  An existing `supabase.co` photo URL still returns 200. A newly changed profile photo is stored as
  `https://www.borivon.com/api/storage/v1/object/public/profile-photos/…` and returns 200 image/jpeg. A sign-request
  preview's `/api/storage/v1/object/sign/…` URL returns 200 application/pdf, and 400 JSON without `?token`.
- `node storage/copy-back-to-supabase.mjs <repo-root> --flipped-at <FLIP time>` (dry run) plans `copy back 0` and `report 0`.

**Logs** (`npx wrangler tail borivon --search "[write-journal]"`, or Workers Observability)
- `[write-journal] ok POST …` appears (the first three per isolate). This proves the journal is recording.
- **Zero** `[write-journal] LOST`. Each one is a write a rollback would miss. Stop and investigate. The rollback's parity gate would catch it, but only at rollback time.
- **Zero** `[d1-backend] DATA REQUEST REFUSED` and zero `[d1-backend] adapter failed to load`. D1 cannot be reached from the Worker, and data requests are failing closed.
- **Zero** `[write-freeze] refused` once the freeze is off.
- **Zero** `[r2-storage] MIRROR MISS` (`npx wrangler tail borivon --search "MIRROR MISS"`). Each one is an upload or
  remove that did not reach Supabase Storage, so a rollback would miss it until
  `storage/copy-back-to-supabase.mjs --flipped-at <FLIP time> --i-mean-it` repairs it.
- **No new** `[shadow-d1]` lines. Shadow reads stop on D1, so a fresh line means an old version is still serving. `node d1/shadow-report.mjs <repo-root> 1` should report 0 lines for the hour after the flip.

**Journal**: the `node d1/replay-journal.mjs <repo-root>` dry run shows the pending count rising with real traffic.
It should list no `body-unrecordable` WARN lines. `fill-*` WARN lines only mean a newly upserted row would get a
fresh id on a rollback.

**Cloudflare dashboard, D1 `borivon-db`**: queries flowing, error rate flat, storage growing slowly.

---

## Rollback, minute by minute (loses nothing)

Roll back when any of these happens: repeated `[write-journal] LOST`, `DATA REQUEST REFUSED`, a core save path
broken with no fix in about 30 minutes, or data visibly wrong.

"0 still pending" from the replay proves only that every write the journal **recorded** reached Supabase. A
write whose journal insert failed is in D1 alone. That is why the flip back waits for R3b, which compares every
row.

| T | Do | Healthy means |
|---|---|---|
| R+0 | In `wrangler.jsonc`, set `"DATA_BACKEND": "d1"` and `"MAINTENANCE_WRITES": "1"`, then `npm run cf:build && npm run cf:deploy` | build exits 0 |
| R+build | `curl -s -X POST https://www.borivon.com/api/_cutover/freeze-probe` | **503**. Writes have stopped, D1 still answers reads, and the journal stops growing. |
| +2 min | Wait: journal inserts finish after their responses (`waitUntil`) | |
| +3 min | `node d1/replay-journal.mjs <repo-root>` (dry run) | reads out the pending list and every WARN line |
| | `node d1/replay-journal.mjs <repo-root> --i-mean-it` | `ok` per write, ending with **`0 still pending`** |
| | If it prints **HALT**: fix the named cause, then re-run. Already-replayed writes are skipped, and the insert in doubt is recognised by primary key. `LATE` means a write was journaled after the replay passed its position. Confirm nothing is still writing, then re-run with `--allow-late`. | |
| **R3b** | `node d1/cutover.mjs <repo-root> --rollback --i-mean-it` | gate 1 freeze ok, gate 2 **0 pending**, gate 3 **parity 0 mismatch(es)**, then it prints **FLIP BACK** |
| | If it prints **REFUSING at parity**: do not flip back. parity-check names the table, the key and the columns that differ (never values). Look for a matching `[write-journal] LOST` line, redo that write by hand in Supabase, then run R3b again. `employers.updated_at` is the only column not compared: Supabase's trigger stamps it with the replay time, by design. | |
| +R3b | In `wrangler.jsonc`, set `"DATA_BACKEND": "supabase"`, `"MAINTENANCE_WRITES": "0"`, `"SHADOW_D1_RATE": "0"` and `"STORAGE_BACKEND": "supabase"` (never delete that var: unset 404s every file URL minted while R2 was active), then `npm run cf:build && npm run cf:deploy` | build exits 0 |
| +files | `node storage/copy-back-to-supabase.mjs <repo-root> --flipped-at <FLIP time>` (dry run). If it plans `copy back` > 0, run it again with `--i-mean-it`. If it reports objects still in Supabase but deleted from R2, review them by hand with `--list`: the script never deletes. | ends with `copy back 0`; a new upload made during the D1 period opens from its stored URL |
| +1 min | `curl -s "https://www.borivon.com/api/health?deep=1"` | `d1Backend: false`, `writesFrozen: false` |
| | Smoke test (same as above) | the writes made during the D1 period are visible |
| +10 min | `node d1/replay-journal.mjs <repo-root> --archive` (dry run), then with `--i-mean-it` | the three journal tables are renamed to `_archived_<date>_…`. It refuses while any entry is unreplayed. Without this, a later switch attempt is refused at "D1 has never been the backend". |

**Emergency: D1 itself is failing and the site cannot read.** Run `npx wrangler rollback <FREEZE>`. Supabase answers
reads again with writes still frozen, which is stale but readable. The journal lives in D1, so once D1 is back,
run the replay and R3b, then deploy `"MAINTENANCE_WRITES": "0"` (and `DATA_BACKEND` `"supabase"`). Never roll back to
**PRE-SWITCH** after the flip: it reopens writes on Supabase before the journal is replayed, and the replay would
then race live writes.

---

## Known gaps while D1 is the backend

- `admin_force_logout` (revoke a user's sessions on password reset) still reaches Supabase: it only touches the
  `auth` schema. Deleting a user (portal and bot) first clears every row tied to the login on D1
  (`lib/authLinkedRows.ts`, the catalog's 20 foreign keys to `auth.users`, journaled), then `app_delete_user` runs
  **on Supabase** (`SUPABASE_SIDE_RPCS` in `lib/d1/serviceFetch.ts`): the same rows in Supabase's copy plus the login,
  in one transaction. Both sides end identical, so a rollback has nothing extra to replay. (Fixed 2026-10-07: before,
  the fallback swept only 9 of the 20 and `auth.admin.deleteUser` was blocked by `invite_tokens.used_by` for anyone
  who signed up with an invite, so the account was banned and scrambled instead of deleted.)
  One residue: the route nulls `pdf_field_mappings.created_by` on D1 to keep shared mappings, while Supabase's
  function deletes its stale copy of those rows. 0 rows today; if a deleted admin had created mappings, R3b names
  `pdf_field_mappings` — re-insert those rows into Supabase by hand.
- `employers.updated_at`: after a rollback it holds the replay time, not the time of the edit on D1 (Supabase's
  `BEFORE UPDATE` trigger). Nothing reads it for decisions.
- Files: the journal covers database rows only; files have their own safety net. While `STORAGE_BACKEND="r2"`,
  every upload and remove is also mirrored to Supabase Storage (best effort, 15 s ceiling; a miss logs
  `[r2-storage] MIRROR MISS` and is repaired by `storage/copy-back-to-supabase.mjs`). Rolling files back = set
  `"STORAGE_BACKEND": "supabase"` (never delete the var: that 404s every URL minted while R2 was active), deploy,
  then `node storage/copy-back-to-supabase.mjs <repo-root> --flipped-at <FLIP>` (dry run; `--i-mean-it` if it plans
  copies). After the flip, never run `storage/copy-to-r2.mjs` without `--flipped-at <FLIP>`: without it the planner
  would recreate files the app deleted. Candidate documents already live in R2 either way.
- The journal's order is the moment D1 answered (`at_ms`, then a per-isolate sequence). Two isolates writing the
  same row in the same millisecond have no defined order. That was true on Supabase too.

## Day 3: downgrading Supabase

Supabase stays the login service and the rollback target. Before downgrading, confirm the journal is healthy
(above) and that nothing reads Supabase data (no new `[shadow-d1]` lines, `d1Backend: true`). Keep every table:
the replay writes back into them.

### Before downgrading Supabase to Free

Free has no backups, and it pauses a project after about 7 days without database activity (then nobody can log
in). The 06:00 UTC cron covers both (`lib/supabaseFreePlanSafety.ts`, riding `/api/cron/briefing`). Do not downgrade
until every box is ticked.

- [ ] This code is deployed (`npm run cf:build && npm run cf:deploy`). Without the key it only logs
  `[auth-backup] AUTH_BACKUP_KEY is not set` and skips the backup.
- [ ] `supabase/auth_users_backup.sql` has been run in the Supabase SQL editor (a read-only export, service_role
  only; `d1/check-drift.mjs` ignores the function it adds).
- [ ] On your laptop: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Save the value in
  your password manager first (a lost key means backups nobody can open), then `npx wrangler secret put AUTH_BACKUP_KEY`.
  Keep it OUT of `.env.local`: `npm run cf:build` compiles that file into the Worker bundle, so the key would ship
  inside it and `wrangler secret delete` would no longer take it away. Set it per shell when you decrypt instead.
- [ ] After the next 06:00 UTC run, the Worker logs (dashboard → Workers → borivon → Logs) show `[supabase-keepalive] ok`
  and `[auth-backup] ok backups/auth-users/<date>.json.enc accounts=<N>`, and no "Supabase keep-alive failed" or
  "Login backup failed" message or email arrived.
- [ ] That backup opens locally, in a folder outside the repo (the script refuses anywhere inside a git checkout):
  `npx wrangler r2 object get borivon-files/backups/auth-users/<date>.json.enc --file C:\Users\<you>\Desktop\auth.enc --remote`,
  then `$env:AUTH_BACKUP_KEY="<key>"; node d1/decrypt-auth-backup.mjs C:\Users\<you>\Desktop\auth.enc C:\Users\<you>\Desktop\auth.json`
  prints `<N>` accounts. Delete both files afterwards.
