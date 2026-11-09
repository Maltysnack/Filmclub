-- A timeline for debugging: what each session did, how long it took, and what failed.
-- No foreign key, so a session's history outlives Play Again and the session itself.
create table session_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  session_id uuid,
  code text,
  game int,
  user_id uuid,
  kind text not null,
  ms int,
  ok boolean not null default true,
  detail jsonb
);
create index session_events_session_idx on session_events (session_id, at);
create index session_events_code_idx on session_events (code, at);

-- Server only. Members never read or write it directly.
alter table session_events enable row level security;
revoke all on session_events from anon, authenticated;
