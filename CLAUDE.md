# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Mode

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Abbreviate common terms (DB/auth/config/req/res/fn/impl). Strip conjunctions. Use arrows for causality (X -> Y). One word when one word enough.

Technical terms stay exact. Code blocks unchanged. Errors quoted exact.

Pattern: `[thing] [action] [reason]. [next step].`

Active every response. Off only if user says "stop caveman" or "normal mode".

**Auto-clarity exception:** security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread. Resume caveman after.

## Commands

```bash
npm install            # install deps
npm run dev            # Next dev server on :3000
npm run build          # production build (passes through `next build`)
npm run start          # serve a built app
npm run lint           # next lint (deprecated upstream; use sparingly)
npx tsc --noEmit       # type-check the whole tree without emitting
npx vercel --prod      # ship to prod (aliased to www.borivon.com)
```

No test runner is configured. Verification = `npx tsc --noEmit` + manual smoke through the dev server.

SQL migrations live in `supabase/*.sql`. The user runs them by hand in the Supabase SQL editor — never ship a feature that depends on a new column without also writing the migration file and telling the user to run it before deploy.

## Tech Stack

- **Next.js 15** App Router, all pages are client components under `app/portal/**`.
- **React 19** + **TypeScript 5.9**.
- **Tailwind v4** via `@tailwindcss/postcss`. Styling is `style={{ … }}` for design tokens (`--gold`, `--w`, `--w2`, `--w3`, `--card`, `--bg2`, `--border`, `--border-gold`, etc. defined in `app/globals.css`) + utility classes for layout.
- **Supabase** for auth (Bearer JWT in every API call), Postgres tables (`documents`, `candidate_profiles`, `phase_slots`, `notifications`, `admin_notifications`, `organizations`, `organization_members`, `sub_admins`, `sign_requests`, etc.), and Storage buckets.
- **Google Drive API** (`googleapis`) for the candidate document store. Drive folder per candidate, `archive/` subfolder per LAW #33.
- **pdf-lib** (server-side) + **pdfjs-dist** (client-side viewer). **@react-pdf/renderer** for CV generation.
- **Stripe** for the premium subscription (price resolution by lookup_key, not hardcoded IDs).
- **Resend** for transactional email.
- **OSS UI primitives:** `focus-trap-react` (Modal), `@dnd-kit/*` (sortable lists), `signature_pad` (handwriting capture surface), `date-fns` (relative-time helper).

## The LAW system

The portal is governed by **34 numbered LAWS** stored in the user's memory at `C:\Users\youn4\.claude\projects\C--Users-youn4-Downloads-borivon\memory\laws.md`. These are unbreakable rules; never change one without the user saying `unlock LAW #N`. The MEMORY.md index loads automatically on every session — read both before writing code that touches portal behavior.

Each session, always re-read the laws before non-trivial changes. Recurring regressions on specific laws (LAW #1, LAW #20, LAW #31, LAW #33) are marked with explicit "Bug history" warnings — any code that re-introduces the broken pattern is a LAW violation on sight.

## High-level Architecture

### Routes

| Route | Audience | Purpose |
|---|---|---|
| `/portal` | logged-out | Login + register page. **LAW #1**: chrome-suppressed on this exact route. |
| `/portal/dashboard` | candidate | Documents (Essentials + Qualifications), Bearbeitung / Visum slots, CV builder gate, journey progress, org link modal. |
| `/portal/admin` | supreme admin + sub-admin | One panel handles all candidate review. Org-admins (sub_admins with is_agency_admin=true) get scoped to their org's candidates per LAW #25. |
| `/portal/admin/manage` | supreme admin only | Sub-admin invites + per-candidate assignments. |
| `/portal/admin/organizations` | supreme admin only | Org CRUD + branding + requirements + members. |
| `/portal/org/dashboard` | org members | Their org's pipeline / candidates. |
| `/portal/feed` | all logged-in | Community feed (global Borivon + per-org channels). |
| `/portal/cv-builder` | candidate | German-format CV builder. Generated CV uploads as `cv_de` slot. |
| `/portal/auth/callback` | any | Supabase auth code → session redirect. |

### Roles (resolved server-side in `lib/admin-auth.ts`)

- **`admin`** (supreme): email equals `process.env.ADMIN_EMAIL`. Full power, can act on every candidate. **Only role that can lock/unlock stages** (LAW #31).
- **`sub_admin`**: row in `sub_admins` table.
  - `is_agency_admin=false` → regular sub-admin, sees all candidates (LAW #25).
  - `is_agency_admin=true` → org admin, sees only candidates linked via `candidate_organizations` to one of their `organization_members.org_id` (LAW #25).
- **`org_member`** (separate user type): redirected to `/portal/org/dashboard`. Has read-only dossier access to candidates linked to their org.
- **`candidate`**: any other authenticated user.

`requireAdminRole(req)` and `requireUser(req)` always go through `getAnonVerifyClient().auth.getUser(jwt)` — never trust an `x-admin-token` header or any client-supplied identifier.

### Auth flow

Every API call carries `Authorization: Bearer <supabase JWT>`. Routes:
1. `requireAdminRole(req)` for admin/sub-admin routes, `requireUser(req)` for candidate-only.
2. `canActOnCandidate(role, email, candidateUserId)` gates per-candidate actions (LAW #25).
3. UUIDs and emails are validated **before** any DB call so bad input can't bypass auth.

Client side uses `supabase.auth.onAuthStateChange()` to keep `accessToken` fresh (JWT refreshes every ~55 min) — required or every page open for >1h gets 401s.

### Document lifecycle

1. **Upload** — `POST /api/portal/upload` with a multipart form (file + fileKey + fileType). Server constructs a Drive file in `<candidate>/` (or `<candidate>/sonstiges/`), writes a row to `documents`, fires an `admin_notifications` row.
2. **Naming convention (LAW #35-style — locked):** `<firstname>_<lastname>_pflegekraft_<doctype>[_original|_uebersetzt].<ext>`. Essentials drop the `_original/_uebersetzt` suffix (no translation counterpart); Qualifications keep both. See `lib/fileKeys.ts` for the catalog + legacy aliases.
3. **Approval / rejection** — admin opens `AdminDocPreviewModal`, sets status. Rejection forces the reject popup (`AdminRejectModal`) which requires non-empty text (LAW #20).
4. **Re-upload** — old Drive file moves to `<candidate-folder>/archive/<old-name>` (LAW #33). NEVER `drive.files.delete()`.
5. **Slot template rename** — `PATCH /api/portal/phase-slots` with a new `label` triggers `renameSlotDocs()` which renames every existing Drive file + DB row to match.

### Bearbeitung / Visum wizard slots (LAW #34)

Slots are admin-defined per-org or global rows in `phase_slots`. Each carries `admin_signs / candidate_signs / admin_fills / candidate_fills` booleans + `form_fields` (JSONB) + `candidate_signature_zone` (JSONB) + `template_pdf_path` (Supabase Storage).

The placement wizard (`placementWizard` state in `app/portal/admin/page.tsx`) walks admin through three optional steps **on the same PDF**:
1. **Fields**: `PdfFieldPicker` draws input boxes → binding popup (`FIELD_CATALOG` in `lib/candidateFields.ts`) maps each to a candidate profile / CV field. Live preview shows the resolved value. On submit, `embedFields()` bakes them into the PDF as static text; only free-fill boxes are saved to `form_fields`.
2. **Admin sig**: `PdfZonePicker` party="admin" with `partyPreviews={admin: adminSavedSig}`. Submit stamps via `stampSigOnPdf()`.
3. **Candidate sig**: `PdfZonePicker` party="candidate", saved as `candidate_signature_zone`. Candidate fills it in their fillForm later.

On final Submit, the modified PDF replaces `slot-templates/<slotId>.pdf` (old version archived via `slot-templates/archive/<slotId>_<timestamp>.pdf` per LAW #33), and a `slot_setup[_sign|_fill|_sign_fill]` notification fires (per LAW #21 + LAW #22).

### Signature flow (LAW #29)

- Both admin and candidate upload a **photo** of a handwritten signature.
- `lib/removeImageBg.ts` runs Otsu thresholding to strip the paper background. Otsu beats `@imgly/background-removal` here — high-contrast ink-on-paper is bimodal and Otsu completes <100ms with no model download (ML model would shave thin strokes and add 5-30s on first call).
- Admin signature persists in `admin_signatures` table; candidate signature in `candidate_profiles.saved_signature`. Both reusable across slots — upload once, drop into every zone.
- Final embedding into PDF via `lib/stampSigOnPdf.ts` (client-side `pdf-lib`).

### Notifications (LAW #21, LAW #22)

Two tables:
- `notifications` — per-candidate. Bell click → mark read + deep-link.
- `admin_notifications` — global to admins. Bell click → admin's deep-link event.

`doc_type` distinguishes routing for sign requests:
- `"slot_setup_sign_fill"` / `"slot_setup_sign"` / `"slot_setup_fill"` / `"slot_setup"` → wizard-driven B/V slot → `?slot=<id>` (auto-opens fillForm, scrolls to sig zone, pulses with `bvSigPulse` animation).
- `"sign_request"` → legacy stand-alone sign_request → `?sign=<id>` (PendingSignatures auto-opens PdfSignModal).

### Internationalization (LAW #19)

`lib/translations.ts` is the single source of truth. Every visible string has FR + EN + DE entries. Never hardcode a UI string in a single language — add a `pType*` / `t.*` key or use inline ternary `lang === "de" ? … : lang === "fr" ? … : …`. The `lang` context comes from `useLang()` (`components/LangContext.tsx`).

Backend filenames are German-only and ASCII (umlauts transliterate: ä→ae, ö→oe, ü→ue, ß→ss). Display labels keep umlauts and proper case.

### Status color encoding (LAW #4)

The portal uses **color only** to convey doc / box status — never text labels:
- ORANGE `#f59e0b` = pending
- GREEN `#16a34a` = approved
- RED `#ef4444` = rejected
- NEUTRAL (no color) = not submitted

LAW #15 adds the wizard-slot lifecycle: admin upload + no candidate action → green immediately; admin sends candidate request → orange (waiting candidate); candidate submits → orange (waiting admin review); approve → green; reject → red.

### Loading / bootstrap pattern

Every portal page loads via `Promise.allSettled([…critical fetches…])` then `setLoading(false)` exactly once. Premature `setLoading(false)` causes FOUC (sections pop-in one by one as parallel fetches resolve at different times). Non-critical fetches (signature lookup, sign-request list) fire **after** the reveal. See `app/portal/dashboard/page.tsx` bootstrap useEffect for the canonical pattern.

## Key library files

- `lib/admin-auth.ts` — `requireAdminRole`, `requireUser`, `canActOnCandidate`, `getVisibleCandidateIds`. Single source of truth for role + scope.
- `lib/translations.ts` — every visible string in 3 languages.
- `lib/fileKeys.ts` — fileKey ↔ translated-label catalog + legacy aliases for renamed labels.
- `lib/candidateFields.ts` — `FIELD_CATALOG` of 21 bindable candidate-data fields + `resolveFieldValue()`.
- `lib/stampSigOnPdf.ts` — client-side `pdf-lib` signature stamper.
- `lib/pdfFieldEmbed.ts` — `embedFields()` text stamper + `FormField` type.
- `lib/removeImageBg.ts` — Otsu bg-removal for signatures.
- `lib/relativeTime.ts` — `date-fns` wrappers (verbose/compact/day-label/clock).
- `components/GlobalChrome.tsx` — site-wide chrome (Navbar + bell + chat + profile + bug-report). Route-gated per LAW #1.
- `components/Navbar.tsx` — top + mobile-bottom nav. Owns `portalTabs` (Dashboard / Community).
- `components/PdfViewer.tsx` — `pdfjs-dist` viewer with zoom toolbar. Owned by `PdfFieldPicker`, `PdfZonePicker`, `PdfFieldFill`, etc.

## Useful patterns to imitate

- **Promise.allSettled bootstraps** — every critical-data load on a page should fan out in parallel and reveal once. See `app/portal/dashboard/page.tsx` and `app/portal/admin/page.tsx`.
- **Local caveman/inline i18n** — when a string only appears once and the file already uses ternary patterns, inline `lang === "de" ? … : …` is fine; otherwise add to `lib/translations.ts`.
- **`onAuthStateChange` listener** in every long-lived authenticated page to keep `accessToken` fresh.
- **Legacy aliases** in `lib/fileKeys.ts` whenever a label changes — old DB rows must stay findable.
- **`?param=<id>` deep links** that the page reads on mount then strips from the URL after consuming, so refresh doesn't re-trigger the action.

## Architectural traps to avoid

- **Never gate logged-in chrome on auth state at `/portal`** (LAW #1). Use `pathname === "/portal"` exclusively — auth-state reads are async and a cached session leaks chrome.
- **Never add a "completion gate" between stages** (LAW #32). The lock toggle is supreme-admin's discretion alone.
- **Never `drive.files.delete()`** on a candidate doc / slot template (LAW #33). Always move to an `archive/` folder.
- **Never store status text alongside the color** (LAW #4). Icons + color only.
- **Never bake `_DE` / `(German)` / "Pflege-" prefixes into display labels** when there's already a `pflegekraft` prefix in the filename — the user explicitly stripped these.
- **Never split sequential `await` chains** if they can be `Promise.all`'d (slows first paint without benefit).
