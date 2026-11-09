-- Signed-out visitors have no reason to call the membership checks.
revoke execute on function is_member(uuid), can_swipe(uuid, uuid) from anon;

-- Covers the foreign key from swipes to session_films, which Play Again and cleanup
-- delete through. It also serves every query that filters swipes by session.
drop index swipes_session_idx;
create index swipes_session_film_idx on swipes (session_id, film_id);
create index marks_participant_idx on marks (participant_id);
