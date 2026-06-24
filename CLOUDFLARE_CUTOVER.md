# Cloudflare Cutover Runbook

How to move Borivon **fully off Vercel onto Cloudflare** — and how to roll back
instantly if anything looks wrong. Nothing here happens until you say **"go"**.
Vercel stays live and untouched as a one-click fallback the entire time.

This is written so we can do it together step by step. Steps marked **[me]** I run;
**[you]** are the few you do in a dashboard (DNS, secrets, the final switch).

---

## 0. What's already done (so you can trust the switch)

Everything the app does now runs on Cloudflare Workers, verified:

- ✅ Telegram bot brain · Gmail/Calendar · email send/reply/forward/draft
- ✅ File storage + serving on R2 (native binding — no extra keys)
- ✅ Security headers (CSP/HSTS) · cron automation (built, dormant)
- ✅ **All 4 PDFs** — CV, passport sheet, cover letter, B2 report — render in pure
  pdf-lib on Workers (pixel-verified against the old engine)
- ✅ Whole-app audit (47 agents) found 10 Workers issues → **all fixed + verified**
  (type-check + 763 tests + Cloudflare build all green)

The app is **code-complete for Cloudflare**. What remains is only the secure
config/DNS switch below.

---

## 1. Pre-cutover prep (do once, no user impact)

0. **[you] ⚠️ REQUIRED — finish the Drive→R2 backfill first.** A check on 2026-06-24
   found **129 of 402 documents** still live only on Google Drive (no `r2_key`).
   On Cloudflare those can't be read, so they'd break at cutover. **Fix: open
   `https://www.borivon.com/portal/admin/migrate` (logged in as the supreme admin)
   and click the migrate button** — it loops batches until `remaining: 0` (safe:
   it only copies, never deletes Drive). Then click **verify**. This must read
   `remaining: 0` before cutover. (Re-check anytime with
   `node scripts/cftest/checkR2Backfill.mjs`.)
1. **[you]** Confirm Cloudflare **Workers Paid ($5)** is active (it is — Queues work).
2. **[me]** Final green check on the branch: `npx tsc --noEmit` · `npm test` · `npm run cf:build`.
3. **[me]** Deploy the worker (still a parallel/test deploy — does NOT touch the live
   site or bot yet): `npm run cf:deploy` → `https://borivon.youn4real.workers.dev`.
4. **[you + me]** Set the worker **secrets** (write-only — I never see the values).
   Mirror **every** Vercel env var onto the worker, EXCEPT the three R2 S3 keys,
   which are no longer needed (the native R2 binding replaces them):
   - **Not needed on the worker:** `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
     (presigned URLs are unused; the binding handles all R2 access).
   - **Must be present:** Supabase keys · `ADMIN_EMAIL` · `DL_TOKEN_SECRET` · `CRON_SECRET` ·
     Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price/lookup config) ·
     Google (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_DRIVE_FOLDER_ID`,
     Vertex creds) · `AZURE_DOC_INTEL_ENDPOINT` + `AZURE_DOC_INTEL_KEY` (passport OCR) ·
     Resend (`RESEND_API_KEY`, `OUTBOUND_FROM_EMAIL`) · Turnstile · `NEXT_PUBLIC_BASE_URL`
     (set to `https://www.borivon.com`) · LiveKit/Daily (only if classroom is used).
   - The bot's ~21 secrets are already on the worker from Stage 1; this step adds the
     remaining website ones. `NEXT_PUBLIC_*` are public by design.
5. **[me]** Smoke-test the worker URL end to end while DNS still points at Vercel:
   home page, login, a candidate dashboard, generate a CV, generate the passport sheet,
   a Stripe test webhook (Stripe CLI → the worker URL), a file upload + download.

> At this point the worker is fully functional on its `*.workers.dev` URL and the
> live site/bot are still 100% on Vercel. Nothing has changed for users.

---

## 2. The cutover (the actual switch — reversible at every step)

Do these close together. Each is individually reversible.

1. **[you]** **Flip crons:** set the worker secret `CF_CRONS_ENABLED=true` **and** remove
   (or comment) the `crons` block in `vercel.json` + redeploy Vercel — in the **same
   window**. (Until now the worker's `scheduled()` handler is dormant so the two
   platforms don't double-fire the daily briefing/nudges.)
2. **[you]** **Point the domain:** in the Cloudflare dashboard, add `www.borivon.com`
   (and the apex if used) as a **Custom Domain** on the `borivon` worker. DNS is already
   on Cloudflare, so this is a routing change, not a nameserver change.
3. **[you]** **Repoint the Telegram webhook** to the worker (one API call, instant,
   reversible): `setWebhook` → `https://www.borivon.com/api/telegram/webhook` with the
   existing secret token. (Reverting = point it back at the Vercel URL.)
4. **[you]** **Update the Stripe webhook URL** in the Stripe dashboard to
   `https://www.borivon.com/api/portal/stripe/webhook` (same path; the domain now
   resolves to the worker). The signature secret is unchanged.
5. **[you]** **Update redirect URLs:** Supabase Auth (the `…/portal/auth/callback`
   allow-list) and any Google OAuth redirect URIs — only if the host changes; since the
   host stays `www.borivon.com`, usually **no change needed**.

---

## 3. Verify after cutover (≈10 minutes)

- **[me]** `curl https://www.borivon.com/` → 200 + security headers present.
- **[you/me]** Log in · open a candidate dashboard · generate a CV (downloads, looks right)
  · download the passport sheet · send a test message to the bot (it replies) · do a real
  file upload + download.
- **[you]** Make a Stripe **test** purchase → confirm `payment_tier` flips to premium.
- **[me]** Watch the worker logs (Cloudflare dashboard → Observability) for errors.
- **[you/me]** Next morning: confirm the daily briefing/nudge fired exactly **once** (not
  twice — proves crons cut over cleanly).

---

## 4. Rollback (if anything is wrong)

Each step reverses independently — no data is lost (Supabase + R2 are shared):

1. **Domain:** remove the Custom Domain from the worker / point `www` back to Vercel.
2. **Telegram:** `setWebhook` back to the Vercel URL.
3. **Stripe:** webhook URL back to Vercel (or it keeps working — same domain).
4. **Crons:** set `CF_CRONS_ENABLED` ≠ `true` and restore `vercel.json` crons + redeploy.

Vercel is never deleted until the Cloudflare deploy has run clean for a few days.

---

## 5. Optional follow-ups (after a clean cutover)

- Switch the Vercel PDF path to pdf-lib too and **drop `@react-pdf` + yoga** entirely.
- Decommission Vercel + remove the dev-only `scripts/cftest/` tooling and the throwaway
  `borivon-cftest` worker.

---

_Generated as part of the Cloudflare migration. The cutover is gated on your explicit
"go" — until then this is just the plan of record._
