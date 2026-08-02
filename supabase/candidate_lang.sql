-- Remember which language each candidate actually reads.
--
-- Today the document approve/reject emails are sent in ALL THREE languages
-- stacked in one message, because there was nowhere to read her language from:
-- nothing stored it, and it is an ADMIN clicking approve, so the request carries
-- no hint either. That works, but it means the one email telling her a document
-- blocking her job application was refused arrives as a wall of three languages.
--
-- NULLABLE ON PURPOSE, and there is no backfill. A row with no language keeps
-- getting the trilingual email, exactly as today — so this is additive for every
-- existing candidate and improves only the ones who sign up (or set their
-- language) after it lands. Guessing a language from nationality would be worse
-- than saying nothing: plenty of Moroccan nurses read French, plenty read
-- Arabic, and some are already working in German.
--
-- Safe to run more than once.

alter table public.candidate_profiles
  add column if not exists lang text
    check (lang is null or lang in ('fr', 'en', 'de'));

comment on column public.candidate_profiles.lang is
  'Language the candidate reads: fr | en | de. NULL = unknown, senders fall back to the trilingual email.';
