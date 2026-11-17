# Handoff

## State
`main` holds every fix from the 6 Nov playtest: Play Again in one
transaction, a session timeline for debugging, stall resilience, speed and a
round redesign. Typecheck, lint, unit tests and `next build` pass. Database
migrations are applied to production.

## Next steps
1. Deploy `main` to production (git auto deploys are off).
2. Two-person retest, including Play Again.
3. Check the Supabase Auth Site URL points at the production domain.
4. Run the flow and security tests (needs Docker for `supabase start`).

## Gotchas
- Flow and security tests need a local Supabase and the dev server on port 3100.

## Run
`npm ci`, `npm run typecheck`, `npm run lint`, `npm test`. Full setup in SETUP.md.
