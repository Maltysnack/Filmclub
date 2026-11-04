-- Filmclub schema. The browser can read its own session and write its own swipes.
-- Every other write goes through the server with the service role.

create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{4}$'),
  status text not null default 'lobby' check (status in ('lobby', 'swiping', 'deciding', 'closed')),
  character_set text not null,
  services text[] not null check (cardinality(services) between 1 and 8),
  game int not null default 0,
  swipe_deadline timestamptz,
  winner_film_id int,
  reveal_film_ids int[] not null default '{}',
  seen_film_ids int[] not null default '{}',
  banned_users uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index sessions_created_at_idx on sessions (created_at);

create table participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  user_id uuid references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  is_bot boolean not null default false,
  is_host boolean not null default false,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id),
  unique (session_id, name),
  check (is_bot = (user_id is null))
);
create index participants_user_idx on participants (user_id);
create unique index one_host_per_session on participants (session_id) where is_host;

create table session_films (
  session_id uuid not null references sessions on delete cascade,
  film_id int not null,
  position int not null,
  data jsonb not null,
  primary key (session_id, film_id)
);

create table swipes (
  participant_id uuid not null references participants on delete cascade,
  session_id uuid not null,
  film_id int not null,
  liked boolean not null,
  created_at timestamptz not null default now(),
  primary key (participant_id, film_id),
  foreign key (session_id, film_id) references session_films on delete cascade
);
create index swipes_session_idx on swipes (session_id);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  number int not null,
  film_ids int[] not null,
  deadline timestamptz not null,
  resolved boolean not null default false,
  unique (session_id, number)
);

create table marks (
  round_id uuid not null references rounds on delete cascade,
  participant_id uuid not null references participants on delete cascade,
  session_id uuid not null references sessions on delete cascade,
  cross_id int,
  tick_id int not null,
  primary key (round_id, participant_id),
  check (cross_id is distinct from tick_id)
);
create index marks_session_idx on marks (session_id);

-- Runs with definer rights so the membership check does not recurse through RLS.
create function is_member(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.participants p
    where p.session_id = sid and p.user_id = auth.uid()
  );
$$;

create function can_swipe(pid uuid, sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.participants p
    join public.sessions s on s.id = p.session_id
    where p.id = pid and p.session_id = sid and p.user_id = auth.uid()
      and s.status = 'swiping'
  );
$$;

revoke all on function is_member(uuid), can_swipe(uuid, uuid) from public;
grant execute on function is_member(uuid), can_swipe(uuid, uuid) to authenticated;

alter table sessions enable row level security;
alter table participants enable row level security;
alter table session_films enable row level security;
alter table swipes enable row level security;
alter table rounds enable row level security;
alter table marks enable row level security;

create policy "members read" on sessions for select to authenticated using (is_member(id));
create policy "members read" on participants for select to authenticated using (is_member(session_id));
create policy "members read" on session_films for select to authenticated using (is_member(session_id));
create policy "members read" on swipes for select to authenticated using (is_member(session_id));
create policy "members read" on rounds for select to authenticated using (is_member(session_id));
create policy "members read" on marks for select to authenticated using (is_member(session_id));
create policy "swipe as yourself" on swipes for insert to authenticated with check (can_swipe(participant_id, session_id));

-- Hide the internal moderation list from members.
revoke select on sessions from authenticated, anon;
grant select (id, code, status, character_set, services, game, swipe_deadline, winner_film_id,
              reveal_film_ids, created_at) on sessions to authenticated;
revoke all on participants, session_films, rounds, marks from anon, authenticated;
revoke all on swipes from anon, authenticated;
grant select on participants, session_films, rounds, marks, swipes to authenticated;
grant insert (participant_id, session_id, film_id, liked) on swipes to authenticated;
revoke all on sessions from anon;

-- Unanimous like wins. The row lock serialises simultaneous swipes, so two last
-- likes arriving together cannot each miss the other.
create function resolve_unanimous() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  current_status text;
  people int;
  likes int;
begin
  if not new.liked then return null; end if;
  select status into current_status from public.sessions where id = new.session_id for update;
  if current_status is distinct from 'swiping' then return null; end if;
  select count(*) into people from public.participants where session_id = new.session_id;
  select count(*) into likes from public.swipes
    where session_id = new.session_id and film_id = new.film_id and liked;
  if people >= 2 and likes >= people then
    update public.sessions
      set status = 'closed', winner_film_id = new.film_id, reveal_film_ids = array[new.film_id]
      where id = new.session_id;
  end if;
  return null;
end;
$$;

create trigger swipes_resolve after insert on swipes
  for each row execute function resolve_unanimous();

alter publication supabase_realtime add table sessions, participants, swipes, rounds, marks;
alter table swipes replica identity full;
alter table participants replica identity full;
