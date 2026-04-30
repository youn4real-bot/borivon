-- Add branding columns to organizations table.
-- logo_filename: filename in public/logos/ (e.g. "calmaroi-yellow.png")
-- footer_text:   newline-separated lines shown at the bottom of the CV PDF
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_filename TEXT,
  ADD COLUMN IF NOT EXISTS footer_text   TEXT;
