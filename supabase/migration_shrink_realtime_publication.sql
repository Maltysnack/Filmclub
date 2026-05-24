-- Issue #105: shrink realtime publication.
-- wal2json decoder is the top entry in pg_stat_statements (~75% of lifetime
-- DB CPU). Reducing the publication shrinks decode work per WAL change.
--
-- Audit (grep for `postgres_changes` across app/lib/components/hooks):
--   sessions          subscribed (page.tsx:849, results/page.tsx:122)
--   participants      subscribed (page.tsx:933, page.tsx:971, results/page.tsx:145/180)
--   swipes            subscribed (page.tsx:866, results/page.tsx:136)
--   session_films     subscribed (page.tsx:923)
--   shortlist_rounds  subscribed (page.tsx:419, results/page.tsx:131, ShortlistOverlay.tsx:180)
--   shortlist_vetoes  subscribed (ShortlistOverlay.tsx:219, ShortlistOverlay.tsx:227)
--   shortlist_votes   subscribed (ShortlistOverlay.tsx:238)
--   matches           NOT SUBSCRIBED — clients learn about a match via the
--                     `sessions` UPDATE (status → 'closed'), never via a
--                     `matches` INSERT subscription.
--
-- Only `matches` is droppable. Smaller scope than the issue body anticipated
-- (which guessed shortlist_vetoes/votes too — they ARE subscribed).

ALTER PUBLICATION supabase_realtime DROP TABLE public.matches;
