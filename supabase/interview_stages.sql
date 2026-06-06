-- ─────────────────────────────────────────────────────────────────────────────
-- Interview lifecycle, split into its real stages. The old model collapsed
-- "she did the interview" and "she passed the interview" into one yes/no — but
-- those are different moments with a waiting gap between them:
--
--   1. TERMIN      the appointment date (often only EXPECTED, esp. the 2nd one)
--   2. DURCHGEFÜHRT she showed up + did the interview  (interviewN_held)
--   3. …warten…    results take time
--   4. ERGEBNIS    passed / didn't pass, on a result date (also expected→confirmed)
--
-- Every date carries a CONFIRMED flag: false = still just expected (the default,
-- because most dates start as "around then"), true = locked-in/real. The admin
-- flips Erwartet → Bestätigt once it's firm. Dates display German (TT.MM.JJJJ).
--
-- Reused (already exist): interviewN_date (the Termin), interviewN_status (result).
--
-- ▶ Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.candidate_pipeline
  -- Stage 2 — the interview actually took place (she attended + did it).
  add column if not exists interview1_held                 boolean not null default false,
  add column if not exists interview2_held                 boolean not null default false,
  -- Termin date: confirmed vs expected.
  add column if not exists interview1_date_confirmed       boolean not null default false,
  add column if not exists interview2_date_confirmed       boolean not null default false,
  -- Stage 4 — the result date (when the outcome came / is expected), confirmed vs expected.
  add column if not exists interview1_result_date          date,
  add column if not exists interview2_result_date          date,
  add column if not exists interview1_result_date_confirmed boolean not null default false,
  add column if not exists interview2_result_date_confirmed boolean not null default false,
  -- Same confirmed/expected treatment for the other planning dates in the wizard.
  add column if not exists visa_appt_date_confirmed        boolean not null default false,
  add column if not exists flight_date_confirmed           boolean not null default false;
