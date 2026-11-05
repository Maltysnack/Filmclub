-- Rate limiting inside Postgres, so there is no third-party service to run.
-- Unlogged: fast, and losing the counters in a crash only resets everyone's limits.
create unlogged table rate_hits (
  bucket text primary key,
  hits int not null,
  expires_at timestamptz not null
);
alter table rate_hits enable row level security;
revoke all on rate_hits from anon, authenticated;

-- Fixed window (shortcut: allows up to 2x the limit across a window boundary, fine for a demo).
create function rate_limit(p_name text, p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  win bigint := floor(extract(epoch from now()) / p_window_seconds);
  n int;
begin
  insert into rate_hits (bucket, hits, expires_at)
  values (p_name || ':' || p_key || ':' || win, 1, to_timestamp((win + 2) * p_window_seconds))
  on conflict (bucket) do update set hits = rate_hits.hits + 1
  returning hits into n;
  return n <= p_limit;
end $$;

revoke all on function rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function rate_limit(text, text, int, int) to service_role;
