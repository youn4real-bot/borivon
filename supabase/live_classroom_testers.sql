-- Live classroom — PRIVATE TEST allowlist.
-- While the classroom is in private testing, only candidates explicitly flagged
-- as testers (plus the supreme-admin host) may see or join it. Default false =
-- invisible to every candidate. The supreme admin flips this per candidate from
-- the candidate's Status → Engagement tab. Run AFTER the other classroom SQL.
alter table candidate_profiles
  add column if not exists classroom_tester boolean not null default false;
