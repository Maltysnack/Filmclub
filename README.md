# Filmclub

Swipe together. Pick one film.

A playful portfolio demo. Friends on a couch each swipe film posters on their own phone, with no login. Everyone starts with different films, and a film one person likes reaches the others. A film everyone likes wins instantly. If not, a fast cross-and-tick decider narrows it to one.

On your own? Press Test it and three bots join.

## Built with

Next.js, Supabase (Postgres, realtime, anonymous auth), Framer Motion, Tailwind CSS, TMDB and OMDb.

The interesting part is the deck. It is a pure calculation over swipe events, so realtime updates can arrive late, twice or out of order without a card moving on screen. See [ALGORITHMS.md](ALGORITHMS.md).

## Run it

See [SETUP.md](SETUP.md).

This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming data from JustWatch.
