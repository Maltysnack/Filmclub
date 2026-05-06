# Filmclub Queue Algorithms

This file documents every algorithm that decides which film a user sees, in what order, and what triggers session resolution. It is the single source of truth for how the swipe deck works.

**Audience:** anyone (human or AI) who needs to fix a bug in `app/session/[code]/page.tsx` or extend the queue logic. Read this *before* touching `handleSwipe`, `propagateFilm`, or the realtime subscription handler.

All line numbers reference files at the time of writing. They will drift as the codebase evolves — search by name (`handleSwipe`, `propagateFilm`, etc.) if a citation is stale.

---

## Design philosophy: convergence vs. variance

The deck balances two opposing forces. Both are intentional.

**Convergence** — push the group toward agreement on a film:
- Like propagation
- Genre priority
- Match detection (threshold-based)
- Shortlist resolution (fallback when no organic match)

**Variance / diversity** — make sure the group covers enough ground before converging:
- Slot allocation (each of first 4 participants sees a different 40-film slice)
- Genre suppression (hide films when all their genres have been disliked)
- Collection blocking (hide franchise siblings of disliked films)
- Foreign language cap (hide >15% non-English films in English-primary regions)
- Drip (introduce fresh films into the queue every 20 swipes)
- Pool seeding (which films are even in scope, by streaming services × region)

The 30-second minimum session timer is a meta-control: it forces variance to play out for at least 30 seconds before convergence is allowed to close the session.

---

## Convergence algorithms

### 1. Like propagation

**File:** `app/session/[code]/page.tsx`, function `propagateFilm` (around line 618)

**Trigger:** the realtime subscription receives a swipe INSERT event from another participant where `liked === true`.

**Effect:** surface that film near the top of *this* user's deck, so the social signal spreads quickly.

**Three tiers** (in order, first match wins):
1. **In-queue move.** Film is already in the user's queue at position > ci+1 → move it closer to the front (target position `ci + 2 + random(0..2)`, after #63).
2. **Reserve pull.** Film is in the user's reserve queue → pull it out of reserve, splice into queue at `ci + 2`.
3. **Cross-slot inject.** Film exists in `allSessionFilmsRef` but not in this user's queue or reserve (i.e., it lives in another participant's slot) → inject from `allSessionFilmsRef` at `ci + 2`. Skipped if the user has already swiped this film (check `mySwipeHistoryRef`).

**Important post-#63 invariant:** propagation NEVER places a film at `ci + 1` (the position about to become the front card after a swipe). Always `ci + 2` minimum. This is defensive — even if currentIndex updates and propagation race in subtle ways, the front-card-to-be can't be displaced.

**Deferred during drag:** if `swipeInProgress.current === true`, the film ID is pushed to `pendingPropagationsRef` and flushed when the drag ends (via the SwipeCard's `onDragEnd` prop). This prevents yanking the card out from under the user's finger.

**Confirmed working as of #65** but the tier-priority logic (in-queue vs reserve vs cross-slot) is not unit-tested.

### 2. Genre priority

**File:** `app/session/[code]/page.tsx`, function `findPriorityFilmInWindow` (line 105) and the swap block in `handleSwipe` (around line 949).

**Trigger:** runs inside `handleSwipe` after a swipe. Recomputes a per-user `genreScores` map (+1 per genre on like, -1 on dislike). Genres with score ≥ +3 are "priority."

**Effect:** if there are any priority genres, scan the next 10 cards (`GENRE_PRIORITY_WINDOW`) for the first film that:
- has at least one priority genre
- is not currently genre-blocked (all genres ≤ -3 score)
- is not franchise-blocked (unless someone else liked it)

If found at index `swapIdx > ci + 1`, swap that film into position `ci + 1`, displacing whatever was there.

**The swap respects propagated films:** if the film at `ci + 1` is already liked by another participant (`filmLikesRef.current.get(filmAtNext.id).some(id => id !== participant?.id)`), the swap is skipped. This protects social signals from being overridden by personal genre affinity.

**Constants** (line 63-65):
- `GENRE_BLOCK_THRESHOLD = -3` (score at-or-below → genre is suppressed)
- `GENRE_PRIORITY_THRESHOLD = +3` (score at-or-above → priority)
- `GENRE_PRIORITY_WINDOW = 10` (look-ahead distance)

### 3. Match detection

**File:** `lib/session.ts`, functions `checkForMatch` (line 386) and `checkAllMatches` (line 421).

**Trigger paths** (3 places call it):
1. `handleSwipe` after a like, with the local participant ID.
2. The realtime subscription's belt-and-suspenders re-check, with the remote swiper's participant ID, when the user has also liked the same film.
3. `handleStart`'s `checkAllMatches` for any pre-existing matches from lobby swipes.

**Logic:** a match is created when `(likeCount / participantCount) * 100 >= session.threshold`. Default threshold is 100% (unanimous).

**Per-participant cooldown (post-#64):** before creating a match row, queries for any prior match in this session by the *same triggering participant* within the last 5 seconds. If found, returns false and skips. This prevents one fast-swiping user from creating multiple consecutive matches in a burst. Concurrent matches by different participants are unaffected.

**Idempotency:** the upsert uses `ignoreDuplicates: true` so the first triggered_by attribution wins across realtime races. `score` may go slightly stale on subsequent likes for the same film but it's only used for ordering (verified: `lib/session.ts:519`), never as a source of truth for whether a match exists.

**Outcome:**
- 0 matches when timer expires → continue swiping
- 1 match → `resolveMatch` (closes session with that winner)
- 2+ matches → `closeSession` (triggers shortlist vote flow)

**Deferred during 30-second grace period (post-#62):** all three trigger paths check `inGracePeriod()` and skip resolution. Match rows are still created. The grace-period effect (line ~277) resolves accumulated matches when the timer fires.

### 4. Shortlist resolution

**File:** `lib/shortlist.ts` and `components/ShortlistOverlay.tsx`.

**State machine** stored in `shortlist_rounds` table with `phase`: `nominate | veto | vote | spinning | complete`.

**Phases** (in order):
1. **Nominate** — each participant adds one film to the shortlist (host can skip this).
2. **Veto** — only runs if shortlist has > 2 films. Each participant has 1 veto. Films with the most vetoes are removed.
3. **Vote** — each participant gets `Math.ceil(filmCount / 5)` votes. The pure function `tallyVotes` (line 144 of shortlist.ts) returns one of:
   - `{ winner: id }` — unanimous, or only 1 survivor → done
   - `{ tied: ids }` — 2-film final round with equal votes → spin wheel
   - `{ survivors: ids }` — 2+ films survived the vote → next round
4. **Spinning** — random tiebreaker, animation broadcast to all clients.

**`tallyVotes` is pure (no DB, no state).** This is why it's testable; everything else in the shortlist UI is intertwined.

---

## Variance algorithms

### 5. Slot allocation

**File:** `app/session/[code]/page.tsx`, in `loadFilms` (around line 509).

**Effect:** the first 4 participants (sorted by `created_at`) each get a non-overlapping 40-film slice of the auto-seeded pool. Slot 0 = films 0-39, slot 1 = 40-79, slot 2 = 80-119, slot 3 = 120-159.

**Why:** maximises coverage from swipe 1. With 4 people and unique slots, the group collectively swipes 160 different films before propagation pulls things together.

**Fallback:** participant 5+ (and any participant whose slot would extend past the available pool size) gets a seeded shuffle of the full pool. Seed is derived from `participantId` (`Math.imul(31, seed) + charCode`) so reshuffles are stable across page reloads.

**The pool needs ≥ 160 films for the slot system to actually fire for slots 1-3.** When the pool is undersized (early in seeding), all participants fall back to shuffle. This is intentional — the slot system's coverage benefit is nice-to-have, not critical.

**Constants:**
- `INITIAL_SLICE = 40` (line 509)
- `MIN_FILMS = 40` (line 184) — gates the host's "Start" button until pool reaches this size

### 6. Genre suppression

**File:** `app/session/[code]/page.tsx`, function `skipBlocked` (line 75) and the score-tracking block in `handleSwipe`.

**Trigger:** `handleSwipe` recomputes `blockedGenres` after each swipe (`Object.entries(genreScores).filter(([, s]) => s <= -3)`).

**Effect:** `skipBlocked` skips any film where ALL its genres are blocked AND nobody has liked it. Films with a mix of blocked + non-blocked genres are NOT skipped (one good genre wins).

**Social-signal exemption:** `(filmLikes.get(film.id)?.length ?? 0) > 0` — if anyone has liked the film, blocking is overridden. The group signal beats individual aversion.

### 7. Collection blocking

**File:** `app/session/[code]/page.tsx`, `skipBlocked` (line 88-91) + handleSwipe synchronous block (line 856-867) + async backfill (line 1074-1091).

**Three states for `collection_id`:**
- `null` — not yet checked. Triggers async backfill on dislike.
- `0` — checked, confirmed no franchise (sentinel, post-#57).
- positive int — belongs to that TMDB collection.

**Synchronous path:** if user dislikes a film with known `collection_id` (positive int), the franchise is added to `blockedCollections` immediately. `skipBlocked` then skips other films in that franchise (with social-signal exemption).

**Async backfill path:** if user dislikes a film with `collection_id === null`, an async fetch (`getFilmDetail` + `fetchCollectionTmdbIds`) runs after `setCurrentIndex` advances. When complete, it updates `collection_id` on all matching films in the queue and adds the franchise to `blockedCollections`.

**Critical post-#65 invariant:** both `setFullQueue` and `setBlockedCollections` in the async backfill MUST use functional updaters `(prev) => ...`, not closure-captured values. The 300-600ms async window means closure-captured state is stale by the time the update fires; non-functional `setFullQueue(enriched)` would overwrite the live queue.

**Reciprocal unblocking:** if a user likes a film whose franchise was previously blocked, the franchise is un-blocked (line 863-866). Indicates a change of heart.

**Why most films now have populated collection_id:** as of #57, `upsertFilm`'s `needsRefresh` triggers when `collection_id == null`, so films get backfilled when seeded into a session. Standalone films (no franchise) get the `0` sentinel to prevent perpetual re-refresh. As of writing: 54% null, 19% sentinel-0, 26% real franchise.

### 8. Foreign language cap

**File:** `lib/pool.ts`, in `seedMoreHomePool` (line ~265).

**Trigger:** at pool seeding for English-primary regions (`AU, US, GB, CA, NZ, IE, ZA`).

**Effect:** non-English films capped at 15% of the pool. Films are kept in popularity order until the cap is hit, then non-English films are silently dropped.

**Why:** TMDB Discover often returns lots of regional films (Korean, Hindi, etc.) that are technically available on Australian streaming services but irrelevant to most groups. Non-English-primary regions don't get this filter — Italians want Italian films.

**Constant:** `FOREIGN_LANG_CAP = 0.15` (line 13 of pool.ts).

### 9. Drip

**File:** `app/session/[code]/page.tsx`, in `handleSwipe` (around line 932).

**Trigger:** every 20 swipes (`swipeCountRef.current % 20 === 0`).

**Effect:** take 20 films from the reserve, splice into the unseen part of the queue at random positions 1-15 (within the unseen range). The current card (position `ci`) is preserved. Position `ci + 1` (back card) is also preserved — drip splices at unseen index 1 minimum, which is `ci + 2`.

**Why:** keeps the queue varied without exhausting the reserve all at once. Spreads variety across continuing swipes.

### 10. Pool seeding

**File:** `lib/pool.ts`, functions `seedHomePool` (line 67) and `seedMoreHomePool` (line 109).

**Two-stage seeding:**
1. `seedHomePool` runs immediately when the host clicks "Start" on the home page. Adds 10 films from cache or live TMDB Discover so the deck isn't empty when the user enters the lobby.
2. `seedMoreHomePool` runs in the background after the lobby is shown. Targets `160 + (20 * serviceCount)` films. Reads from `provider_pool_cache` first; falls back to live TMDB Discover if cache is empty.

**`provider_pool_cache`:** populated every 3 days by `/api/cron/refresh-pool-cache` (post-#57 fix, the cron actually runs now). Contains TMDB IDs only — not full film data.

**Films land in batches of 8 with a 400ms delay between batches (only when falling back to live TMDB; cache path has no delay).**

---

## Resolution timing

### 30-second minimum session timer (post-#62)

**File:** `app/session/[code]/page.tsx`, around lines 280-313.

When `session.started` flips to true, a per-client `startedAtRef` captures `Date.now()` and a `setTimeout` schedules the resolution effect for 30 seconds later.

**During the grace period:** all match-detection paths (`handleSwipe`, realtime sub belt-and-suspenders, end-of-deck batch check) record matches but don't close the session.

**At grace period end:**
- 0 matches → continue (normal flow takes over)
- 1 match → `resolveMatch` with that winner
- 2+ matches → `closeSession` (shortlist vote flow takes over)

**Per-client timer is intentional.** Slight clock drift between clients (~100ms over realtime) doesn't matter — `resolveMatch` and `closeSession` are both idempotent. Whoever fires first wins; subsequent firers no-op.

**Solo sessions skip the timer** — match detection is gated on `!isSolo` everywhere, so the timer never has anything to resolve.

---

## State model

The deck reads/writes around 15 pieces of state. Most refs exist because state updates are async and `handleSwipe` / the realtime sub need synchronous-latest values.

### Queue inventory
- `fullQueue` (state) — the active queue rendered to the user.
- `reserveQueueRef` (ref) — unseen films held back, fed in via drip.
- `allSessionFilmsRef` (ref) — every film in this session, flat list. Used for cross-slot propagation injection and second-chance end-of-deck.

### Position
- `currentIndex` (state) — index into `fullQueue` for the front card.
- `currentIndexRef` (ref) — synchronously kept in lock-step with `currentIndex` (post-#63). Read by `propagateFilm` and `loadFilms`.

### Per-user preferences (variance)
- `blockedCollections` (state) — TMDB collection IDs the user has disliked.
- `genreScores` (state) — `{ [genreId]: number }`, +1 per like, -1 per dislike.
- `blockedGenres` (derived `useMemo`) — genres with score ≤ -3.
- `priorityGenres` (derived `useMemo`) — genres with score ≥ +3.
- `mySwipeHistoryRef` (ref) — `Map<filmId, liked>` for this user. Used by propagation to skip already-swiped films, and by second-chance pass.

### Group state (convergence)
- `filmLikes` (state) + `filmLikesRef` (ref) — `Map<filmId, participantId[]>` of who liked what.
- `groupSwipeCount` / `groupLikeCount` — total counters used by `votePhase` derivation.

### Sync flags
- `swipeInProgress` (ref) — true while finger is on card. Defers propagation events into `pendingPropagationsRef`.
- `swipingIndexRef` (ref) — last index where `handleSwipe` started. Prevents re-entry on rapid taps.
- `swipeCountRef` (ref) — drip counter.

### Resolution
- `matchList` (state) — set when the session has a winner (or shortlist starts).
- `startedAtRef` (ref) — when this client first saw `session.started=true`. Drives the 30s grace-period timer.

---

## Known interactions and races

### Confirmed and fixed
- **#57** — collection_id was lazily backfilled but `needsRefresh` didn't trigger on null. Most films stuck without franchise data → collection blocking didn't work. Fixed in `upsertFilm`.
- **#58** — SwipeCard's `posterLoaded` initialised to false on every mount, replaying the fade-in for cached images. Fixed by seeding from `img.complete`.
- **#62** — match resolution would close session on the very first match. Fixed by 30-second grace period.
- **#63** — `currentIndexRef` updated via `useEffect`, leaving a stale-ref window that *could* allow propagation to displace the front-card position. Fixed by synchronous ref update + propagation push-back to ci+2.
- **#64** — fast same-person swipes created multiple match rows in succession. Fixed by `triggered_by` column + per-participant 5s cooldown.
- **#65** — async collection backfill used closure-captured `fullQueue` (non-functional setter), overwriting concurrent state with a 600ms-stale snapshot. Fixed by switching to functional updater.

### Not yet investigated
- **`setBlockedCollections` in `handleSwipe`** at lines 858-866 uses closure-captured value (synchronously). Not a known bug because handleSwipe is created per-render with fresh closure, but if multiple handleSwipes overlap (their async portions), there's a theoretical race. Untested.
- **AnimatePresence key transitions:** when the user swipes, the back card with key `${nextFilm.id}-next` unmounts and a new front with key `${nextFilm.id}` mounts. They're different keys so React remounts. With #58 the image starts loaded, but other transient state (e.g. `isDragging`) could re-initialise.

### General fragility
- **Stale-closure setters in async functions are a recurring pattern.** Three of the recent bugs (#63, #64 partially, #65) are variants of this. The structural fix is to extract queue mutations into pure functions that take state explicitly — see the next section.

---

## Where unit tests would help most

The following are already pure functions or could become pure with minimal effort. Extracting them to `lib/queue.ts` and adding tests would catch most of the bug class above.

| Function | Current location | Already pure? |
|---|---|---|
| `tallyVotes` | `lib/shortlist.ts:144` | ✅ Yes |
| `skipBlocked` | `app/session/[code]/page.tsx:75` | ✅ Yes |
| `findPriorityFilmInWindow` | `app/session/[code]/page.tsx:105` | ✅ Yes |
| `seededShuffle` | `app/session/[code]/page.tsx` (around line 40) | ✅ Yes |
| Drip splice logic | inline in `handleSwipe:932` | Could be — extract |
| Priority swap | inline in `handleSwipe:949` | Could be — extract |
| Propagation queue mutation | inline in `propagateFilm:618` | Could be — extract |
| Collection backfill queue update | inline in `handleSwipe:1074` | Could be — extract |

**Suggested test scenarios** (none of these exist yet):
- `propagation places X at ci+2; subsequent priority swap doesn't displace X`
- `drip splices 20 films into unseen positions, never touching ci or ci+1`
- `skipBlocked returns first non-blocked index, respecting social-signal exemption`
- `concurrent collection backfills (different films) don't overwrite each other's state`
- `tallyVotes: unanimous wins; survival filter; spin tiebreaker; etc.` (already pure, easy to test)

---

## How to add a new algorithm without breaking things

1. Read this file end-to-end.
2. Pick one of the 8 existing slots (convergence or variance) and decide if your new logic belongs in it or as a 9th algorithm.
3. If it mutates the queue: use functional `setFullQueue((prev) => ...)`. Never `setFullQueue(closureCapturedValue)`.
4. If it reads "current" state from an async callback: use a ref, not state. State in async callbacks is captured at the time the callback was created, which may be many renders ago.
5. If it touches position `ci + 1`: think very carefully about the interaction with propagation, drip, and the priority swap. Consider whether `ci + 2` is safer.
6. Update this document with what you added, what state it touches, and known interactions.
