-- Issue #106: add missing indexes on hot FK cascade paths.
-- Evidence (pg_stat_user_tables, prod):
--   participants  19,184 seq_scan vs 10,472 idx_scan  -- biggest hot-path miss
--   session_films     776 seq_scan, 3.9 MB of bloated index space on empty table
--   swipes            662 seq_scan, 1.1 MB of bloated index space on empty table
-- Composite UNIQUE indexes don't cover single-column FK lookups when the FK
-- column is not the leading key, so cascade deletes and per-FK reads seq-scan.

CREATE INDEX IF NOT EXISTS idx_participants_session_id
  ON public.participants (session_id);

CREATE INDEX IF NOT EXISTS idx_swipes_participant_id
  ON public.swipes (participant_id);

CREATE INDEX IF NOT EXISTS idx_swipes_film_id
  ON public.swipes (film_id);

CREATE INDEX IF NOT EXISTS idx_session_films_film_id
  ON public.session_films (film_id);

CREATE INDEX IF NOT EXISTS idx_session_films_added_by
  ON public.session_films (added_by);
