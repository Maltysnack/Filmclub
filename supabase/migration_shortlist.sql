-- ============================================================
-- Migration: Shortlist mode
-- Run this in the Supabase SQL editor
-- ============================================================

-- Add session type to sessions (browse = normal swipe mode, shortlist = veto+vote mode)
alter table sessions
  add column if not exists session_type text default 'browse'
    check (session_type in ('browse', 'shortlist'));

-- One row per round of shortlist. Round 1 starts with all shortlisted films,
-- subsequent rounds start with only the tied films from the previous vote.
create table if not exists shortlist_rounds (
  id           uuid default gen_random_uuid() primary key,
  session_id   uuid references sessions(id) on delete cascade not null,
  round_number integer not null default 1,
  film_ids     uuid[] not null,       -- films active in this round
  phase        text not null default 'veto'
    check (phase in ('veto', 'vote', 'complete')),
  winner_id    uuid references films(id),  -- set when phase = 'complete'
  created_at   timestamptz default now(),
  unique(session_id, round_number)
);

-- One veto per participant per round.
create table if not exists shortlist_vetoes (
  id             uuid default gen_random_uuid() primary key,
  session_id     uuid references sessions(id) on delete cascade not null,
  round_number   integer not null,
  participant_id uuid references participants(id) on delete cascade not null,
  film_id        uuid references films(id) not null,
  created_at     timestamptz default now(),
  unique(session_id, round_number, participant_id)
);

-- One vote submission per participant per round (film_ids = up to 3 choices, capped at n-1).
create table if not exists shortlist_votes (
  id             uuid default gen_random_uuid() primary key,
  session_id     uuid references sessions(id) on delete cascade not null,
  round_number   integer not null,
  participant_id uuid references participants(id) on delete cascade not null,
  film_ids       uuid[] not null,
  created_at     timestamptz default now(),
  unique(session_id, round_number, participant_id)
);

-- Enable real-time
alter publication supabase_realtime add table shortlist_rounds;
alter publication supabase_realtime add table shortlist_vetoes;
alter publication supabase_realtime add table shortlist_votes;

-- RLS (open for MVP)
alter table shortlist_rounds  enable row level security;
alter table shortlist_vetoes  enable row level security;
alter table shortlist_votes   enable row level security;

create policy "Public access" on shortlist_rounds  for all using (true) with check (true);
create policy "Public access" on shortlist_vetoes  for all using (true) with check (true);
create policy "Public access" on shortlist_votes   for all using (true) with check (true);
