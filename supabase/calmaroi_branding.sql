-- One-time data setup: set Calmaroi's CV footer text.
-- Run once in Supabase → SQL Editor.
-- Each \n becomes a separate centered line on the generated CV footer.

UPDATE organizations
SET footer_text = E'Calmaroi GmbH\nRömerstraße 15 · 63450\nwww.calmaroi.de'
WHERE LOWER(name) = 'calmaroi';

-- Verify
SELECT id, name, footer_text FROM organizations WHERE LOWER(name) = 'calmaroi';
