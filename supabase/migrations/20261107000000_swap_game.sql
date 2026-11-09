-- Play Again swaps the whole game in one transaction. Phones reload films when the game
-- number changes, so the number must never become visible before the new films are in.
create function swap_game(p_session uuid, p_game int, p_films jsonb, p_seen int[], p_seconds int)
returns boolean
language plpgsql set search_path = '' as $$
begin
  -- Only one caller gets each swap, and only from a finished game.
  update public.sessions set
    game = p_game + 1,
    status = 'swiping',
    swipe_deadline = now() + make_interval(secs => p_seconds),
    winner_film_id = null,
    reveal_film_ids = '{}',
    seen_film_ids = p_seen
  where id = p_session and game = p_game and status = 'closed';
  if not found then return false; end if;

  delete from public.session_films where session_id = p_session; -- swipes go with them
  delete from public.rounds where session_id = p_session; -- marks go with them
  update public.participants set ready = false, rematch = false where session_id = p_session;
  insert into public.session_films (session_id, film_id, position, data)
    select p_session, f.film_id, f.position, f.data
    from jsonb_to_recordset(p_films) as f(film_id int, position int, data jsonb);
  return true;
end $$;

revoke all on function swap_game(uuid, int, jsonb, int[], int) from public, anon, authenticated;
grant execute on function swap_game(uuid, int, jsonb, int[], int) to service_role;
