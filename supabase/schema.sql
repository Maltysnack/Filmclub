-- ============================================================
-- Filmclub Database Schema
-- Run this in the Supabase SQL editor to set up your database
-- ============================================================

-- Sessions
create table if not exists sessions (
  id          uuid default gen_random_uuid() primary key,
  code        text unique not null,
  mode        text not null check (mode in ('planned', 'live')),
  deadline    timestamptz,           -- planned mode only
  threshold   integer default 100,  -- % of participants who must like (100 = unanimous)
  status      text default 'active' check (status in ('active', 'closed')),
  started     boolean default false,
  created_at  timestamptz default now()
);

-- Participants (no auth — identified by session-scoped UUID stored in localStorage)
create table if not exists participants (
  id          uuid default gen_random_uuid() primary key,
  session_id  uuid references sessions(id) on delete cascade not null,
  name        text not null,
  created_at  timestamptz default now()
);

-- Films (cached from TMDB — so we're not hammering the API constantly)
create table if not exists films (
  id           uuid default gen_random_uuid() primary key,
  tmdb_id      integer unique not null,
  title        text not null,
  poster_path  text,
  backdrop_path text,
  overview     text,
  release_year integer,
  runtime      integer,
  genres       jsonb default '[]',
  film_cast    jsonb default '[]',
  rating       numeric(3,1),
  created_at   timestamptz default now()
);

-- Films in a session's pool
create table if not exists session_films (
  id           uuid default gen_random_uuid() primary key,
  session_id   uuid references sessions(id) on delete cascade not null,
  film_id      uuid references films(id) not null,
  added_by     uuid references participants(id) on delete set null,
  created_at   timestamptz default now(),
  unique(session_id, film_id)
);

-- Swipes
create table if not exists swipes (
  id              uuid default gen_random_uuid() primary key,
  session_id      uuid references sessions(id) on delete cascade not null,
  participant_id  uuid references participants(id) on delete cascade not null,
  film_id         uuid references films(id) not null,
  liked           boolean not null,
  created_at      timestamptz default now(),
  unique(session_id, participant_id, film_id)
);

-- Matches (computed and stored when a match is detected)
create table if not exists matches (
  id          uuid default gen_random_uuid() primary key,
  session_id  uuid references sessions(id) on delete cascade not null,
  film_id     uuid references films(id) not null,
  score       integer not null,   -- number of participants who liked it
  matched_at  timestamptz default now()
);

-- ============================================================
-- Enable real-time on the tables we need live updates for
-- ============================================================
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table swipes;
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table participants;
alter publication supabase_realtime add table session_films;

-- ============================================================
-- Row Level Security (open for MVP — lock down later)
-- ============================================================
alter table sessions      enable row level security;
alter table participants   enable row level security;
alter table films          enable row level security;
alter table session_films  enable row level security;
alter table swipes         enable row level security;
alter table matches        enable row level security;

-- Allow all operations for now (tighten when you add auth)
create policy "Public access" on sessions      for all using (true) with check (true);
create policy "Public access" on participants   for all using (true) with check (true);
create policy "Public access" on films          for all using (true) with check (true);
create policy "Public access" on session_films  for all using (true) with check (true);
create policy "Public access" on swipes         for all using (true) with check (true);
create policy "Public access" on matches        for all using (true) with check (true);
