-- Live classroom — per-class candidate invites. The admin picks specific
-- candidates when starting a class; each gets a notification + is allowed to
-- join (consent still required). Run after the other classroom SQL.
create table if not exists classroom_invites (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references classroom_sessions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  invited_at  timestamptz not null default now(),
  unique (session_id, user_id)
);
create index if not exists idx_classroom_invites_user    on classroom_invites(user_id);
create index if not exists idx_classroom_invites_session on classroom_invites(session_id);
