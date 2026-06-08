-- ─────────────────────────────────────────────────────────────────────────────
-- B2 exam date — the actual date the candidate's B2 exam is/was, so the admin
-- B2-status overview + PDF can answer "when will they pass it". The stage
-- (Lernphase → Termin bestätigt → bezahlt & bestätigt → Ergebnis ausstehend →
-- bestanden) says WHERE they are; this says WHEN. Optional (null = no date yet).
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_profiles
  add column if not exists b2_exam_date date;
