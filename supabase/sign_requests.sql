-- Sign requests: tracks documents sent for digital signature
--
-- Run once in Supabase SQL editor.
-- Safe to re-run — uses IF NOT EXISTS / IF NOT EXISTS patterns.

CREATE TABLE IF NOT EXISTS sign_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_user_id UUID        NOT NULL,
  created_by_email  TEXT        NOT NULL,
  document_name     TEXT        NOT NULL,
  note              TEXT,
  -- Storage path in the sign-documents bucket (e.g. "<candidateId>/<id>.pdf")
  pdf_storage_path  TEXT,
  -- status: pending | signed | declined
  status            TEXT        NOT NULL DEFAULT 'pending',
  signed_at         TIMESTAMPTZ,
  signed_pdf_path   TEXT,       -- storage path of the signed copy
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table already existed with old DocuSeal columns, add new ones safely:
ALTER TABLE sign_requests ADD COLUMN IF NOT EXISTS pdf_storage_path  TEXT;
ALTER TABLE sign_requests ADD COLUMN IF NOT EXISTS signed_pdf_path   TEXT;

-- Candidates can read their own rows; service-role bypasses RLS.
ALTER TABLE sign_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Candidates read own sign requests" ON sign_requests;
CREATE POLICY "Candidates read own sign requests"
  ON sign_requests FOR SELECT
  USING (candidate_user_id = auth.uid());

-- Storage bucket for PDFs (run separately in Supabase Storage UI or SQL):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('sign-documents', 'sign-documents', false)
-- ON CONFLICT (id) DO NOTHING;
