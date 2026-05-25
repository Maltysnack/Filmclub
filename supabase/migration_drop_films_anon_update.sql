-- Issue #108: drop anon UPDATE on public.films.
--
-- films is a shared global cache (5,218 lifetime updates pre-fix). The
-- permissive RLS policy `USING (true)` for UPDATE meant any client with
-- the anon key (publicly visible in the browser bundle) could rewrite
-- any film row — poster, title, rating, providers — with no audit trail.
--
-- After this migration:
--   - SELECT  — still anon (films are public-read by design)
--   - INSERT  — still anon (sessions can cache newly-discovered films)
--   - UPDATE  — service role only. The /api/films/refresh route handles
--               provider/imdb/collection backfill server-side; daily
--               backfill-ratings + refresh-pool-cache crons handle the rest.
--
-- See: app/api/films/refresh/route.ts, lib/session.ts upsertFilm refresh path.

DROP POLICY IF EXISTS "anon can update" ON public.films;
