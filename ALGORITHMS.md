# How the deck works

Source of truth: `lib/deck.ts`. To tune the deck, change `DECK_RULES` or add to `score`.

## The principle

The deck is a calculation, never a list edited in place. It comes from the film pool plus facts: who swiped what. `applySwipe` takes one fact and is safe to repeat and safe in any order, so a late, duplicated or out-of-order realtime event cannot corrupt anything.

The first four cards are **frozen**. `topUp` only ever appends, so nothing that happens elsewhere can move, remove or replace a card someone can see. Only that person's own swipe removes one. Likes and rejections change what comes after.

A film rejected while frozen stays until it is reached. It can no longer win, and nothing vanishes on screen.

## The rules

| Rule | Behaviour | Setting |
|---|---|---|
| Separate decks | Everyone gets their own opening slice of the shuffled pool, by join order | `sliceSize` |
| Private start | Others' likes are ignored and hidden until you have swiped this many, about 20 cards with the frozen ones | `privateCards` |
| Like spreading | After the private start, a film someone else liked jumps ahead, more likes rank higher | `likeBoost`, `perExtraLike` |
| Rejection | Once anyone says no, it leaves everyone's deck, because it can no longer be everyone's pick | Built in |
| Genre taste | +1 per like, -1 per no, added to each film's score | `genreStep` |
| Genre block | A film whose genres are all at or below the limit is hidden | `genreBlock` |
| Franchise block | One no hides that family. A like from you lifts it | Built in |
| Group beats personal | A film a friend liked ignores your genre and franchise blocks | Built in |
| Drip | Every 20 swipes, one card comes from outside your slice | `dripEvery` |

## The pool

Built on the server in `lib/tmdb.ts`: popular and top-rated films per chosen service, for Australia.

- Franchises are capped at two films, keeping the best-rated.
- Non-English films are capped at 15%.
- `lib/family.ts` joins franchises by name, because TMDB splits Spider-Man into at least four collections.
- Size is 40 films per person plus two spare slices, up to 400. A pool too small for one slice each is rebuilt without the already-dealt exclusion.
- Each Play Again reads further down the lists and excludes films already dealt.
- Play Again builds the new pool first, then `swap_game` replaces the game in one transaction. Phones reload films when the game number changes, so the number must never appear before the new films.

## Ending a round

Every round goes to the vote. A film everyone likes no longer ends swiping; it leads the shortlist instead.

- **Everyone ready, or the two-minute clock runs out:** the decider starts. Running out of cards counts as ready.
- **No likes:** no winner. **One liked film:** it wins, as there is nothing to vote on.

## The decider

Pure logic in `lib/decider.ts`, driven by `advance` in `app/api/room/route.ts`.

- The shortlist is every liked film, up to eight: films everyone liked first, then the most liked, then films someone also turned down. Ties go to the better rated film.
- Each person crosses one and ticks one, then confirms.
- Crossed films go. Ticked survivors continue. If nobody ticked a survivor, all survivors continue.
- Two films left is a final, tick only.
- A tie, or a round that eliminates nothing, goes to the randomiser, shown as a frame gliding between the tied posters and settling on one.
- Rounds last 30 seconds at five or more films, 20 at four, 15 at three, 10 at two.
- Votes still count for 2.5 seconds after the clock, and a phone resends a vote that got no answer.
- A round where not one vote arrived runs once more instead of going to the randomiser, because the votes were most likely lost on the way.

Every transition is a conditional update, so any client may call `advance` at any time and only one call wins.

## Tests

- `tests/deck.test.ts`: random play with fast swipes and late, repeated and out-of-order events. It asserts frozen cards never move and no film repeats.
- `tests/decider.test.ts`: every outcome, and that rounds always end.
- `tests/security.test.ts`: tries to break the database rules as a real user.
- `tests/flow.test.ts`: two people through a full round over the real API and realtime.

Run the deck tests after any rule change.
