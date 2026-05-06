-- Add tiebreaker_film_ids column to sessions
-- Used by startTiebreaker (lib/session.ts) and the results page to re-run a
-- swipe round on a tied subset of films when the original round produced
-- multiple matches that couldn't be resolved by score alone.
--
-- Note: this column was hand-applied to production but never committed as a
-- migration file. Anyone running schema.sql + migrations from scratch (fresh
-- dev, fresh staging) needs this to avoid runtime errors. See issue #66.
alter table sessions
  add column if not exists tiebreaker_film_ids uuid[] default null;
