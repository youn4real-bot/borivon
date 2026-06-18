-- Passport / identity columns on candidate_profiles.
--
-- These back the passport OCR/confirmation flow (app/api/portal/passport/route.ts),
-- the CV builder, and the bot's getCandidateById / getCandidateDossier reads. They
-- EXIST in the live DB (added ad-hoc earlier), but had no tracked migration — so a
-- from-zero bootstrap per the README would miss them and break those features.
-- This file makes them reproducible. Additive + idempotent — safe to re-run.
--
-- ▶ Run once in the Supabase SQL editor.
alter table public.candidate_profiles
  add column if not exists dob                 date,
  add column if not exists sex                 text,
  add column if not exists nationality         text,
  add column if not exists passport_no         text,
  add column if not exists passport_expiry     date,
  add column if not exists issue_date          date,
  add column if not exists issuing_authority   text,
  add column if not exists city_of_birth       text,
  add column if not exists country_of_birth    text,
  add column if not exists address_street      text,
  add column if not exists address_number      text,
  add column if not exists address_postal      text,
  add column if not exists city_of_residence   text,
  add column if not exists country_of_residence text,
  add column if not exists marital_status      text,
  add column if not exists children_ages       text;
