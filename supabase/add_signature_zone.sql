-- Adds the signature_zone column to sign_requests.
-- Run once in Supabase SQL editor. Safe to re-run.
ALTER TABLE sign_requests ADD COLUMN IF NOT EXISTS signature_zone TEXT;
-- JSON: { "page": 1, "x": 0.5, "y": 0.75, "w": 0.42, "h": 0.12 }
-- page: 1-indexed; x/y/w/h: normalized 0-1 fractions of page dimensions
