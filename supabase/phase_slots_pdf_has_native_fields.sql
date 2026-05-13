-- LAW #30 Mode 1 — PDF already has digital fields
--
-- When admin uploads a PDF that already contains interactive form fields
-- (AcroForm / digital signatures already configured), there's no need for
-- admin to draw field boxes in the placement wizard. The candidate simply
-- types into the native fields the PDF was authored with.
--
-- Flag set via the 5th checkbox in the slot config popup. When true, the
-- wizard's "fields" step is skipped on submit.
--
-- Run once in Supabase SQL editor.

ALTER TABLE public.phase_slots
  ADD COLUMN IF NOT EXISTS pdf_has_native_fields BOOLEAN NOT NULL DEFAULT FALSE;
