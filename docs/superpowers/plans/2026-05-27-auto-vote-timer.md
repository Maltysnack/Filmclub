# Auto-Vote Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the host-triggered "Shortlist Vote" button with an automatic countdown timer that fires a shortlist vote when both a time limit and a minimum swipe count are reached.

**Architecture:** Add `started_at TIMESTAMPTZ` to sessions so all clients share the same deadline. Each client runs a 1 s interval computing `elapsed >= maxTime AND totalSwipes >= groupSize * 8`; first client to fire calls the existing `openShortlist()` path. DB unique constraint on `shortlist_rounds(session_id, round_number)` prevents duplicate inserts from concurrent clients. A countdown pill appears for all participants in the last 60 s.

**Tech Stack:** Next.js App Router, Supabase (Postgres + realtime), TypeScript, Tailwind CSS v4

---

### Task 1: DB migration and type updates

**Files:**
- Modify: `types/database.ts:338-376` (sessions Row / Insert / Update)
- Modify: `types/index.ts:7-19` (Session interface)
- Modify: `lib/session.ts:19-31,158-159` (dbToSession, startSession)

- [ ] **Step 1: Apply the migration to Supabase**

Open the Supabase dashboard (or use the MCP tool `apply_migration`). Run:

```sql
ALTER TABLE sessions ADD COLUMN started_at TIMESTAMPTZ;
```

Verify: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'started_at';` should return one row.

- [ ] **Step 2: Add `started_at` to `types/database.ts`**

In `types/database.ts`, the `sessions` table block starts at line 337. Add `started_at: string | null` to all three sub-objects (Row, Insert, Update):

```typescript
// Row (line 338 block) — add after "started: boolean | null":
started_at: string | null
// Insert (line 351 block) — add after "started?: boolean | null":
started_at?: string | null
// Update (line 364 block) — add after "started?: boolean | null":
started_at?: string | null
```

- [ ] **Step 3: Add `started_at` to the `Session` interface in `types/index.ts`**

In `types/index.ts`, the `Session` interface is at lines 7–19. Add one line after `started: boolean;`:

```typescript
export interface Session {
  id: string;
  code: string;
  mode: SessionMode;
  threshold: number;
  status: SessionStatus;
  started: boolean;
  started_at: string | null;   // <-- add this
  watch_mode: WatchMode;
  streaming_services: string[];
  region: Region;
  tiebreaker_film_ids: string[] | null;
  created_at: string;
}
```

- [ ] **Step 4: Update `dbToSession` in `lib/session.ts`**

`dbToSession` (lines 19–31) spreads `...row` so `started_at` passes through automatically. But add an explicit override to handle the null default cleanly, consistent with the pattern used for other nullable fields:

```typescript
function dbToSession(row: DbSession): Session {
  return {
    ...row,
    mode: row.mode as SessionMode,
    status: (row.status ?? "active") as SessionStatus,
    watch_mode: (row.watch_mode ?? "home") as WatchMode,
    started: row.started ?? false,
    started_at: row.started_at ?? null,   // <-- add this line
    streaming_services: row.streaming_services ?? [],
    threshold: row.threshold ?? 0,
    region: (row.region ?? "AU") as Region,
    created_at: row.created_at ?? "",
  };
}
```

- [ ] **Step 5: Update `startSession` in `lib/session.ts` to write `started_at`**

Line 158–159 currently:
```typescript
export async function startSession(sessionId: string) {
  await supabase.from("sessions").update({ started: true }).eq("id", sessionId);
```

Change to:
```typescript
export async function startSession(sessionId: string) {
  await supabase.from("sessions").update({ started: true, started_at: new Date().toISOString() }).eq("id", sessionId);
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If you see errors about `started_at` not existing on the DB type, confirm Step 2 was applied to all three sub-objects (Row, Insert, Update).

- [ ] **Step 7: Commit**

```bash
git add types/database.ts types/index.ts lib/session.ts
git commit -m "feat: add started_at to sessions for auto-vote timer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Auto-fire constants, refs, state, and hook

**Files:**
- Modify: `app/session/[code]/page.tsx` (multiple locations)

This task adds the timer constants, a `groupSwipeCountRef` for closure-safe access, countdown state, and the `useEffect` that drives the auto-fire.

- [ ] **Step 1: Add timer constants and the deadline helper**

In `app/session/[code]/page.tsx`, directly after the existing `MIN_SESSION_MS` constant at line 205, add:

```typescript
  const MIN_SESSION_MS = 30_000;
  // Auto-vote timer constants. Both conditions must be met before firing.
  const MIN_SWIPES_PER_PERSON = 8;
  const BASE_TIMER_MS = 3 * 60 * 1000;         // 3 min for a solo session
  const PER_PERSON_MS = 60 * 1000;              // +1 min per additional participant
  const MAX_TIMER_MS = 5 * 60 * 1000;           // hard cap regardless of group size
  const COUNTDOWN_VISIBLE_BELOW_MS = 60_000;    // show pill in the last 60 s

  function autoShortlistDeadline(groupSize: number, startedAtMs: number): number {
    const duration = Math.min(BASE_TIMER_MS + (groupSize - 1) * PER_PERSON_MS, MAX_TIMER_MS);
    return startedAtMs + duration;
  }
```

- [ ] **Step 2: Add `groupSwipeCountRef` alongside the existing `groupSwipeCount` state**

The auto-fire interval must read `groupSwipeCount` without it being a dependency (to avoid resetting the interval on every swipe). Find line ~471 where `groupSwipeCount` state is declared:

```typescript
  const [groupSwipeCount, setGroupSwipeCount] = useState(0);
```

Add a ref directly below it:

```typescript
  const [groupSwipeCount, setGroupSwipeCount] = useState(0);
  const groupSwipeCountRef = useRef(0); // sync mirror for interval reads
```

- [ ] **Step 3: Keep `groupSwipeCountRef` in sync with state**

There are two places where `setGroupSwipeCount` is called:

**Line ~810** (initial load from DB):
```typescript
      setGroupSwipeCount(stats.totalSwipes);
      // add directly after:
      groupSwipeCountRef.current = stats.totalSwipes;
```

**Line ~879** (realtime swipe increment):
```typescript
      setGroupSwipeCount((c) => c + 1);
      // add directly after:
      groupSwipeCountRef.current += 1;
```

- [ ] **Step 4: Add `autoVoteCountdown` state and `autoVoteFiredRef`**

Find the existing `showShortlistConfirm` state at line ~165:

```typescript
  const [showShortlistConfirm, setShowShortlistConfirm] = useState(false);
```

Add below it:

```typescript
  const [autoVoteCountdown, setAutoVoteCountdown] = useState<number | null>(null);
  const autoVoteFiredRef = useRef(false);
```

(Leave `showShortlistConfirm` in place for now — Task 3 removes it alongside the button and modal.)

- [ ] **Step 5: Add the auto-fire `useEffect`**

Place this after the existing grace-period `useEffect` (which ends at line ~396):

```typescript
  // ── Auto-vote timer ────────────────────────────────────────────────────────
  // Fires a shortlist vote once both the time limit and the swipe floor are met.
  // Any client can fire; the DB unique constraint on shortlist_rounds prevents
  // duplicate inserts from a race.
  useEffect(() => {
    if (
      !session?.started ||
      !session.started_at ||
      showShortlist ||
      session.status === "closed"
    ) return;

    const startedAtMs = new Date(session.started_at).getTime();
    const deadline = autoShortlistDeadline(participants.length, startedAtMs);
    const swipeFloor = participants.length * MIN_SWIPES_PER_PERSON;

    const tick = () => {
      const remaining = deadline - Date.now();
      setAutoVoteCountdown(remaining);

      const timeUp = Date.now() >= deadline;
      const swipesMet = groupSwipeCountRef.current >= swipeFloor;

      if (timeUp && swipesMet && !autoVoteFiredRef.current) {
        autoVoteFiredRef.current = true;
        openShortlist(session.id, [...filmLikesRef.current.keys()]);
      }
    };

    tick(); // evaluate immediately on mount / session change
    const intervalId = setInterval(tick, 1_000);
    return () => clearInterval(intervalId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.started, session?.started_at, session?.id, session?.status, participants.length, showShortlist]);
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. Common failure: `openShortlist` not in scope — confirm the `useEffect` is placed inside the component, after `openShortlist` is defined (~line 401).

- [ ] **Step 7: Commit**

```bash
git add app/session/\[code\]/page.tsx
git commit -m "feat: auto-vote timer hook and state

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Countdown pill UI and remove the host button + confirmation modal

**Files:**
- Modify: `app/session/\[code\]/page.tsx` (multiple locations)

- [ ] **Step 1: Replace the host "Shortlist Vote" button with the countdown pill**

Lines 1712–1720 are the host-only shortlist button inside the header:

```typescript
        {/* Centre: Shortlist Vote — flex spacers keep it centred in the gap */}
        {isHost && session?.status !== "closed" && !allDone && filmLikes.size >= 2 && (
          <button
            onClick={() => setShowShortlistConfirm(true)}
            className="shrink-0 whitespace-nowrap px-5 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e" }}>
            Shortlist Vote
          </button>
        )}
```

Replace the entire block with the countdown pill (visible to all participants, not just host):

```typescript
        {/* Centre: auto-vote countdown pill — visible in the last 60 s */}
        {session?.started && autoVoteCountdown !== null && autoVoteCountdown <= COUNTDOWN_VISIBLE_BELOW_MS && !showShortlist && session.status !== "closed" && (
          <div
            className="shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold tabular-nums"
            style={{ background: "var(--surface-2)", color: autoVoteCountdown <= 0 ? "var(--text-muted)" : "var(--text)" }}>
            {autoVoteCountdown > 0
              ? `Vote in ${Math.floor(autoVoteCountdown / 60_000)}:${String(Math.floor((autoVoteCountdown % 60_000) / 1_000)).padStart(2, "0")}`
              : "Vote soon…"}
          </div>
        )}
```

- [ ] **Step 2: Remove the `showShortlistConfirm` state declaration**

Line ~165:
```typescript
  const [showShortlistConfirm, setShowShortlistConfirm] = useState(false);
```

Delete that line. Also delete the `autoVoteCountdown` and `autoVoteFiredRef` lines you added in Task 2 step 4 if they were placed just after it — move them to wherever makes logical sense (e.g. next to the other auto-vote state). (If they're already in a sensible spot, leave them.)

- [ ] **Step 3: Remove the confirmation modal JSX**

Lines 2030–2066:

```typescript
    {/* ── Shortlist Vote confirmation ───────────────────────────────────── */}
    {showShortlistConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ background: "rgba(12,12,14,0.75)", backdropFilter: "blur(4px)" }}>
        <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
          style={{ background: "var(--surface)" }}>
          <div>
            <p className="text-sm font-semibold mb-1.5" style={{ color: "var(--text)" }}>
              Start a shortlist vote?
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              All films with at least one like will go to a group vote.
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Live swiping ends.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowShortlistConfirm(false)}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
              Cancel
            </button>
            <button
              onClick={() => {
                setShowShortlistConfirm(false);
                const likedIds = [...filmLikes.keys()];
                openShortlist(session!.id, likedIds.length > 0 ? likedIds : []);
              }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: "var(--accent)", color: "#0c0c0e" }}>
              Start Vote
            </button>
          </div>
        </div>
      </div>
    )}
```

Delete the entire block above.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If you see `showShortlistConfirm is not defined`, search for any remaining references and delete them.

```bash
grep -n "showShortlistConfirm\|setShowShortlistConfirm" app/session/\[code\]/page.tsx
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/session/\[code\]/page.tsx
git commit -m "feat: countdown pill UI, remove host shortlist button and modal

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Update instructions copy

**Files:**
- Modify: `app/session/\[code\]/page.tsx` (two copy locations + one comment)

There are two places where the old "host can call a shortlist vote at any time" text appears, plus one comment that refers to the same concept.

- [ ] **Step 1: Update the lobby instructions panel (line ~1536)**

Find:
```typescript
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{hostParticipant?.name ?? "Host"} can call a shortlist vote at any time</span>
```

Replace with a dynamic line that shows the actual time limit. The `participants.length` value is already in scope. Add a helper just above the JSX or inline:

```typescript
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  {"You have "}
                  {participants.length <= 1 ? "3" : participants.length === 2 ? "4" : "5"}
                  {" minutes to find a match. If time runs out, the group moves to a vote automatically."}
                </span>
```

Also remove the `<Crown size={16} />` icon and the wrapping `OR` divider since this is now a timer mechanic, not a host action. Delete the entire `OR` block (the two `<div>` elements containing the `OR` span and the Crown line):

```typescript
              <div className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-center text-[10px] font-bold" style={{ color: "var(--accent)" }}>OR</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="shrink-0" style={{ color: "var(--accent)" }}><Crown size={16} /></span>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{hostParticipant?.name ?? "Host"} can call a shortlist vote at any time</span>
              </div>
```

And replace with a single row (no OR, no Crown):

```typescript
              <div className="flex items-center gap-3">
                <span className="shrink-0" style={{ color: "var(--accent)" }}><Timer size={16} /></span>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                  {"You have "}
                  {participants.length <= 1 ? "3" : participants.length === 2 ? "4" : "5"}
                  {" minutes. If no match, a vote picks the winner."}
                </span>
              </div>
```

`Timer` must be imported from `lucide-react`. Check the existing import line (e.g. `import { ..., Crown, ... } from "lucide-react"`) and add `Timer` to it. Remove `Crown` from the import if it is no longer used anywhere else in the file.

```bash
grep -n "Crown" app/session/\[code\]/page.tsx
```

If no remaining uses, remove `Crown` from the lucide-react import.

- [ ] **Step 2: Update the late-joiner hints modal (line ~2011–2014)**

Find:
```typescript
            <div className="flex items-center gap-3">
              <span className="shrink-0" style={{ color: "var(--accent)" }}><Crown size={16} /></span>
              <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                {participants[0]?.name ?? "Host"} can call a shortlist vote at any time
              </span>
            </div>
```

Replace with:
```typescript
            <div className="flex items-center gap-3">
              <span className="shrink-0" style={{ color: "var(--accent)" }}><Timer size={16} /></span>
              <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                {"You have "}
                {participants.length <= 1 ? "3" : participants.length === 2 ? "4" : "5"}
                {" minutes. If no match, a vote picks the winner."}
              </span>
            </div>
```

Also remove the `OR` divider row directly above this block:
```typescript
            <div className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-center text-[10px] font-bold" style={{ color: "var(--accent)" }}>OR</span>
            </div>
```

- [ ] **Step 3: Update the stale comment near the ShortlistOverlay (line ~1937–1939)**

Find:
```typescript
    {/* ShortlistOverlay during swipe phase — the version in the matchList block only
        renders on the tie/match screen. This one covers the active swiping phase so
        the host can trigger a vote before any unanimous match has occurred. */}
```

Replace with:
```typescript
    {/* ShortlistOverlay during swipe phase — the version in the matchList block only
        renders on the tie/match screen. This one covers the active swiping phase so
        the auto-vote timer can trigger a vote before any unanimous match has occurred. */}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If you see `Crown` or `Timer` import errors, fix the lucide-react import line.

- [ ] **Step 5: Commit**

```bash
git add app/session/\[code\]/page.tsx
git commit -m "feat: update instructions copy for auto-vote timer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Manual verification checklist

After all tasks pass typecheck, test the following:

1. **Timer fires (fast test):** Temporarily set `BASE_TIMER_MS = 20_000` and `MIN_SWIPES_PER_PERSON = 1`. Start a session, do 1 swipe. Countdown pill should appear. At 0:00 the shortlist overlay should open automatically for all clients.

2. **Swipe floor gate:** Set `MIN_SWIPES_PER_PERSON = 100`. Timer hits 0:00 but no auto-fire. Pill shows "Vote soon...". After doing enough swipes it fires.

3. **Countdown pill visibility:** Pill only appears in the last 60 s (`COUNTDOWN_VISIBLE_BELOW_MS`). Before that, the header centre is empty.

4. **No duplicate round:** Open two browser tabs for the same session. Confirm the shortlist overlay opens on both and only one `shortlist_rounds` row is created.

5. **Host button gone:** Confirm there is no "Shortlist Vote" button anywhere in the swipe UI.

6. **Instructions copy:** Both the lobby panel and the late-joiner modal show the timer copy, not the Crown/host line.

Revert the test constants before shipping.
