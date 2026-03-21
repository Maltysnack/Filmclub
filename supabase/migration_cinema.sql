-- ============================================================
-- Migration: Cinema mode + streaming services
-- Run this in the Supabase SQL editor
-- ============================================================

-- Add watch mode and streaming/cinema fields to sessions
alter table sessions
  add column if not exists watch_mode text default 'home'
    check (watch_mode in ('home', 'cinema', 'both')),
  add column if not exists streaming_services text[] default '{}',
  add column if not exists cinema_date date,
  add column if not exists cinema_time_from time,
  add column if not exists cinema_time_to time;

-- Add AU streaming availability to films cache
alter table films
  add column if not exists watch_providers_au jsonb default '[]';

-- Dendy session times (scraped from newtown.dendy.com.au)
create table if not exists dendy_sessions (
  id           uuid default gen_random_uuid() primary key,
  film_slug    text not null,
  film_title   text not null,
  tmdb_id      integer,
  tmdb_match   text default 'high' check (tmdb_match in ('high', 'low', 'none')),
  session_date date not null,
  session_times text[] not null default '{}',
  booking_urls  jsonb default '{}',  -- map of time -> checkout URL
  scraped_at   timestamptz default now(),
  unique(film_slug, session_date)
);

-- Enable real-time on dendy_sessions (not needed but future-proof)
alter publication supabase_realtime add table dendy_sessions;
