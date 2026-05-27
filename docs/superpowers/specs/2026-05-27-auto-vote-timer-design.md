# Auto-Vote Timer — Design Spec

**Date:** 2026-05-27
**Status:** Approved

## Summary

Replace the host-triggered "Shortlist Vote" button with an automatic timer. When both a time limit and a minimum swipe count are met, all clients detect the condition and any one of them fires the shortlist vote automatically. A visible countdown appears in the last 60 seconds to build tension.

## Constants

Defined in `app/session/[code]/page.tsx`:

```ts
const MIN_SWIPES_PER_PERSON = 8
const BASE_TIMER_MS = 3 * 60 * 1000       // 3 min for solo
const PER_PERSON_MS = 60 * 1000            // +1 min per additional participant
const MAX_TIMER_MS = 5 * 60 * 1000        // hard cap
const COUNTDOWN_VISIBLE_BELOW_MS = 60_000 // show pill in last 60 s

function autoShortlistDeadline(groupSize: number, startedAt: number): number {
  const duration = Math.min(BASE_TIMER_MS + (groupSize - 1) * PER_PERSON_MS, MAX_TIMER_MS)
  return startedAt + duration
}
```

Resulting deadlines: 1 person = 3 min, 2 = 4 min, 4+ = 5 min (capped).
Swipe floor: `groupSize * MIN_SWIPES_PER_PERSON` total swipes across the session.

## Database change

Add `started_at TIMESTAMPTZ` to the `sessions` table. Set to `now()` when the host clicks Start. The existing `started` boolean can remain (it gates the lobby-to-swipe transition); `started_at` is the source of truth for timer calculations. All clients receive it via the existing session realtime subscription.

Migration:

```sql
ALTER TABLE sessions ADD COLUMN started_at TIMESTAMPTZ;
```

Update the Start handler (wherever `started = true` is written) to also set `started_at = now()`.

## Auto-fire logic

Each client runs a 1 s `setInterval` once `started_at` is populated.

Fire condition:

```
now() >= autoShortlistDeadline(groupSize, startedAt)
AND groupSwipeCount >= groupSize * MIN_SWIPES_PER_PERSON
```

When true, the client calls the existing `openShortlist()` path (same as the old host button). `startShortlist()` inserts into `shortlist_rounds`; the existing unique constraint on `(session_id, round_number)` prevents duplicate inserts from concurrent clients. The realtime subscription on `shortlist_rounds` INSERT fans the event out to all participants, identical to today's flow.

Edge case: timer reaches deadline but swipe floor not yet met (small/slow session). The countdown shows `Vote soon...` at 0:00 and fires the instant the floor is crossed.

## UI changes

### Countdown pill

Appears on the swipe screen for all participants when `timeRemaining <= COUNTDOWN_VISIBLE_BELOW_MS`. Small, unobtrusive chip in the corner (or top bar). Format: `Vote in 0:42`. At 0:00 with swipes pending: `Vote soon...`.

### Remove

- Host "Shortlist Vote" button (`filmLikes.size >= 2` condition, line ~1713)
- Host confirmation modal (lines ~2038-2067)
- `filmLikes` state is no longer needed for triggering (may still be needed elsewhere; audit before removing)

## Instructions / onboarding copy

Replace any line about the host triggering a vote. New copy:

> "You have up to [X] minutes to find a match. If time runs out, the group moves to a vote automatically."

Where [X] is derived from group size (3 for solo, 4 for 2 people, 5 for 4+). Can be shown dynamically or as a fixed "a few minutes" if dynamic feels like too much UI.

Audit all instruction surfaces: lobby screen, any help text, onboarding overlays.

## What does not change

- `startShortlist()` in `lib/shortlist.ts` -- unchanged
- `openShortlist()` flow in `app/session/[code]/page.tsx` -- unchanged
- Shortlist overlay, nomination/veto/vote phases -- unchanged
- Realtime subscription on `shortlist_rounds` INSERT -- unchanged
- `resolveMatch()`, match detection, session close flow -- unchanged

## Out of scope

- Making the timer configurable by the host (would add session-creation UI complexity)
- Server-side fire via edge function (client-race with DB guard is sufficient)
- Persisting the timer state across page refreshes (deadline is recomputed from `started_at`; page reload restores it correctly)
