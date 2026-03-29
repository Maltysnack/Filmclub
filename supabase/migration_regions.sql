-- Add region to sessions. Defaults to 'AU' so existing sessions are unaffected.
-- Supported values: ISO 3166-1 alpha-2 codes for the 15 supported regions.

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_region_check,
  ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'AU';

ALTER TABLE sessions
  ADD CONSTRAINT sessions_region_check
    CHECK (region IN ('AU','BR','CA','DE','ES','FR','GB','IN','IT','JP','KR','MX','NL','NZ','US'));
