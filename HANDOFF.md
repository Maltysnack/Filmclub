# Handoff

## State
Branch `fix/play-again-swap`: Play Again builds the new pool, then `swap_game` (migration `20261107000000`) swaps the game in one transaction. Fixes swipes after Play Again failing silently (old films under the new game number). Typecheck, lint and unit tests pass. The new flow test needs local Supabase, so it has not run. Migration NOT applied to production; nothing deployed.

## Next steps (plan from first playtest, 6 Nov)
1. Done above. Apply migration, then deploy.
2. `session_events` table with durations; show swipe, Ready and vote failures on screen.
3. Survive a Supabase stall (one hit the VU7T vote, 14 to 35 s responses): verify logins locally with `getClaims`, never sign out on a failed check, request timeouts, simpler retried votes, reopen a round with no votes instead of a random pick.
4. Feel fast: optimistic Ready, show the lobby at once, stop full reloads on every event, time and speed up Start.
5. Polish: filled "Go to vote" button, prefetch IMDb for the next 4 cards and retry failures, slimmer Info links with no "N/A" while loading.
6. Round redesign: drop the instant unanimous win (trigger), first 20 cards private, shortlist of mutual likes first then single likes (4 to 8), 30 s first round, pool large enough for separate decks.
7. Housekeeping: revoke anon on `is_member` and `can_swipe`, index `swipes(session_id, film_id)`, check the Auth Site URL.
8. Deploy and a two-person retest including Play Again.

## Gotchas
- Git auto deploys are off. Deploy with `vercel --prod`.
- The Vercel connector needs team access approved before it can read deployments or logs.
- Supabase project `tpginnnnkbethhntsylx` (Sydney). Debug a session by code from `sessions`, `swipes`, `rounds`, `marks` and the Postgres and auth logs.
- Play Again deletes the previous game's swipes; cleanup deletes sessions after 3 days.

## Run
`npm ci`, `npm run typecheck`, `npm run lint`, `npm test`. Flow and security tests need `supabase start` and the dev server on port 3100, otherwise they skip.
