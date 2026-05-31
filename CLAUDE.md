# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Mode

Normal, clear prose. (The previous "caveman" terse mode was removed at the user's request.)

## Commands

```bash
npm install            # install deps
npm run dev            # Next dev server on :3000
npm run build          # production build (passes through `next build`)
npm run start          # serve a built app
npm run lint           # next lint (deprecated upstream; use sparingly)
npm test               # run Vitest unit tests (tests/**)
npx tsc --noEmit       # type-check the whole tree without emitting
npx vercel --prod      # ship to prod (aliased to www.borivon.com)
```

**Vitest** is configured (`tests/**`, run `npm test`). It covers the security-critical invariants — passport gate (LAW #39), download-token auth, soft-delete gate, R2 path-safety, legacy-alias resolution, and the `lib/admin-auth` access-control core (LAW #25). Verification = `npx tsc --noEmit` + `npm test` + manual smoke through the dev server. When you touch any of those invariants, add/extend the matching test.

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

Slots are admin-defined per-org or global rows in `phase_slots`. Each carries `admin_signs / candidate_signs / admin_fills / candidate_fills` booleans + `candidate_signature_zone` (JSONB) + `template_pdf_path` (Supabase Storage) + `pdf_has_native_fields` (bool).

**Form-field DRAWING is removed.** Authors create fillable fields once in an external tool (Acrobat etc.); the portal only consumes PDFs that already have native AcroForm fields. The legacy `form_fields` JSONB column stays for back-compat with old slots (`PdfFieldFill` candidate component reads it) but nothing writes to it anymore.

Upload flow:
1. Admin uploads a PDF for a slot.
2. `detectAcroFormFields()` in `lib/pdfAcroFormFill.ts` inspects via pdf-lib. If >3 native fields found → `AutoFillReviewModal` opens (side-by-side `PdfViewer` + clickable hotspot overlay per field).
3. Hotspots auto-fill from `FIELD_CATALOG` via `suggestBinding()` keyword heuristic (candidate-unambiguous only — `vorname`, `geburtsdatum`, `reisepass`, etc.; deliberately NOT generic shared names like `strasse`, `plz`, `telefon` which appear in both candidate + employer sections).
4. Admin clicks any hotspot → inline popover with FIELD_CATALOG dropdown + literal text input. Live PDF re-fills on change.
5. Submit calls `fillAcroFormFields()` (pdf-lib `setText`/`check`/`select`, NO flatten — kept editable so employer can complete remaining fields by hand before printing) → uploads filled PDF to slot-templates bucket.
6. Mappings persist to `pdf_field_mappings` keyed by sha256 of sorted field-name list. Next upload of same form for any candidate auto-applies them. See `app/api/portal/admin/pdf-mappings/route.ts`.

If a slot has NO native fields (or <4), the slot config popup opens with two tiles: **Sign** (who signs?) and **Nothing** (just a doc). No "Fill" option — that requires native fields. Signature placement still uses the wizard with `PdfZonePicker` (admin → candidate sig steps).

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
- `lib/agencyFields.ts` — `AGENCY_FIELD_CATALOG` of employer/agency fields + `resolveAgencyField()`. Pulls from the admin's agency profile row (`agency_profiles` table).
- `lib/pdfAcroFormFill.ts` — `detectAcroFormFields()` + `suggestBinding()` + `fillAcroFormFields()`. Reads PDF widget rectangles + page index for the overlay; keyword table maps unambiguous field names only.
- `lib/stampSigOnPdf.ts` — client-side `pdf-lib` signature stamper.
- `lib/pdfFieldEmbed.ts` — **legacy only.** `FormField` type + `embedFields()` stamper used by `PdfFieldFill` (candidate-side legacy drawn fields). New work doesn't touch this.
- `lib/removeImageBg.ts` — Otsu bg-removal for signatures.
- `lib/relativeTime.ts` — `date-fns` wrappers (verbose/compact/day-label/clock).
- `lib/pdfjs.ts` — **SINGLE source of truth for pdf.js `getDocument` options** (`pdfLoadOptions`). EVERY pdf.js load MUST use it. It sets `wasmUrl` → `/pdfjs/wasm/`: pdf.js v5 decodes CCITTFax/JBIG2/JPEG2000 images via a WASM module, and some official forms (German EzB / Zusatzblatt agency forms) are built ENTIRELY from CCITTFax 1‑bit image masks — **without `wasmUrl` pdf.js silently drops every image and the page renders blank** (a real prod bug). Also sets cMap + standardFontData (non‑embedded fonts), `useSystemFonts:false`, `isOffscreenCanvasSupported:false`. The asset folders `/public/pdfjs/{wasm,cmaps,standard_fonts}` auto-sync from `node_modules/pdfjs-dist` on `postinstall` (`scripts/copy-pdfjs-assets.mjs`) so a pdfjs-dist upgrade can't leave them stale — never hand-edit them.
- `components/GlobalChrome.tsx` — site-wide chrome (Navbar + bell + chat + profile + bug-report). Route-gated per LAW #1.
- `components/Navbar.tsx` — top + mobile-bottom nav. Owns `portalTabs` (Dashboard / Community).
- `components/PdfViewer.tsx` — `pdfjs-dist` viewer with zoom toolbar + `pageOverlay` callback for absolute-positioned hotspots. Used by `AutoFillReviewModal`, `PdfZonePicker`, `PdfFieldFill`.
- `components/AutoFillReviewModal.tsx` — click-on-PDF auto-fill UX for native AcroForm PDFs.

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
- **Never reintroduce form-field drawing.** `PdfFieldPicker` was removed; native AcroForm fields are the only supported path. If admin needs fillable fields, they author the PDF externally (Acrobat, PDFescape, etc.) ONCE per form, then the portal handles every candidate from there.
- **Never auto-map ambiguous AcroForm keywords** (`strasse`, `plz`, `ort`, `telefon`, `email`, `hausnummer`) in `lib/pdfAcroFormFill.ts`'s `RULES`. Those names appear in both candidate (section B) and employer (section C) sections of typical forms — auto-mapping mixes them. Admin clicks the hotspot on the PDF once, template memory remembers per-signature.
- **Never `PDFDocument.load(passportBytes).save()`** (LAW #39). pdf-lib's load+save silently drops content streams on scanner-produced passport PDFs (photo + holograms survive, MRZ + VIZ text vanish, file size barely changes). Every serving path MUST gate on `isPassportFileType(file_type)` from `lib/passportFile.ts` and bypass any rotation / mutation. Passport rotation is CLIENT-side only (CSS transform on the iframe wrapper). If a future feature genuinely needs passport bytes mutated, propose the change explicitly — never silently extend safeRotatePdf to cover passports.
