-- Agency / employer profile used to auto-fill section C of forms like the
-- BA EzB. One row per admin user (supreme admin + sub-admins). When admin
-- uploads a PDF that has fields named "Firma", "Strasse", "Hausnummer",
-- "PLZ", "Ort", "Telefon", "E-Mail", "Betriebsnummer", etc., the auto-fill
-- modal pulls these values from the row, so the employer block is filled
-- without typing it for every candidate.
--
-- Stored per admin user (not per organization) so each admin can have their
-- own agency block. Most installations will have one admin → one row.
--
-- Run once in the Supabase SQL editor. Idempotent.

create table if not exists agency_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  firma          text,
  strasse        text,
  hausnummer     text,
  plz            text,
  ort            text,
  kontaktperson  text,
  telefon        text,
  email          text,
  telefax        text,
  betriebsnummer text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
