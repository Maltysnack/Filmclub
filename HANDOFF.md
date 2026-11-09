# Handoff

## State
Branch `fix/playtest-1` (contains `fix/play-again-swap`): every fix from the 6 Nov playtest. Typecheck, lint, unit tests and `next build` pass. All five new migrations are applied to production Supabase (history rows match the files). Code is NOT deployed, and production still runs the old build against the new schema, which is compatible.

What changed:
- Play Again swaps the game in one transaction (`swap_game`), so swipes after Play Again save.
- `session_events` timeline: phases, rounds, every action with its duration, client failure and slow reports. Kept 30 days.
- Stall resilience: logins checked locally with `getClaims`, 8 to 15 s timeouts, an expired token is renewed instead of a new identity, votes retried with a 2.5 s grace, a round with no votes runs once more.
- Speed: instant Ready, the lobby shows its code at once, realtime rows applied directly instead of full reloads, film cache warmed at create.
- Polish: filled "Go to vote" button, IMDb prefetched for the next four cards and retried, slimmer Info links.
- Round: no instant unanimous win, first ~20 cards private, shortlist of every like up to 8 (mutual first, rated ties), 30 s first round with 5+ films.

## Next steps
1. Merge to `main` and deploy (`vercel --prod`, or the Vercel connector once team access is approved).
2. Two-person retest including Play Again, then read the timeline (below).
3. Check the Supabase Auth Site URL; it looks like `localhost:3000`.

## Gotchas
- Git auto deploys are off.
- Flow and security tests need `supabase start` and the dev server on 3100; there is no Docker on this machine, so they have not run.
- Timeline: `select at, kind, ms, ok, detail from session_events where code = 'ABCD' or session_id = (select id from sessions where code = 'ABCD') order by at;`
- Supabase project `tpginnnnkbethhntsylx` (Sydney), free tier; one stall on 6 Nov had no clear cause.

## Run
`npm ci`, `npm run typecheck`, `npm run lint`, `npm test`.
