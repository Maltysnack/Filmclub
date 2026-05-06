-- Drop unused columns from sessions and the dead dendy_sessions table.
-- Each column was verified unreferenced across the codebase before drop.
--
-- Removed columns:
--   sessions.cinema_date / cinema_time_from / cinema_time_to — cinema feature
--     removed in commit ae94084 (#29). Columns were stranded.
--   sessions.session_type — phase tracking moved to shortlist_rounds.phase.
--   sessions.deadline — comment said "planned mode only" but never read.
--
-- Removed tables:
--   dendy_sessions — cinema scraping feature gone, zero references in code.
--
-- Issue #68. Already applied to production via Supabase MCP migration on
-- 2026-05-06; this file ensures fresh dev/staging deploys produce the
-- same final schema.
ALTER TABLE sessions DROP COLUMN IF EXISTS cinema_date;
ALTER TABLE sessions DROP COLUMN IF EXISTS cinema_time_from;
ALTER TABLE sessions DROP COLUMN IF EXISTS cinema_time_to;
ALTER TABLE sessions DROP COLUMN IF EXISTS session_type;
ALTER TABLE sessions DROP COLUMN IF EXISTS deadline;

DROP TABLE IF EXISTS dendy_sessions;
