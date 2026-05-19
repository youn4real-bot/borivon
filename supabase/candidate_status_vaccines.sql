-- Vaccine status for candidate_status (admin-only, RLS-locked — candidate
-- never sees it). One JSONB blob so doses/vaccines stay flexible without a
-- migration per change. Shape:
--   {
--     "masern":   { "doses": [ { "got": true|false|null,
--                                "done_date": "YYYY-MM-DD"|null,
--                                "expected_date": "YYYY-MM-DD"|null } , … up to 2 ],
--                   "cert_expected": "YYYY-MM-DD"|null },
--     "varizell": { "doses": [ … up to 2 ], "cert_expected": … }
--   }
-- Rule (reminders only, not enforced): 1× Masern is the baseline; UKSH wants
-- 2× Masern + 2× Varizell; max 2 doses per vaccine.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR (additive — safe to re-run).
alter table public.candidate_status
  add column if not exists vaccines jsonb;
