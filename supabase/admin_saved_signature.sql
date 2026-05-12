-- Per-admin saved signature.
-- Stored as a base64 PNG data URI (same shape as candidate_profiles.saved_signature).
-- Admin uploads photo of their handwritten signature once → reused everywhere.
-- Run once in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.admin_signatures (
  admin_email TEXT PRIMARY KEY,
  signature   TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Anyone can read their own row, nothing else
ALTER TABLE public.admin_signatures ENABLE ROW LEVEL SECURITY;
