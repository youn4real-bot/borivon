-- Rename payment tier 'kandidat' → 'premium' to match the rebuilt Stripe
-- product naming. Existing premium users (Oussama + Rayane and any future
-- 'kandidat' rows) are migrated in place so they keep premium access.
update candidate_profiles
   set payment_tier = 'premium'
 where payment_tier = 'kandidat';

-- Optional comment refresh — payments.sql describes the column. Old comment
-- mentioned 'starter' and 'kandidat' which are both retired.
comment on column candidate_profiles.payment_tier is
  'NULL = free | ''premium'' = €99 one-time OR €19/month × 6 cycles';
