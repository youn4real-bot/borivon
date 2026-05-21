# Borivon

Production portal at **www.borivon.com**.

Borivon helps nursing candidates (mostly from Morocco / North Africa)
move to Germany. Three audiences, one app:

- **Candidates** — upload passport, build a German-format CV, write a
  motivation letter, sign visa paperwork.
- **Admins (us)** — review every document, edit candidate data, assign
  employers / agencies, generate branded CVs.
- **Org members (partner recruitment agencies)** — read-only dossier
  view of candidates assigned to their org.

## Tech stack at a glance

| Piece | What it is |
|---|---|
| `next` 15 (App Router, React 19) | Frontend + API routes (all in `app/`) |
| Supabase | Postgres database, Auth, Storage |
| `googleapis` | Candidate document store (one Drive folder per candidate) |
| `pdf-lib`, `pdfjs-dist`, `@react-pdf/renderer` | PDF generation + viewing |
| Stripe | Premium subscription (price by lookup_key) |
| Resend | Transactional email |
| Vercel | Hosting + builds (`npx vercel --prod`) |

## Commands

```bash
npm install            # install deps
npm run dev            # Next dev server on :3000
npm run build          # production build
npm run start          # serve a built app
npx tsc --noEmit       # type-check (no test runner is set up)
npx vercel --prod      # ship to production at www.borivon.com
```

No tests are configured. Verification = `npx tsc --noEmit` + a manual
smoke through the dev server. `npm run lint` is configured but
`next lint` is deprecated upstream — use sparingly.

## Routes you'll touch most

| Route | Audience |
|---|---|
| `/portal` | Logged-out (login + register) |
| `/portal/dashboard` | Candidate |
| `/portal/cv-builder` | Candidate (CV form + PDF download) |
| `/portal/motivationsschreiben` | Candidate (cover letter) |
| `/portal/admin` | Supreme admin + sub-admin (the big review panel) |
| `/portal/admin/manage` | Supreme only — sub-admin invites |
| `/portal/admin/employers` | Supreme only — Manage Employers + Agencies |
| `/portal/admin/organizations` | Supreme only — org CRUD + branding |
| `/portal/org/dashboard` | Org members (recruitment agencies) |
| `/portal/feed` | All logged-in (community feed) |

## The data model in one sentence per table

- `auth.users` — Supabase auth identities; `user_metadata` has signup
  `first_name` + `last_name` (universal name fallback).
- `candidate_profiles` — one row per candidate (PK = `user_id`). Holds
  passport columns + the JSONB `cv_draft` + `employer_id` FK +
  `cv_use_agency_branding` admin toggle.
- `employers` — direct + via-agency employers. `agency_id` FK to
  `organizations` distinguishes the two.
- `organizations` — agencies / partner recruitment orgs. Has
  `logo_filename` + `footer_text` for CV branding.
- `candidate_organizations` — many-to-many link, drives branding +
  org-member visibility. `added_by` distinguishes self-joined (visible
  to candidate) vs admin-linked (silent placement).
- `candidate_status` — admin-only notes per candidate (B2 exam,
  vaccines, assignment mirror).
- `phase_slots` — Bearbeitung / Visum slot templates (admin-defined,
  per-org or global).
- `documents` — every uploaded file (Drive file id + status).
- `notifications` / `admin_notifications` — bell rows.

For schema details + migration order see `supabase/README.md`.

## The CV branding chain (most important non-obvious flow)

When an admin generates a candidate's CV (`?candidateId=<id>` on
`/portal/cv-builder`):

1. `cv_use_agency_branding === false` ? → use plain Borivon.
2. Else check `candidate_organizations` for an approved link → use
   that org's `logo_filename` + `footer_text`.
3. Else check `candidate_profiles.employer_id` → `employers.agency_id`
   → that org's branding.
4. Else plain Borivon.

When the **candidate** generates their own CV: always plain Borivon.
The `byAdmin` flag in `resolveBrand()` short-circuits before any of
the above.

Implementation: `app/api/portal/cv/generate/route.ts` `resolveBrand()`.

## Rules + Laws

The portal is governed by 38 numbered LAWS in the owner's memory at
`memory/laws.md`. These are unbreakable; ask the owner to "unlock LAW
#N" before changing one. Highlights:

- **LAW #1** — login page (`/portal` exactly) has no chrome.
- **LAW #19** — every visible string in FR / EN / DE.
- **LAW #25** — sub-admin visibility scopes via `candidate_organizations`.
- **LAW #29** — signature flow via handwritten photo + Otsu bg removal.
- **LAW #31** — only supreme admin can lock/unlock pipeline stages.
- **LAW #33** — archive replaced PDFs, never delete from Drive.
- **LAW #36** — universal popup pattern (z-[1100], blur 8, radius 20).
- **LAW #37** — admin override is absolute, autosave, last-write-wins.
- **LAW #38** — passport confirmation checkboxes are human-click only.

`CLAUDE.md` has the full architecture pointers for AI agents. This
README is the human-readable entry point.

## Where to put new code

- **Reusable UI primitives** → `components/`.
- **API endpoints** → `app/api/portal/...`.
- **Server-side helpers (shared)** → `lib/`.
- **DB migrations** → `supabase/*.sql` — author by hand, the owner
  runs them in the Supabase SQL editor. Never deploy a feature
  depending on a new column without also writing the migration and
  telling the owner to run it before deploy.
- **Translations** → `lib/translations.ts` (FR + EN + DE).

## Open reorganization items

The codebase is in production but has a few hot areas that would
benefit from incremental cleanup (kept for context, not blockers):

- `app/portal/admin/page.tsx` is ~7k lines — extracting the Status
  modal, Passport editor, and Candidate list into their own
  components would help.
- "Org" / "Organization" / "Agency" mean the same DB row in different
  surfaces — canonical name should be "Agency" (matches `agency_id` FK,
  the owner's spoken vocabulary, and the Manage Employers UI).
- `candidate_status.assign_*` columns duplicate `candidate_profiles
  .employer_id` and `candidate_organizations` — could be collapsed.
- Legacy `candidate_profiles.uksh_campus` enum — backfill into
  `employer_id` then drop.

None of the above are urgent. Ship features first, refactor when a
file is in your way.
