-- Add TMDB collection fields to films table
-- Used to suppress further films from a franchise after a user swipes no
alter table films add column if not exists collection_id   integer;
alter table films add column if not exists collection_name text;
