"use client";

import { useEffect, useState, useCallback, useRef, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useMotionValue } from "framer-motion";
import Logo from "@/components/Logo";
import SwipeCard from "@/components/SwipeCard";
import FilmModal from "@/components/FilmModal";
import FilmInfoPanel from "@/components/FilmInfoPanel";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";
import ScrollView, { ScrollViewHandle } from "@/components/ScrollView";
import {
  getSession, getParticipantId, getIsHost, getParticipants, getSessionFilmsWithMeta,
  getMySwipes, getMyLikes, recordSwipe, checkForMatch, checkAllMatches, getMatches,
  closeSession, startSession, resolveMatch, addFilmToSession, getSessionSwipeStats,
  removeParticipant, getShortlistData,
} from "@/lib/session";
import { posterUrl, getFilmDetail, tmdbToFilm, fetchCollectionTmdbIds } from "@/lib/tmdb";
import { logEvent } from "@/lib/telemetry";
import { getService, TMDB_GENRES } from "@/lib/streaming";
import { seedHomePool, seedMoreHomePool, sessionProviderTmdbIds, ENGLISH_PRIMARY_REGIONS, FOREIGN_LANG_CAP } from "@/lib/pool";
import MailButton from "@/components/MailButton";
import { getCurrentRound } from "@/lib/shortlist";
import { supabase } from "@/lib/supabase";
import { participantColor, getCharacterFilm } from "@/lib/names";
import { Film, Session, Participant, Match } from "@/types";
import { Search, Trophy, Play, Clock, Zap, Crown, Layers } from "lucide-react";
import { CodeDisplay } from "@/components/CodeBox";
import SpinWheel from "@/components/SpinWheel";
import ShortlistOverlay from "@/components/ShortlistOverlay";
import SinglePlayerVoteOverlay from "@/components/SinglePlayerVoteOverlay";
import FilmWinnerScreen from "@/components/FilmWinnerScreen";
import ParticipantPill from "@/components/ParticipantPill";
import KickedScreen from "@/components/KickedScreen";


// Lobby participant grid: 1 column for ≤3 people (names get full width),
// 2 columns for 4–8, 3 columns for 9+.
function lobbyGridCols(n: number): number {
  if (n <= 3) return 1;
  if (n <= 8) return 2;
  return 3;
}

// Deterministic shuffle using a seeded LCG PRNG — same result for the same
// participantId across page refreshes, giving each user a stable personal deck.
function seededShuffle<T>(arr: T[], seed: number): T[] {
  let s = seed | 0;
  const next = () => { s = Math.imul(1664525, s) + 1013904223 | 0; return (s >>> 0) / 0x100000000; };
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ── Genre scoring constants ───────────────────────────────────────────────────
// Thresholds and look-ahead window for the genre scoring system (issue #23).
// All three are the only knobs needed to tune the behaviour:
//   GENRE_BLOCK_THRESHOLD  — score at-or-below this → genre is suppressed
//   GENRE_PRIORITY_THRESHOLD — score at-or-above this → pull matching films forward
//   GENRE_PRIORITY_WINDOW  — how many unseen cards ahead to scan for a priority film
const GENRE_BLOCK_THRESHOLD    = -3;
const GENRE_PRIORITY_THRESHOLD =  3;
const GENRE_PRIORITY_WINDOW    = 10;

// Number of cards at the front of the queue that are LOCKED — no algorithm
// (drip, propagation, priority swap) is allowed to mutate the queue at
// positions [currentIndex, currentIndex + FRONT_BUFFER - 1]. Films arriving
// from those algorithms target queue[currentIndex + FRONT_BUFFER] at the
// closest. Belt-and-suspenders defence against the persistent "front card
// briefly appears then disappears" symptom — even if a structural race we
// haven't found displaces a film, it can't displace a card the user is
// looking at or about to swipe to.
//
// 4 = front card + back card + 2 preload positions. Larger delays social
// signals visibly; smaller leaves less protection. 4 is the smallest value
// that protects what the user can actually see during a swipe animation.
const FRONT_BUFFER = 4;

// Human-readable genre name lookup — built from the same TMDB_GENRES list used
// everywhere else in the codebase. Only used for console logging.
const GENRE_NAME: Record<number, string> = Object.fromEntries(
  TMDB_GENRES.map(({ id, name }) => [id, name])
);

// Returns the first index >= fromIdx that passes BOTH the franchise block and
// the genre block checks. A film is genre-blocked if ALL of its genres are
// blocked AND nobody (from filmLikes) has already liked it.
function skipBlocked(
  fromIdx: number,
  queue: import("@/types").Film[],
  blocked: Set<number>,
  filmLikes: Map<string, string[]>,
  blockedGenres?: Set<number>,
): number {
  let idx = fromIdx;
  while (idx < queue.length) {
    const film = queue[idx];

    // ── Franchise block check ─────────────────────────────────────────────────
    const cid = film.collection_id;
    const franchiseBlocked = !!cid && blocked.has(cid);
    if (franchiseBlocked && (filmLikes.get(film.id)?.length ?? 0) === 0) { idx++; continue; }

    // ── Genre block check ─────────────────────────────────────────────────────
    // Suppressed if: blockedGenres is provided, the film has genres, ALL of them
    // are blocked, and nobody has liked it. A film with no genres is never blocked.
    if (blockedGenres && blockedGenres.size > 0 && film.genres.length > 0) {
      const allBlocked = film.genres.every((g) => blockedGenres.has(g.id));
      if (allBlocked && (filmLikes.get(film.id)?.length ?? 0) === 0) { idx++; continue; }
    }

    break;
  }
  return idx;
}

// Scans the look-ahead window [fromIdx, fromIdx + GENRE_PRIORITY_WINDOW) for the
// first film that has at least one priority genre AND is not genre-blocked AND is
// not franchise-blocked (unless someone liked it). Returns -1 if none found.
function findPriorityFilmInWindow(
  fromIdx: number,
  queue: import("@/types").Film[],
  priorityGenres: Set<number>,
  blockedGenres: Set<number>,
  blockedCollections: Set<number>,
  filmLikes: Map<string, string[]>,
): number {
  const end = Math.min(fromIdx + GENRE_PRIORITY_WINDOW, queue.length);
  for (let i = fromIdx; i < end; i++) {
    const film = queue[i];

    // Skip franchise-blocked films nobody liked
    const cid = film.collection_id;
    if (cid && blockedCollections.has(cid) && (filmLikes.get(film.id)?.length ?? 0) === 0) continue;

    // Skip genre-blocked films (all genres blocked, nobody liked)
    if (film.genres.length > 0) {
      const allBlocked = film.genres.every((g) => blockedGenres.has(g.id));
      if (allBlocked && (filmLikes.get(film.id)?.length ?? 0) === 0) continue;
    }

    // Check if it has any priority genre
    if (film.genres.some((g) => priorityGenres.has(g.id))) return i;
  }
  return -1;
}

export default function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  // Synchronous check on mount — prevents lobby flash for users returning from search/results
  // (they have a snapshot), while new joiners (no snapshot) correctly see the lobby.
  const hasSnapshot = useRef(typeof window !== "undefined" && !!sessionStorage.getItem(`filmclub-queue-${code}`));

  const [session, setSession] = useState<Session | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [isKicked, setIsKicked] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [showLateModal, setShowLateModal] = useState(false);
  const [showShortlistConfirm, setShowShortlistConfirm] = useState(false);
  // Set of TMDB collection IDs the user has swiped no on — hides remaining
  // films from that franchise unless another participant has already liked one.
  const [blockedCollections, setBlockedCollections] = useState<Set<number>>(() => {
    try { const s = sessionStorage.getItem(`filmclub-blocked-${code}`); return s ? new Set<number>(JSON.parse(s)) : new Set(); }
    catch { return new Set(); }
  });
  // ── Genre scoring (issue #23) ─────────────────────────────────────────────
  // Per-person, client-side only. Persisted to sessionStorage so it survives
  // page refreshes. Record<genreId, score>: +1 per like, -1 per dislike.
  const [genreScores, setGenreScores] = useState<Record<number, number>>(() => {
    try {
      const s = sessionStorage.getItem(`filmclub-genres-${code}`);
      return s ? (JSON.parse(s) as Record<number, number>) : {};
    } catch { return {}; }
  });

  // Computed synchronously — avoids the flash where host briefly sees "Waiting..." before init
  const isHost = getIsHost(code);
  const myParticipantId = getParticipantId(code) ?? "";
  const [fullQueue, setFullQueue] = useState<Film[]>([]);   // all films before genre filter
  const [showShortlist, setShowShortlist] = useState(false);
  const [shortlistData, setShortlistData] = useState<{ films: import("@/types").Film[]; pinnedFilmIds: string[] } | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [charInfoFilm, setCharInfoFilm] = useState<Film | null>(null);
  const [matchList, setMatchList] = useState<Match[]>([]);
  // Wheel state — lifted here so SpinWheel can overlay MatchScreen without flash
  const [wheelFilms, setWheelFilms] = useState<Match[] | null>(null);
  const [wheelWinnerId, setWheelWinnerId] = useState<string | null>(null);
  const wheelChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionFilmCount, setSessionFilmCount] = useState(0);
  const MIN_FILMS = 40;
  // Minimum time before a match can close the session, in ms. Inspired by the
  // secretary/optimal-stopping problem: forcing a small consideration window
  // prevents the very first like from instantly ending movie night before the
  // group has surveyed enough options. During this window, matches still get
  // recorded; they're resolved when the timer expires.
  const MIN_SESSION_MS = 30_000;
  // Captured locally per client when this device first sees session.started flip
  // to true. Slight per-client variation (~100ms over realtime) is fine.
  const startedAtRef = useRef<number | null>(null);
  // Read home-page logo position stored just before navigation — used to
  // start the lobby animation from exactly where the logo sat on the home page.
  const [logoStartY] = useState(() => {
    try {
      const stored = sessionStorage.getItem("filmclub-logo-y");
      if (stored) {
        sessionStorage.removeItem("filmclub-logo-y");
        // Lobby logo destination is ~40px from top (pt-10 container).
        return Math.max(0, parseFloat(stored) - 40);
      }
    } catch { /* ignore */ }
    return 160; // fallback for direct navigation
  });
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  // Debounce timer so background batch-inserts don't hammer loadFilms
  const queueRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so handleSwipe always sees the latest session without stale closure
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
  // Ref so shortlist subscription sees latest matchList without stale closure
  const matchListRef = useRef<Match[]>([]);
  useEffect(() => { matchListRef.current = matchList; }, [matchList]);
  // Ref so loadFilms (useCallback with [] deps) always sees the latest index.
  // IMPORTANT: writes to this ref must be SYNCHRONOUS alongside setCurrentIndex.
  // Use the advanceIndex() helper below — don't call setCurrentIndex directly.
  // (The previous useEffect-based sync left a window after commit + paint where
  // propagateFilm could read a stale ref and splice a film at the about-to-be
  // front position, causing a brief "card flash" — see #63.)
  const currentIndexRef = useRef(0);
  const advanceIndex = useCallback((next: number) => {
    if (typeof window !== "undefined") {
      console.log(`[deck:advance] ${currentIndexRef.current} → ${next}`);
    }
    currentIndexRef.current = next;
    setCurrentIndex(next);
  }, []);

  // Tagged setFullQueue wrapper — logs every queue mutation with a reason and
  // raises an alarm if the mutation changes the film at currentIndex (which
  // would mean the user's currently-visible front card just got replaced).
  // Temporary instrumentation to track down the "card disappears" bug.
  const setFullQueueTagged = useCallback((updater: (prev: import("@/types").Film[]) => import("@/types").Film[], reason: string) => {
    setFullQueue((prev) => {
      const next = updater(prev);
      if (typeof window !== "undefined" && prev !== next) {
        const ci = currentIndexRef.current;
        const oldId = prev[ci]?.id ?? "(none)";
        const newId = next[ci]?.id ?? "(none)";
        if (oldId !== newId) {
          console.warn(
            `[deck:FRONT-CARD-CHANGED] reason=${reason} index=${ci} ${oldId} → ${newId} (queue length ${prev.length} → ${next.length})`
          );
          // Skip the unavoidable initial-load case (prev empty) — that's the
          // hydration moment, not an actual swap mid-session.
          if (prev.length > 0) {
            logEvent(sessionRef.current?.id, participantRef.current?.id, "queue.front_card_changed", { reason, index: ci, old_id: oldId, new_id: newId, prev_length: prev.length, next_length: next.length });
          }
        } else {
          console.log(`[deck:queue-mutate] reason=${reason} index=${ci} (front=${oldId.slice(0, 8)}, length ${prev.length} → ${next.length})`);
        }
      }
      return next;
    });
  }, []);

  // Front-card-change detector. Logs every change to currentFilm.id between
  // renders. If the index didn't advance but the film did, that's the bug
  // we're hunting. Temporary instrumentation.
  const lastFrontCardRef = useRef<{ id: string | null; index: number; length: number }>({
    id: null, index: 0, length: 0,
  });
  useEffect(() => {
    const id = fullQueue[currentIndex]?.id ?? null;
    const last = lastFrontCardRef.current;
    if (last.id !== id) {
      const indexAdvanced = last.index !== currentIndex;
      if (!indexAdvanced && last.id !== null) {
        console.warn(
          `[deck:FRONT-CARD-REPLACED] index ${currentIndex} unchanged but film changed: ${last.id} → ${id} (queue length ${last.length} → ${fullQueue.length})`
        );
        logEvent(sessionRef.current?.id, participantRef.current?.id, "queue.front_card_replaced", { index: currentIndex, old_id: last.id, new_id: id, prev_length: last.length, next_length: fullQueue.length });
      } else if (indexAdvanced) {
        console.log(
          `[deck:advanced] index ${last.index} → ${currentIndex}, front ${last.id} → ${id}`
        );
      }
      lastFrontCardRef.current = { id, index: currentIndex, length: fullQueue.length };
    }
  });

  // Ref to track whether the user currently has a finger on the card mid-drag.
  // Like propagation (queue reorder) is deferred while a swipe is in progress
  // to prevent the card being yanked out from under the user's finger (Bug #4).
  const swipeInProgress = useRef(false);
  // Guards handleSwipe against double-invocation on rapid taps. Holds the index
  // of the last swipe that started processing. Resets naturally when currentIndex
  // advances to the next film (new render → new closure → different value).
  const swipingIndexRef = useRef(-1);
  // Time-based debounce on top of swipingIndexRef. Catches the "next-card
  // ActionButton lights up under the user's finger" race: after a swipe
  // advances currentIndex, the new front card's like button re-mounts in the
  // same screen position. A residual finger-lift fires a click on it; the new
  // render's handleSwipe closure sees a new currentIndex so the index guard
  // alone passes through. This is the original ghost-like bug. See #82.
  const lastSwipeAtRef = useRef(0);
  // Ref to imperatively scroll ScrollView when switching from swipe → scroll
  const scrollViewRef = useRef<ScrollViewHandle>(null);
  // Tracks the last known scroll mode index so swipe can resume at the same position
  const scrollIndexRef = useRef(0);
  // Ref so swipes subscription always sees the latest participant without stale closure
  const participantRef = useRef<Participant | null>(null);
  useEffect(() => { participantRef.current = participant; }, [participant]);
  // Ref for join-order slot — set imperatively in init() before loadFilms runs,
  // because the setParticipants state update hasn't flushed to the closure yet.
  const participantsRef = useRef<Participant[]>([]);
  // ── Pool / reserve / drip refs ────────────────────────────────────────────────
  // Films seeded but not yet shown — drained into the active queue every 20 swipes.
  const reserveQueueRef = useRef<Film[]>([]);
  // Running swipe count for drip timing (every 20 swipes → 10 films from reserve).
  const swipeCountRef = useRef(0);
  // Full session film list (seen + unseen) — used for second-chance end-of-deck pass.
  const allSessionFilmsRef = useRef<Film[]>([]);
  // Per-user swipe history this session: film.id → liked. Used for second-chance ranking.
  const mySwipeHistoryRef = useRef<Map<string, boolean>>(new Map());
  // Synchronous-access mirror of filmLikes state — updated directly in the subscription
  // callback before setFilmLikes so handleSwipe always reads the latest value even when
  // the React state hasn't flushed yet (stale-closure fix for skipBlocked / priority swap).
  const filmLikesRef = useRef<Map<string, string[]>>(new Map());
  // Film IDs deferred during a drag (swipeInProgress = true) — flushed into propagateFilm
  // when the drag ends so we never yank the card mid-swipe but don't lose the event either.
  const pendingPropagationsRef = useRef<string[]>([]);
  // Shared motion value: front SwipeCard writes its drag offset here each frame,
  // back SwipeCard reads it to smoothly promote itself as the front card moves away.
  // Resets to 0 when currentIndex advances so the new back card starts at rest.
  const promotionMV = useMotionValue(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { promotionMV.set(0); }, [currentIndex]);

  // ── Clear snapshot when session ends so stale data isn't restored ─────────
  useEffect(() => {
    if (matchList.length > 0) {
      sessionStorage.removeItem(`filmclub-queue-${code}`);
      sessionStorage.removeItem(`filmclub-index-${code}`);
    }
  }, [matchList, code]);

  // ── Minimum-session grace period ──────────────────────────────────────────
  // While the timer is active, swipe/realtime/start match handlers record matches
  // but don't close the session. When the timer fires, accumulated matches are
  // resolved: 1 → resolveMatch with that winner, 2+ → closeSession (shortlist
  // vote flow takes over). Solo and 2-person sessions both get the timer; only
  // sessions with no other participants would skip — but those don't run match
  // detection at all, so this gate is sufficient.
  function inGracePeriod(): boolean {
    if (startedAtRef.current === null) return false;
    return Date.now() - startedAtRef.current < MIN_SESSION_MS;
  }

  useEffect(() => {
    if (!session?.started || !session.id) return;
    if (participants.length <= 1) return; // solo: no match detection runs anyway
    if (startedAtRef.current === null) startedAtRef.current = Date.now();

    const remaining = MIN_SESSION_MS - (Date.now() - startedAtRef.current);
    if (remaining <= 0) return; // already past the grace period (e.g. late joiner whose timer expired in another render)

    const timer = setTimeout(async () => {
      if (!session.id || session.mode !== "live") return;
      // Status check guards against double-resolution if another client (host) closed first
      const latest = await getSession(code);
      if (!latest || latest.status === "closed") {
        const existing = await getMatches(session.id);
        if (existing.length > 0) setMatchList(existing);
        return;
      }
      const allMatches = await getMatches(session.id);
      if (allMatches.length === 0) return; // no matches accumulated; normal flow continues
      if (allMatches.length === 1) {
        await resolveMatch(session.id, allMatches[0].film_id);
      } else {
        await closeSession(session.id);
      }
      setMatchList(allMatches);
    }, remaining);

    return () => clearTimeout(timer);
  }, [session?.started, session?.id, session?.mode, participants.length, code]);

  // ── Auto-open shortlist overlay for all participants when host starts it ───
  // openShortlist fetches all liked films (matched + also-liked) so both entry
  // points use the same data — one source of truth for shortlist props (Bug A fix).
  const openShortlist = useCallback(async (sid: string, matchedFilmIds: string[]) => {
    if (matchedFilmIds.length === 0) { router.push(`/session/${code}/results`); return; }
    const data = await getShortlistData(sid, matchedFilmIds);
    setShortlistData(data);
    setShowShortlist(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    if (!session) return;
    // Check if a round is already active (e.g. rejoining mid-shortlist)
    getCurrentRound(session.id).then(r => {
      if (r && r.phase !== "complete") {
        openShortlist(session.id, matchListRef.current.map(m => m.film_id));
      }
    });
    const sub = supabase
      .channel(`session-sl:${session.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shortlist_rounds",
        filter: `session_id=eq.${session.id}`,
      }, () => {
        openShortlist(session.id, matchListRef.current.map(m => m.film_id));
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    sessionStorage.setItem(`filmclub-blocked-${code}`, JSON.stringify([...blockedCollections]));
  }, [blockedCollections, code]);

  useEffect(() => {
    sessionStorage.setItem(`filmclub-genres-${code}`, JSON.stringify(genreScores));
  }, [genreScores, code]);

  // ── Persist queue + index to sessionStorage so returning from + / results is instant ──
  // Large pools (160–360 films) can exceed the 5MB sessionStorage quota when full Film
  // objects are serialised. Strategy: try full data first; fall back to stripping the two
  // heaviest fields (overview ~400 chars, film_cast ~1500 chars per film); if even that
  // fails, clear the snapshot so the next visit does a fresh load instead of crashing.
  // loadFilms runs immediately in the background after a snapshot restore, so slim data
  // is replaced with full Film objects within ~200ms — before the user can open the panel.
  useEffect(() => {
    if (fullQueue.length > 0 && !loading) {
      try {
        sessionStorage.setItem(`filmclub-queue-${code}`, JSON.stringify(fullQueue));
      } catch {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const slim = fullQueue.map(({ overview: _ov, film_cast: _fc, ...rest }) => rest);
          sessionStorage.setItem(`filmclub-queue-${code}`, JSON.stringify(slim));
        } catch {
          sessionStorage.removeItem(`filmclub-queue-${code}`);
          sessionStorage.removeItem(`filmclub-index-${code}`);
        }
      }
    }
  }, [fullQueue, loading, code]);
  useEffect(() => {
    if (!loading) {
      sessionStorage.setItem(`filmclub-index-${code}`, String(currentIndex));
    }
  }, [currentIndex, loading, code]);


  // ── Phase-based vote visibility ───────────────────────────────────────────
  // groupSwipeCount / groupLikeCount track ALL participants' swipes for this session.
  // filmLikes maps filmId → participantIds who liked it (for phase 2/3 card display).
  const [groupSwipeCount, setGroupSwipeCount] = useState(0);
  const [groupLikeCount, setGroupLikeCount] = useState(0);
  const [filmLikes, setFilmLikes] = useState<Map<string, string[]>>(new Map());

  const SWIPE_THRESHOLD = 8; // average swipes per person before escalation begins
  const EXPECTED_LIKE_RATE = 0.25;

  const votePhase = useMemo((): 1 | 2 | 3 => {
    if (groupSwipeCount === 0 || participants.length === 0) return 1;
    const swipesPerPerson = groupSwipeCount / participants.length;
    const actualLikeRate = groupLikeCount / groupSwipeCount;
    const engagementDeficit = EXPECTED_LIKE_RATE - actualLikeRate;
    const score = (swipesPerPerson / SWIPE_THRESHOLD) * (1 + engagementDeficit);
    if (score >= 2) return 3;
    if (score >= 1) return 2;
    return 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupSwipeCount, groupLikeCount, participants.length]);

  // Derived sets from genreScores — recomputed whenever scores change.
  // blockedGenres:  genres at or below GENRE_BLOCK_THRESHOLD (score ≤ -3)
  // priorityGenres: genres at or above GENRE_PRIORITY_THRESHOLD (score ≥ +3)
  const blockedGenres = useMemo(() => {
    return new Set(
      Object.entries(genreScores)
        .filter(([, score]) => score <= GENRE_BLOCK_THRESHOLD)
        .map(([id]) => Number(id))
    );
  }, [genreScores]);

  const priorityGenres = useMemo(() => {
    return new Set(
      Object.entries(genreScores)
        .filter(([, score]) => score >= GENRE_PRIORITY_THRESHOLD)
        .map(([id]) => Number(id))
    );
  }, [genreScores]);

  // SCROLL_HIDDEN: scroll mode deprecated — swipe is always active.
  // ScrollView code preserved below in case scroll mode is re-enabled later.
  const viewMode = "swipe" as "swipe" | "scroll";

  // Liked film IDs for scroll mode (starts empty, populated from swipe history + new likes)
  const [likedInScroll, setLikedInScroll] = useState<Set<string>>(new Set());

  const queue = fullQueue;

  const loadFilms = useCallback(async (s: Session, participantId: string, isInitial = false) => {
    let poolWithMeta = await getSessionFilmsWithMeta(s.id);

    // ── Seed pool if empty ────────────────────────────────────────────────────
    // Use === 0 so that background-loaded batches don't re-trigger seeding.
    if (poolWithMeta.length === 0) {
      await seedHomePool(s);
      poolWithMeta = await getSessionFilmsWithMeta(s.id);
    }

    // In tiebreaker mode only show the tied films
    if (s.tiebreaker_film_ids?.length) {
      const ids = new Set(s.tiebreaker_film_ids);
      poolWithMeta = poolWithMeta.filter(({ film }) => ids.has(film.id));
    }

    // Store full session film list for second-chance end-of-deck pass
    allSessionFilmsRef.current = poolWithMeta.map(({ film }) => film);

    const [mySwiped, myLikes] = await Promise.all([
      getMySwipes(s.id, participantId),
      getMyLikes(s.id, participantId),
    ]);
    setLikedInScroll(myLikes);

    // Initialise per-session swipe history ref from existing DB data
    if (isInitial) {
      const history = new Map<string, boolean>();
      for (const id of mySwiped) history.set(id, myLikes.has(id));
      mySwipeHistoryRef.current = history;
    }

    const unswiped = poolWithMeta.filter(({ film }) => !mySwiped.has(film.id));

    const userAdded = unswiped.filter(({ addedBy }) => addedBy && addedBy !== participantId);
    const autoSeeded = unswiped.filter(({ addedBy }) => !addedBy || addedBy === participantId);

    // Filter home pool by streaming services.
    // Since we seed from TMDB Discover (provider-filtered), films in the pool
    // should already match. This filter is the final safety net.
    //
    // Post-#67: providers are now fetched in the session's region rather than
    // hardcoded AU, so this filter applies to all regions. The remaining caveat
    // is cross-region staleness — if a film was first cached by a user in
    // region X and later viewed by a user in region Y, the providers field may
    // still hold X's data until upsertFilm's needsRefresh re-fetches. Tracked
    // for proper resolution as a follow-up (per-region provider storage).
    let filteredAuto = autoSeeded;
    if (
      (s.watch_mode === "home" || s.watch_mode === "both") &&
      s.streaming_services?.length > 0
    ) {
      console.log("[filter] session services:", s.streaming_services);
      console.log("[filter] pool before filter:", autoSeeded.length, "films");
      autoSeeded.slice(0, 5).forEach(({ film }) =>
        console.log(`  "${film.title}" providers:`, film.watch_providers_au?.map(p => p.serviceId))
      );
      filteredAuto = autoSeeded.filter(({ film }) => {
        const providers: { serviceId: string }[] = film.watch_providers_au ?? [];
        return providers.some((p) => s.streaming_services.includes(p.serviceId));
      });
      console.log("[filter] pool after filter:", filteredAuto.length, "films");
    }

    function shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
    shuffle(userAdded);

    // ── Update queue ─────────────────────────────────────────────────────────
    const INITIAL_SLICE = 40;
    const userAddedFilmIds = new Set(userAdded.map(({ film }) => film.id));

    if (isInitial) {
      // Partition the pool into non-overlapping slots so the first 4 participants
      // collectively cover different films, maximising group coverage from swipe 1.
      // Participant 5+ falls back to a seeded shuffle of the full pool.
      // After the initial 40, the reserve is shuffled per-participant so drip order varies.
      const autoFilms = filteredAuto.map(({ film }) => film);
      const userAddedFilms = userAdded.map(({ film }) => film);

      // Hash participantId to a stable integer seed — same result on every refresh.
      let seed = 0;
      for (let i = 0; i < participantId.length; i++) seed = Math.imul(31, seed) + participantId.charCodeAt(i) | 0;
      seed = Math.abs(seed);

      // Slot = join order (0-indexed, sorted by created_at). -1 means not found → shuffle fallback.
      const slot = participantsRef.current.findIndex((p) => p.id === participantId);

      // How many auto films fill the initial deck (user-added take priority for their slots)
      const autoSlice = Math.max(0, INITIAL_SLICE - userAddedFilms.length);

      let initialAuto: Film[];
      if (slot >= 0 && slot < 4) {
        // Non-overlapping slice: slot 0 = films 0–39, slot 1 = 40–79, slot 2 = 80–119, slot 3 = 120–159.
        const slotStart = slot * INITIAL_SLICE;
        const slotEnd = slotStart + autoSlice;

        if (autoFilms.length >= slotEnd) {
          // Pool is large enough — use the non-overlapping slot for maximum group coverage.
          initialAuto = autoFilms.slice(slotStart, slotEnd);
          // Reserve = everything after this slot, shuffled per-participant so drip order varies.
          reserveQueueRef.current = seededShuffle(autoFilms.slice(slotStart + INITIAL_SLICE), seed);
        } else {
          // Pool is too small for this participant's slot — seedMoreHomePool hasn't finished yet.
          // Fall back to a seeded shuffle of whatever is available so the deck is never empty.
          // The reserve fills via the session_films subscription as batches land.
          // (Pre-slot behaviour: everyone shuffled the same available pool — works for any pool size.)
          console.log(`[loadFilms] slot ${slot} undersized (need ${slotEnd}, have ${autoFilms.length}) — shuffle fallback`);
          const shuffledAuto = seededShuffle(autoFilms, seed);
          initialAuto = shuffledAuto.slice(0, autoSlice);
          reserveQueueRef.current = shuffledAuto.slice(autoSlice);
        }
      } else {
        // Participant 5+: seeded shuffle of the full pool (same behaviour as before).
        const shuffledAuto = seededShuffle(autoFilms, seed);
        initialAuto = shuffledAuto.slice(0, autoSlice);
        reserveQueueRef.current = shuffledAuto.slice(autoSlice);
      }

      // Interleave user-added near position 3 in the initial queue
      const insertAt = Math.min(3, initialAuto.length);
      const initialQueue = [
        ...initialAuto.slice(0, insertAt),
        ...userAddedFilms,
        ...initialAuto.slice(insertAt),
      ];

      setFullQueueTagged(() => initialQueue, "load-initial");
      advanceIndex(0);
      setAllDone(initialQueue.length === 0);
    } else {
      // Background update: new user-added films surface near top of active queue;
      // new auto-seeded films go into the reserve to be dripped in gradually.
      const ci = currentIndexRef.current;

      setFullQueueTagged((prev) => {
        const existingQueueIds = new Set(prev.map((f) => f.id));
        const existingReserveIds = new Set(reserveQueueRef.current.map((f) => f.id));
        const existingIds = new Set([...existingQueueIds, ...existingReserveIds]);

        const allOrdered = [
          ...filteredAuto.map(({ film }) => film),
          ...userAdded.map(({ film }) => film),
        ];
        const fresh = allOrdered.filter((f) => !existingIds.has(f.id));
        if (fresh.length === 0) return prev;

        setAllDone(false);

        const freshUserAdded = fresh.filter((f) => userAddedFilmIds.has(f.id));
        const freshAuto = fresh.filter((f) => !userAddedFilmIds.has(f.id));

        // Auto films → reserve (drip will bring them into the active queue)
        if (freshAuto.length > 0) {
          reserveQueueRef.current = [...reserveQueueRef.current, ...freshAuto];
        }

        if (freshUserAdded.length === 0) return prev;

        // User-added → surface near positions 3–8 of the unseen queue immediately
        const unseen = [...prev.slice(ci)];
        const userInsertBase = Math.max(1, Math.min(3, unseen.length));
        for (const film of freshUserAdded) {
          const pos = Math.min(userInsertBase + Math.floor(Math.random() * 6), unseen.length);
          unseen.splice(pos, 0, film);
        }
        return [...prev.slice(0, ci), ...unseen];
      }, "load-non-initial");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Like propagation helper ───────────────────────────────────────────────────
  // Surfaces a film liked by another participant near the top of this user's unseen deck.
  // Three tiers: (1) already in queue → move up, (2) in reserve → pull out, (3) in
  // allSessionFilms but a different participant's slot → cross-slot injection.
  // Reserve mutation is done OUTSIDE the functional updater to keep it pure (React
  // StrictMode calls updaters twice; side-effecting refs inside updaters cause double-mutation).
  const propagateFilm = useCallback((filmId: string) => {
    const ci = currentIndexRef.current;

    // Pre-resolve injection source before the updater runs.
    const reserveIdx = reserveQueueRef.current.findIndex((f) => f.id === filmId);
    let injectionFilm: Film | null = null;
    if (reserveIdx !== -1) {
      injectionFilm = reserveQueueRef.current[reserveIdx];
      // Remove from reserve so it doesn't drip in as a duplicate later.
      reserveQueueRef.current = reserveQueueRef.current.filter((_, i) => i !== reserveIdx);
    } else if (!mySwipeHistoryRef.current.has(filmId)) {
      // Cross-slot: only inject if user hasn't already swiped this film.
      injectionFilm = allSessionFilmsRef.current.find((f) => f.id === filmId) ?? null;
    }

    setFullQueueTagged((prev) => {
      const filmIdx = prev.findIndex((f) => f.id === filmId);
      if (filmIdx !== -1) {
        // Already in queue — move it closer to the current card, but never
        // into the FRONT_BUFFER zone. If it's already inside the buffer,
        // leave it (it'll be seen soon naturally). Otherwise target a random
        // position from ci+FRONT_BUFFER through ci+FRONT_BUFFER+2.
        if (filmIdx < ci + FRONT_BUFFER) return prev;
        const targetPos = Math.min(ci + FRONT_BUFFER + Math.floor(Math.random() * 3), prev.length - 1);
        if (filmIdx <= targetPos) return prev;
        const next = [...prev];
        const [film] = next.splice(filmIdx, 1);
        next.splice(targetPos, 0, film);
        return next;
      }
      // Inject from pre-resolved source (reserve pull or cross-slot).
      // Insert just past the buffer so the locked-front cards are untouched.
      if (injectionFilm) {
        const next = [...prev];
        next.splice(Math.min(ci + FRONT_BUFFER, next.length), 0, injectionFilm);
        return next;
      }
      return prev;
    }, "propagate");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");

      logEvent(s.id, pid, "deck.mount", { status: s.status, started: s.started, ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null });
      setSession(s);

      if (s.status === "closed") {
        const existing = await getMatches(s.id);
        if (existing.length > 0) {
          // Hydrate participant + participants list before returning, otherwise
          // the !participant render guard wins over the matchList branch and the
          // page stays a blank <div>. See #81.
          const allParticipants = await getParticipants(s.id);
          setParticipants(allParticipants);
          const me = allParticipants.find((p) => p.id === pid);
          if (me) setParticipant(me); else setIsKicked(true);
          setMatchList(existing);
          setLoading(false);
          return;
        }
        else { router.push("/"); return; }
      }

      const allParticipants = await getParticipants(s.id);
      participantsRef.current = allParticipants; // set before loadFilms so slot calc sees correct list
      setParticipants(allParticipants);

      if (!allParticipants.some(p => p.id === pid)) {
        setIsKicked(true);
        setLoading(false);
        return;
      }

      setParticipant(allParticipants.find((p) => p.id === pid) ?? null);

      const { count: filmCount } = await supabase
        .from("session_films")
        .select("*", { count: "exact", head: true })
        .eq("session_id", s.id);
      setSessionFilmCount(filmCount ?? 0);

      // ── Snapshot restore: instant return from + / results pages ───────────
      const savedQueue = sessionStorage.getItem(`filmclub-queue-${code}`);
      const savedIndex = sessionStorage.getItem(`filmclub-index-${code}`);
      if (savedQueue && savedIndex) {
        setFullQueueTagged(() => JSON.parse(savedQueue) as Film[], "snapshot-restore");
        advanceIndex(parseInt(savedIndex, 10));
        // Restore phase-scoring state in parallel with silent background refresh
        const stats = await getSessionSwipeStats(s.id);
        setGroupSwipeCount(stats.totalSwipes);
        setGroupLikeCount(stats.totalLikes);
        filmLikesRef.current = stats.filmLikes;
        setFilmLikes(stats.filmLikes);
        // Rebuild personal swipe history — the silent loadFilms below runs in
        // non-initial mode and won't touch this ref, so without an explicit
        // rebuild here it would stay empty and break the cross-slot propagation
        // guard + the Layer-2 end-of-deck filter.
        const [mySwipedSnap, myLikesSnap] = await Promise.all([
          getMySwipes(s.id, pid),
          getMyLikes(s.id, pid),
        ]);
        const history = new Map<string, boolean>();
        for (const id of mySwipedSnap) history.set(id, myLikesSnap.has(id));
        mySwipeHistoryRef.current = history;
        setLikedInScroll(myLikesSnap);
        setLoading(false);
        loadFilms(s, pid);   // silent background refresh for new films
        return;
      }

      // ── First visit: full init with loading screen ─────────────────────────
      await loadFilms(s, pid, true);

      // Initialise phase-scoring counters and per-film like map from existing swipe history
      const stats = await getSessionSwipeStats(s.id);
      setGroupSwipeCount(stats.totalSwipes);
      setGroupLikeCount(stats.totalLikes);
      filmLikesRef.current = stats.filmLikes;
      setFilmLikes(stats.filmLikes);

      // Show a one-time "how it works" card to users who joined after the session started
      if (s.started && !sessionStorage.getItem(`filmclub-hints-${code}`)) {
        setShowLateModal(true);
      }

      setLoading(false);

      // Fire-and-forget: silently expand the home pool while the user swipes.
      // The session_films subscription will extend the queue as batches land.
      if (s.watch_mode === "home" || s.watch_mode === "both") {
        seedMoreHomePool(s);
      }
    }
    init();
  // seedMoreHomePool is stable (defined inside component, no captured state)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, router, loadFilms]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`session-${session.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${session.id}` },
        async (payload) => {
          const updated = payload.new as Session;
          logEvent(session.id, participant?.id, "session.update_received", { status: updated.status, tiebreaker: !!updated.tiebreaker_film_ids?.length });
          setSession(updated);
          if (updated.status === "closed") {
            const existing = await getMatches(session.id);
            if (existing.length > 0) setMatchList(existing);
            else router.push("/");
          } else if (updated.tiebreaker_film_ids?.length && participant) {
            // Tiebreaker started — reload queue with only tied films
            setMatchList([]);
            setAllDone(false);
            advanceIndex(0);
            await loadFilms(updated, participant.id, true);
          }
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "swipes", filter: `session_id=eq.${session.id}` },
        async (payload) => {
          const newSwipe = payload.new as { film_id: string; liked: boolean; participant_id: string };

          // Update group phase-scoring counters
          setGroupSwipeCount((c) => c + 1);
          if (newSwipe.liked) {
            setGroupLikeCount((c) => c + 1);
            // Update per-film like map — write ref synchronously so handleSwipe always
            // reads the latest value even before the React state flush renders.
            const updatedLikes = new Map(filmLikesRef.current);
            const existingIds = updatedLikes.get(newSwipe.film_id) ?? [];
            updatedLikes.set(newSwipe.film_id, [...existingIds, newSwipe.participant_id]);
            filmLikesRef.current = updatedLikes;
            setFilmLikes(updatedLikes);

            // Like propagation: someone else liked a film — surface it near the top of
            // this user's unseen deck. If a drag is in progress, defer until drag ends
            // so we don't yank the card out from under the user's finger.
            if (newSwipe.participant_id !== participantRef.current?.id) {
              if (!swipeInProgress.current) {
                propagateFilm(newSwipe.film_id);
              } else {
                pendingPropagationsRef.current.push(newSwipe.film_id);
              }

              // Belt-and-suspenders match re-check: fires when another participant
              // likes a film we've also liked. Catches the simultaneous-swipe race
              // where both handleSwipe checkForMatch calls ran before either write
              // committed. By the time this subscription fires, the remote write is
              // definitively in DB; our write was awaited earlier so it's also there.
              const sess = sessionRef.current;
              if (sess?.started && sess.mode === "live" &&
                  mySwipeHistoryRef.current.get(newSwipe.film_id) === true) {
                // Trigger of this match check is the remote swiper whose like just landed.
                const isMatch = await checkForMatch(sess.id, newSwipe.film_id, sess.threshold, newSwipe.participant_id);
                if (isMatch) {
                  // Grace period: match recorded but defer resolution to the grace-period effect.
                  if (inGracePeriod()) return;
                  await new Promise((r) => setTimeout(r, 300));
                  const allMatches = await getMatches(sess.id);
                  if (allMatches.length === 1) await resolveMatch(sess.id, allMatches[0].film_id);
                  else if (allMatches.length > 1) await closeSession(sess.id);
                  if (allMatches.length > 0) { setMatchList(allMatches); return; }
                }
              }
            }
          }

          // Fallback: if the session UPDATE subscription missed a close event,
          // catch it here so the match screen still appears.
          const latestSession = await getSession(code);
          if (latestSession?.started && latestSession?.mode === "live" && latestSession.status === "closed") {
            const existing = await getMatches(session.id);
            if (existing.length > 0) setMatchList(existing);
          }
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "session_films", filter: `session_id=eq.${session.id}` },
        () => {
          setSessionFilmCount((c) => c + 1);
          // Debounce: wait 800 ms after the last insert in a batch before refreshing.
          if (queueRefreshTimer.current) clearTimeout(queueRefreshTimer.current);
          queueRefreshTimer.current = setTimeout(async () => {
            if (!participant || !session) return;
            await loadFilms(session, participant.id);
          }, 800);
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "participants", filter: `session_id=eq.${session.id}` },
        (payload) => {
          const p = payload.new as Participant;
          setParticipants(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p]);
        })
      .subscribe((status) => {
        logEvent(session.id, participant?.id, "realtime.channel_status", { channel: "session", status });
      });

    // Broadcast channel: receives kick events from the host so all clients
    // update their pill list immediately.
    //
    // Self-kick path validates against the DB before flipping isKicked. The
    // channel name is `kicks:${session.id}` — anyone who knows the session
    // code can subscribe AND broadcast. Without the DB check a malicious
    // participant could send `participant_removed` with anyone's id and force
    // that user onto the KickedScreen. The DB DELETE event is the source of
    // truth; the broadcast just exists for instant pill-list updates. See #49.
    const kicksCh = supabase
      .channel(`kicks:${session.id}`)
      .on("broadcast", { event: "participant_removed" }, async ({ payload }) => {
        const removedId = payload.id as string;
        setParticipants(prev => prev.filter(p => p.id !== removedId));
        if (removedId === myParticipantId) {
          const { data } = await supabase.from("participants").select("id").eq("id", myParticipantId).maybeSingle();
          if (!data) {
            logEvent(session.id, myParticipantId, "participant.kicked", { verified: true });
            setIsKicked(true);
          } else {
            logEvent(session.id, myParticipantId, "participant.spoofed_kick_rejected");
          }
        }
      })
      .subscribe();

    // Belt-and-suspenders: PK-filter DELETE on own row — always delivered without REPLICA IDENTITY FULL.
    const selfCh = supabase
      .channel(`self-kick:${myParticipantId}`)
      .on("postgres_changes", {
        event: "DELETE", schema: "public", table: "participants",
        filter: `id=eq.${myParticipantId}`,
      }, () => setIsKicked(true))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(kicksCh);
      supabase.removeChannel(selfCh);
    };
  }, [session, participant, loadFilms, code]);

  // ── Safety net for dropped realtime: re-sync on tab focus / visibility ──────
  // Mobile Safari (and others) silently pause WebSockets when the tab is
  // backgrounded. If a match closes the session during that window, neither the
  // `sessions` UPDATE handler nor the `swipes` INSERT fallback fires. When the
  // user returns we re-check the server state and surface the match. See #81.
  useEffect(() => {
    if (!session || !participant) return;
    let cancelled = false;
    async function resync() {
      if (cancelled) return;
      const latest = await getSession(code);
      if (!latest || cancelled) return;
      if (latest.status === "closed") {
        const existing = await getMatches(latest.id);
        if (!cancelled && existing.length > 0) setMatchList(existing);
      }
    }
    const onVisible = () => {
      logEvent(session.id, participant.id, "visibility.change", { hidden: document.hidden });
      if (!document.hidden) resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", resync);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", resync);
    };
  }, [session, participant, code]);

  // ── Wheel broadcast channel — lets all participants see the spin ───────────
  useEffect(() => {
    if (!session) return;
    const ch = supabase
      .channel(`wheel:${session.id}`)
      .on("broadcast", { event: "spin" }, ({ payload }) => {
        setWheelFilms(payload.films as Match[]);
        setWheelWinnerId(payload.winnerId as string);
      })
      .subscribe();
    wheelChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); wheelChannelRef.current = null; };
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deterministic winner selection for respin — same result on all devices
  function hashSimple(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return Math.abs(h);
  }

  function handleRespin(excludeFilmId: string) {
    const remaining = (wheelFilms ?? []).filter((m) => m.film_id !== excludeFilmId);
    if (remaining.length === 0) return;
    const sorted = [...remaining].sort((a, b) =>
      (a.film?.title ?? "").localeCompare(b.film?.title ?? "")
    );
    const newWinnerId = remaining.length === 1
      ? remaining[0].film_id
      : sorted[hashSimple(excludeFilmId) % sorted.length].film_id;
    // All devices run the same deterministic calculation — no broadcast needed
    setWheelFilms(remaining);
    setWheelWinnerId(newWinnerId);
  }

  async function handleCharacterFilmClick(name: string) {
    const charFilm = getCharacterFilm(name);
    if (!charFilm) return;
    const detail = await getFilmDetail(charFilm.tmdbId);
    if (!detail) return;
    setCharInfoFilm({ ...tmdbToFilm(detail), id: `char-${detail.id}` });
  }

  async function handleSwipe(liked: boolean) {
    if (!session || !participant || currentIndex >= queue.length) return;
    if (swipingIndexRef.current === currentIndex) return;
    // Time-based debounce: a stray click on a freshly-mounted ActionButton or
    // overlay heart, fired within the swipe-out animation window, would
    // otherwise pass the index guard because the closure now holds the next
    // currentIndex. 300 ms is well below any deliberate inter-swipe interval.
    if (Date.now() - lastSwipeAtRef.current < 300) {
      logEvent(session.id, participant.id, "swipe.debounced", { currentIndex, liked, since_last_ms: Date.now() - lastSwipeAtRef.current });
      return;
    }
    lastSwipeAtRef.current = Date.now();
    swipingIndexRef.current = currentIndex;
    const s = sessionRef.current ?? session; // always fresh — avoids stale closure
    const film = queue[currentIndex];
    const isSolo = participants.length <= 1;
    logEvent(s.id, participant.id, "swipe.write", { source: "deck", film_id: film.id, liked, currentIndex, queue_length: queue.length });

    // ── Swipe history (synchronous) ───────────────────────────────────────────
    mySwipeHistoryRef.current.set(film.id, liked);

    // ── Franchise block: apply synchronously for known collection_id ──────────
    // collection_id semantics:
    //   null / undefined → not yet checked (pre-migration cached film) — fetched async below
    //   0               → checked, confirmed no collection (sentinel)
    //   positive int    → belongs to that TMDB collection
    const cid = film.collection_id ?? null;
    let newBlocked = blockedCollections;
    let workingQueue = queue;

    if (!liked) {
      if (cid) {
        // Already have a real collection_id — block immediately, no await needed
        newBlocked = new Set([...blockedCollections, cid]);
        setBlockedCollections(newBlocked);
      }
      // cid === null → unknown, handled async below after index has already advanced
    } else if (cid && blockedCollections.has(cid)) {
      // Yes on a previously blocked franchise — reopen it
      newBlocked = new Set([...blockedCollections].filter((id) => id !== cid));
      setBlockedCollections(newBlocked);
    }

    // ── Genre scoring (issue #23) ─────────────────────────────────────────────
    // Update scores synchronously — +1 per genre on like, -1 per genre on dislike.
    // Then derive new blocked/priority sets for use by skipBlocked and the priority swap.
    let newGenreScores = genreScores;
    let newBlockedGenres = blockedGenres;
    let newPriorityGenres = priorityGenres;

    if (film.genres.length > 0) {
      const delta = liked ? 1 : -1;
      newGenreScores = { ...genreScores };
      for (const { id: gid } of film.genres) {
        newGenreScores[gid] = (newGenreScores[gid] ?? 0) + delta;
      }
      setGenreScores(newGenreScores);

      console.log(
        "[genre:scores]",
        Object.entries(newGenreScores)
          .sort(([, a], [, b]) => b - a)
          .map(([id, score]) => `${GENRE_NAME[Number(id)] ?? id}:${score > 0 ? "+" : ""}${score}`)
          .join("  ")
      );

      // Recompute derived sets from the NEW scores (can't use state — hasn't flushed yet)
      newBlockedGenres = new Set(
        Object.entries(newGenreScores)
          .filter(([, s]) => s <= GENRE_BLOCK_THRESHOLD)
          .map(([id]) => Number(id))
      );
      newPriorityGenres = new Set(
        Object.entries(newGenreScores)
          .filter(([, s]) => s >= GENRE_PRIORITY_THRESHOLD)
          .map(([id]) => Number(id))
      );

      // Log newly blocked genres (weren't blocked before, are now)
      for (const gid of newBlockedGenres) {
        if (!blockedGenres.has(gid)) {
          console.log(`[genre:block] "${GENRE_NAME[gid] ?? gid}" blocked (score: ${newGenreScores[gid]})`);
        }
      }
      // Log newly unblocked genres (were blocked before, aren't now)
      for (const gid of blockedGenres) {
        if (!newBlockedGenres.has(gid)) {
          console.log(`[genre:unblock] "${GENRE_NAME[gid] ?? gid}" unblocked (score: ${newGenreScores[gid]})`);
        }
      }
      // Log newly priority genres
      for (const gid of newPriorityGenres) {
        if (!priorityGenres.has(gid)) {
          console.log(`[genre:priority] "${GENRE_NAME[gid] ?? gid}" prioritised (score: ${newGenreScores[gid]})`);
        }
      }
      // Log newly de-prioritised genres
      for (const gid of priorityGenres) {
        if (!newPriorityGenres.has(gid)) {
          console.log(`[genre:depriority] "${GENRE_NAME[gid] ?? gid}" deprioritised (score: ${newGenreScores[gid]})`);
        }
      }
    }

    // ── Drip (synchronous) ────────────────────────────────────────────────────
    swipeCountRef.current += 1;
    if (swipeCountRef.current % 20 === 0 && reserveQueueRef.current.length > 0) {
      const drip = reserveQueueRef.current.slice(0, 20);
      reserveQueueRef.current = reserveQueueRef.current.slice(20);
      console.log(`[drip] swipe ${swipeCountRef.current} — spliced ${drip.length} films into queue, reserve remaining: ${reserveQueueRef.current.length}`);
      workingQueue = [...workingQueue, ...drip];
      const ci = currentIndex;
      setFullQueueTagged((prev) => {
        // Lock the front-buffer cards. Drip splices into the unseen tail
        // starting from position FRONT_BUFFER (relative to the unseen slice).
        // First card of unseen (= queue[ci]) is the live front card.
        const lockedEnd = Math.min(ci + FRONT_BUFFER, prev.length);
        const locked = prev.slice(0, lockedEnd);
        const tail = [...prev.slice(lockedEnd)];
        for (const f of drip) {
          const pos = tail.length === 0 ? 0 : Math.floor(Math.random() * Math.min(tail.length + 1, 15));
          tail.splice(pos, 0, f);
        }
        return [...locked, ...tail];
      }, "drip");
    }

    // ── Genre priority swap ───────────────────────────────────────────────────
    // If there are priority genres, scan the look-ahead window for a matching
    // film and swap it to position ci + FRONT_BUFFER. The locked front cards
    // (ci through ci + FRONT_BUFFER - 1) are never displaced. Uses film IDs
    // inside the functional setFullQueue update to avoid index-drift from
    // the concurrent drip splice above.
    if (newPriorityGenres.size > 0) {
      const targetSlot = currentIndex + FRONT_BUFFER;
      const swapIdx = findPriorityFilmInWindow(
        targetSlot,
        workingQueue,
        newPriorityGenres,
        newBlockedGenres,
        newBlocked,
        filmLikesRef.current,
      );
      // Don't displace a propagated film at the target slot — if it's already
      // liked by another participant, respect that social signal.
      const filmAtSlot = workingQueue[targetSlot];
      const slotIsLikedByOther = !!filmAtSlot &&
        (filmLikesRef.current.get(filmAtSlot.id) ?? []).some((id) => id !== participant?.id);
      if (swapIdx > targetSlot && !slotIsLikedByOther) {
        const targetFilmId = workingQueue[swapIdx].id;
        console.log(
          `[genre:swap] "${workingQueue[swapIdx].title}" (${workingQueue[swapIdx].genres.map((g) => g.name).join(", ")}) → position ${targetSlot}`
        );
        workingQueue = [...workingQueue];
        // Perform the swap in workingQueue for nextIdx computation below
        [workingQueue[targetSlot], workingQueue[swapIdx]] =
          [workingQueue[swapIdx], workingQueue[targetSlot]];
        // Perform the same swap in fullQueue using film IDs (safe against drip index drift)
        setFullQueueTagged((prev) => {
          const next = [...prev];
          const aIdx = next.findIndex((f) => f.id === workingQueue[targetSlot].id);
          const bIdx = next.findIndex((f) => f.id === targetFilmId);
          if (aIdx !== -1 && bIdx !== -1 && aIdx !== bIdx) {
            [next[aIdx], next[bIdx]] = [next[bIdx], next[aIdx]];
          }
          return next;
        }, "priority-swap");
      }
    }

    // ── Advance index immediately — don't wait for DB ─────────────────────────
    // The card has already animated off-screen in SwipeCard before onLike/onDislike
    // fires, so advancing here makes the next card appear with zero perceptible delay.
    // Use filmLikesRef.current (not the stale filmLikes closure) so recently propagated
    // films aren't incorrectly skipped by the franchise/genre block exemption check.
    const nextIdx = skipBlocked(currentIndex + 1, workingQueue, newBlocked, filmLikesRef.current, newBlockedGenres);
    if (nextIdx < workingQueue.length) {
      advanceIndex(nextIdx);
      if (infoFilm) setInfoFilm(workingQueue[nextIdx]);
    }

    // ── DB write — awaited so checkForMatch below always sees our vote ───────
    // Previously fire-and-forget (void), which caused a race: checkForMatch could
    // query the DB before our swipe committed, missing the unanimous threshold.
    await recordSwipe(s.id, participant.id, film.id, liked);

    // ── Async: on-demand franchise fetch for unknown collection_id ────────────
    // Runs after index has advanced so the user never waits for this fetch.
    // CRITICAL: must use functional updaters — getFilmDetail + fetchCollectionTmdbIds
    // can take 300-600ms total, during which the user may swipe several more cards
    // that mutate fullQueue (drip, priority swap, etc). A non-functional setFullQueue
    // here would overwrite the live queue with a stale snapshot, causing the visible
    // card to change abruptly. See #65.
    if (!liked && cid === null) {
      const detail = await getFilmDetail(film.tmdb_id);
      const detailCid = detail?.belongs_to_collection?.id ?? 0;
      if (detailCid) {
        const colMemberIds = await fetchCollectionTmdbIds(detailCid);
        setFullQueueTagged((prev) => prev.map((f) =>
          f.id === film.id || (colMemberIds.has(f.tmdb_id) && f.collection_id == null)
            ? { ...f, collection_id: detailCid }
            : f
        ), "collection-backfill-positive");
        setBlockedCollections((prev) => new Set([...prev, detailCid]));
      } else {
        setFullQueueTagged((prev) =>
          prev.map((f) => f.id === film.id ? { ...f, collection_id: 0 } : f)
        , "collection-backfill-negative");
      }
    }

    // ── Async: match check ────────────────────────────────────────────────────
    if (liked && s.started && !isSolo) {
      // Trigger of this match is the local participant who just swiped.
      const isMatch = await checkForMatch(s.id, film.id, s.threshold, participant.id);
      if (isMatch && s.mode === "live") {
        logEvent(s.id, participant.id, "match.detected", { source: "deck-swipe", film_id: film.id, in_grace_period: inGracePeriod() });
        // Grace period: match is recorded in DB but session stays open. The
        // grace-period effect will resolve all accumulated matches when the timer fires.
        if (inGracePeriod()) return;
        // Brief delay for DB consistency before reading matches
        await new Promise((r) => setTimeout(r, 300));
        const allMatches = await getMatches(s.id);
        if (allMatches.length === 1) {
          // Single winner — resolveMatch closes the session and records the outcome
          await resolveMatch(s.id, allMatches[0].film_id);
        } else if (allMatches.length > 1) {
          // Multiple winners — close now so all devices see the match screen;
          // shortlist will call resolveMatch with the final winner
          await closeSession(s.id);
        }
        if (allMatches.length > 0) { setMatchList(allMatches); return; }
      }
    }

    // ── End-of-deck handling ──────────────────────────────────────────────────
    if (nextIdx >= workingQueue.length) {
      // Layer 1: drain remaining reserve
      if (reserveQueueRef.current.length > 0) {
        const refill = reserveQueueRef.current.slice(0, 20);
        reserveQueueRef.current = reserveQueueRef.current.slice(20);
        setFullQueueTagged((prev) => [...prev, ...refill], "end-of-deck-refill");
        advanceIndex(workingQueue.length);
        if (infoFilm) setInfoFilm(refill[0]);
        return;
      }

      // Layer 2: end-of-deck cross-slot — surface films liked by at least one
      // OTHER participant that the user hasn't swiped on at all. Never re-show
      // anything the user already liked or disliked.
      const secondChance = allSessionFilmsRef.current
        .filter((f) => {
          if (mySwipeHistoryRef.current.has(f.id)) return false;
          const likers = filmLikes.get(f.id) ?? [];
          return likers.some((id) => id !== participant.id);
        })
        .sort((a, b) => (filmLikes.get(b.id)?.length ?? 0) - (filmLikes.get(a.id)?.length ?? 0));

      if (secondChance.length > 0) {
        setFullQueueTagged((prev) => [...prev, ...secondChance], "end-of-deck-second-chance");
        advanceIndex(workingQueue.length);
        if (infoFilm) setInfoFilm(secondChance[0]);
        return;
      }

      // Layer 3: fetch a fresh batch from TMDB (fire-and-forget)
      if (s.watch_mode === "home" || s.watch_mode === "both") seedMoreHomePool(s);

      // Final batch match check — catches the case where this was the last voter
      if (s.started && s.mode === "live" && !isSolo) {
        let found = false;
        for (const f of workingQueue) {
          // End-of-deck batch check — local participant is the trigger if any match crosses.
          if (await checkForMatch(s.id, f.id, s.threshold, participant.id)) found = true;
        }
        if (found) {
          // Grace period: matches recorded but session stays open until the timer fires.
          if (inGracePeriod()) return;
          await new Promise((r) => setTimeout(r, 300));
          const allMatches = await getMatches(s.id);
          if (allMatches.length === 1) {
            await resolveMatch(s.id, allMatches[0].film_id);
          } else if (allMatches.length > 1) {
            await closeSession(s.id);
          }
          if (allMatches.length > 0) { setMatchList(allMatches); return; }
        }
      }
      setAllDone(true);
      setInfoFilm(null);
    }
  }

  async function handleStart() {
    if (!session) return;
    setStarting(true);
    // Set the local grace-period start synchronously so handleSwipe and the
    // realtime subscription immediately see inGracePeriod() === true. Without
    // this, the grace-period effect's setTimeout wouldn't be scheduled until
    // the next render flushes session.started=true, which is too late for any
    // matches detected in the same tick.
    startedAtRef.current = Date.now();
    await startSession(session.id);
    setSession((s) => s ? { ...s, started: true } : s);

    if (session.mode === "live" && participants.length > 1) {
      // Run checkAllMatches to commit any pre-Start matches into the matches
      // table. Don't close the session here — the grace-period effect will
      // resolve them (or any newer ones) when the timer fires.
      await checkAllMatches(session.id, session.threshold);
    }
    setStarting(false);
  }

  async function handleScrollLike(film: Film) {
    const s = sessionRef.current ?? session;
    if (!s || !participant) return;
    setLikedInScroll((prev) => new Set([...prev, film.id]));
    await recordSwipe(s.id, participant.id, film.id, true);
    if (s.started) {
      const isMatch = await checkForMatch(s.id, film.id, s.threshold);
      if (isMatch && s.mode === "live") {
        await closeSession(s.id);
        await new Promise((r) => setTimeout(r, 300));
        const allMatches = await getMatches(s.id);
        if (allMatches.length > 0) setMatchList(allMatches);
      }
    }
  }

  async function handleScrollUnlike(film: Film) {
    const s = sessionRef.current ?? session;
    if (!s || !participant) return;
    setLikedInScroll((prev) => { const next = new Set(prev); next.delete(film.id); return next; });
    await recordSwipe(s.id, participant.id, film.id, false);
  }

  async function handleShare() {
    await navigator.clipboard.writeText(`filmclub.watch ${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // ── Lobby — shown to new joiners until the host starts the session ──────────
  // Skip lobby if the user has a snapshot (returning from search/results) to
  // avoid a flash of the lobby before the snapshot is restored.
  // Blank screen while session loads — prevents a flash of the swipe UI
  // before the lobby animation plays on first join.
  if (!session || !participant) {
    return <div className="min-h-dvh" style={{ background: "var(--bg)" }} />;
  }

  if (session !== null && !session.started) {
    const hostParticipant = participants[0]; // creator always joins first
    // Preload the first 5 posters in the background while in the lobby. Browser
    // caches them so when the deck mounts after Start, the first card renders
    // instantly instead of flashing a blank for ~300ms while the image loads.
    const lobbyPreloadPosters = fullQueue
      .slice(0, 5)
      .map((f) => f.poster_path ? posterUrl(f.poster_path, "w780") : null)
      .filter(Boolean) as string[];
    return (
      <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
        {/* Hidden preload — first 5 deck posters, warmed during lobby wait */}
        {lobbyPreloadPosters.map((url) => (
          <img key={url} src={url} alt="" aria-hidden className="hidden" />
        ))}
        <MailButton />
        <div className="flex flex-col flex-1 mx-auto w-full px-5 pt-10" style={{ maxWidth: 480, paddingBottom: "max(calc(env(safe-area-inset-bottom) + 2rem), 6rem)" }}>

          {/* Logo — slides up from the position it held on the home page */}
          <motion.div
            className="flex justify-center mb-10"
            initial={{ y: logoStartY, opacity: 0 }}
            animate={{ y: [logoStartY, logoStartY, 0], opacity: [0, 1, 1] }}
            transition={{
              duration: 1.4,
              times: [0, 0.22, 1],
              ease: ["easeOut", [0.4, 0, 0.2, 1]],
            }}
          >
            <Logo size="lg" />
          </motion.div>

          {/* Rest of lobby fades in after logo settles */}
          <motion.div
            className="flex flex-col flex-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.4 }}
          >

          {/* Session code */}
          <div className="mb-8 text-center">
            <p className="text-xs font-medium uppercase tracking-wider mb-3"
              style={{ color: "var(--text-muted)" }}>Join code</p>
            <CodeDisplay code={code} onClick={handleShare} copied={copied} />
          </div>

          {/* Participants */}
          <div className="mb-6">
            <p className="text-xs font-medium uppercase tracking-wider mb-3"
              style={{ color: "var(--text-muted)" }}>
              {participants.length === 0 ? "Waiting for people to join…" : `${participants.length} in the room`}
            </p>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${lobbyGridCols(participants.length)}, minmax(0, 1fr))`, maxWidth: participants.length <= 3 ? "50%" : undefined }}>
              {participants.map((p) => {
                const color = participantColor(p.name);
                const isMe = p.id === participant?.id;
                const isHostP = p.id === hostParticipant?.id;
                return (
                  <div key={p.id}
                    className="flex items-center gap-2 px-2 py-2 rounded-xl"
                    style={{ background: "var(--surface)", border: `1px solid ${color}33` }}>
                    {/* Avatar */}
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                      style={{ background: `${color}25`, color }}>
                      {p.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color }}>
                        {p.name}
                      </p>
                      {(isHostP || isMe) && (
                        <p className="text-[10px] leading-none mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {isHostP && isMe ? "Host · you" : isHostP ? "Host" : "you"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* How it works + How it's decided — fills remaining space, pushed toward the CTA */}
          <div className="flex-1 flex flex-col justify-end gap-6 pb-10">

            {/* How to play */}
            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}>How to</p>
              {[
                { icon: <Layers size={16} />, text: "Swipe right to like and left to pass" },
                { icon: <Search size={16} />, text: "Search to add films to the pool" },
                { icon: <Trophy size={16} />, text: "See everyone's results as you go" },
                { icon: <Clock size={16} />, text: "Press and hold any film for more info" },
              ].map(({ icon, text }) => (
                <div key={text} className="flex items-center gap-3">
                  <span className="shrink-0" style={{ color: "var(--accent)" }}>{icon}</span>
                  <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{text}</span>
                </div>
              ))}
            </div>

            {/* How it's decided */}
            <div className="flex flex-col gap-3 mt-2">
              <p className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}>How it&apos;s decided</p>
              <div className="flex items-center gap-3">
                <span className="shrink-0" style={{ color: "var(--accent)" }}><Zap size={16} /></span>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>Everyone swipes right is an instant match</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-center text-[10px] font-bold" style={{ color: "var(--accent)" }}>OR</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="shrink-0" style={{ color: "var(--accent)" }}><Crown size={16} /></span>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{hostParticipant?.name ?? "Host"} can call a shortlist vote at any time</span>
              </div>
            </div>

          </div>

          {/* CTA */}
          <div className="pt-6">
            {isHost ? (
              <button
                onClick={handleStart}
                disabled={starting || loading || sessionFilmCount < MIN_FILMS}
                className="w-full py-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: "var(--like)",
                  color: "#0c0c0e",
                  opacity: (starting || loading || sessionFilmCount < MIN_FILMS) ? 0.55 : 1,
                }}>
                <Play size={14} fill="currentColor" />
                {starting ? "Starting…" : (loading || sessionFilmCount < MIN_FILMS) ? "Loading films…" : `Start · ${participants.length} ${participants.length === 1 ? "person" : "people"}`}
              </button>
            ) : (
              <div className="w-full py-4 rounded-xl text-sm text-center"
                style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                Waiting for {hostParticipant?.name ?? "the host"} to start…
              </div>
            )}
          </div>

          </motion.div>
        </div>
      </div>
    );
  }

  if (isKicked) {
    return (
      <KickedScreen
        sessionCode={code}
        sessionId={session?.id ?? ""}
        takenNames={participants.map(p => p.name)}
      />
    );
  }

  if (matchList.length > 0) {
    return (
      <div style={{ background: "var(--bg)" }}>
        <div className="mx-auto" style={{ maxWidth: 480 }}>
          <MatchScreen
            matches={matchList}
            session={session!}
            isHost={isHost}
            onRandomise={(winnerFilmId: string) => {
              // Set local state immediately and broadcast to all participants
              setWheelFilms(matchList);
              setWheelWinnerId(winnerFilmId);
              wheelChannelRef.current?.send({
                type: "broadcast", event: "spin",
                payload: { winnerId: winnerFilmId, films: matchList },
              });
            }}
            onShortlist={() => session && openShortlist(session.id, matchList.map(m => m.film_id))}
          />
        </div>

        {/* SpinWheel — at page level to avoid flash when transitioning to match screen */}
        {wheelFilms && wheelWinnerId && (
          <SpinWheel
            key={wheelWinnerId}
            films={wheelFilms}
            winnerId={wheelWinnerId}
            participantId={participant?.id}
            totalParticipants={participants.length}
            sessionId={session?.id}
            onComplete={async () => {
              // Resolve match in DB (host only — real-time fires on all devices)
              if (isHost) await resolveMatch(session!.id, wheelWinnerId);
              // Update matchList locally before hiding wheel — eliminates flash
              setMatchList((prev) => prev.filter((m) => m.film_id === wheelWinnerId));
              setWheelFilms(null);
              setWheelWinnerId(null);
            }}
            onRespin={handleRespin}
          />
        )}

        {showShortlist && session && shortlistData && (
          participants.length === 1 ? (
            <SinglePlayerVoteOverlay
              films={shortlistData.films}
              sessionId={session.id}
              sessionServices={session.streaming_services ?? []}
              region={session.region ?? "AU"}
              onComplete={async (winnerId) => {
                await resolveMatch(session.id, winnerId);
                setMatchList(prev => prev.filter(m => m.film_id === winnerId));
                setShowShortlist(false);
              }}
            />
          ) : (
            <ShortlistOverlay
              films={shortlistData.films}
              pinnedFilmIds={shortlistData.pinnedFilmIds}
              sessionId={session.id}
              participantId={participant?.id ?? ""}
              isHost={isHost}
              totalParticipants={participants.length}
              sessionServices={session.streaming_services ?? []}
              region={session.region ?? "AU"}
              onComplete={async (winnerId) => {
                if (isHost) await resolveMatch(session.id, winnerId);
                setMatchList(prev => prev.filter(m => m.film_id === winnerId));
                setShowShortlist(false);
              }}
            />
          )
        )}
      </div>
    );
  }

  const currentFilm = queue[currentIndex];
  const nextFilm = queue[skipBlocked(currentIndex + 1, queue, blockedCollections, filmLikes, blockedGenres)];

  // Preload the next 8 cards' posters (w780 — matches the display size on card) so they
  // are cache-warm before the user swipes to them. Also keep 3 backdrops ahead for the
  // info panel. Previously only backdrops were preloaded, so the visible card poster was
  // never in cache — this was the root cause of blank cards on fast swiping.
  const preloadStart = viewMode === "scroll" ? scrollIndexRef.current : currentIndex;
  const preloadWindow = queue.slice(preloadStart, preloadStart + 8);
  const preloadPosters = preloadWindow
    .map((f) => f.poster_path ? posterUrl(f.poster_path, "w780") : null)
    .filter(Boolean) as string[];
  const preloadBackdrops = preloadWindow
    .slice(0, 3)
    .map((f) => f.backdrop_path ? posterUrl(f.backdrop_path, "w1280") : null)
    .filter(Boolean) as string[];
  const preloadUrls = [...new Set([...preloadPosters, ...preloadBackdrops])];

  return (
    <div className="h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
    {/* Hidden preload images — posters (w780) for next 8 cards + backdrops for next 3 */}
    {preloadUrls.map((url) => (
      <img key={url} src={url} alt="" aria-hidden className="hidden" />
    ))}
    <div className="flex flex-col h-dvh mx-auto overflow-hidden"
      style={{ maxWidth: infoFilm ? 920 : 480, transition: "max-width 0.3s cubic-bezier(0.4,0,0.2,1)" }}>
      <header className="flex items-center px-5 pt-5 pb-3 shrink-0">
        {/* Left: icon centres on the combined Filmclub+code block */}
        <div className="flex items-center gap-2 shrink-0">
          <Logo size="sm" showText={false} />
          <div>
            <p className="text-lg font-light tracking-[0.15em] uppercase leading-tight" style={{ color: "var(--text)" }}>Filmclub</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{code}</p>
          </div>
        </div>
        <div className="flex-1" />
        {/* Centre: Shortlist Vote — flex spacers keep it centred in the gap */}
        {isHost && session?.status !== "closed" && !allDone && filmLikes.size >= 2 && (
          <button
            onClick={() => setShowShortlistConfirm(true)}
            className="shrink-0 whitespace-nowrap px-5 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e" }}>
            Shortlist Vote
          </button>
        )}
        <div className="flex-1" />
        {/* Right */}
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => router.push(`/session/${code}/add`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Search size={18} />
          </button>
          <button onClick={() => router.push(`/session/${code}/results`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Trophy size={18} />
          </button>
        </div>
      </header>

      {/* Participants */}
      <div className="flex justify-start gap-1.5 flex-wrap px-5 py-3 shrink-0">
        {participants.map((p) => (
          <ParticipantPill
            key={p.id}
            name={p.name}
            isMe={p.id === participant?.id}
            onFilmClick={getCharacterFilm(p.name) ? () => handleCharacterFilmClick(p.name) : undefined}
          />
        ))}
      </div>

      {/* REMOVE_PARTICIPANT_HIDDEN: re-enable to allow host to remove members
      {confirmRemoveId && session && (() => {
        const target = participants.find(p => p.id === confirmRemoveId);
        if (!target) return null;
        const col = participantColor(target.name);
        return (
          <div className="fixed bottom-0 left-0 right-0 z-40 px-5 pb-8 pt-4"
            style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
            <div className="mx-auto max-w-sm p-4 rounded-2xl" style={{ background: "var(--surface)" }}>
              <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
                Remove <span style={{ color: col }}>{target.name}</span>?
              </p>
              <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
                Their shortlist votes will be voided.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmRemoveId(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setConfirmRemoveId(null);
                    await removeParticipant(session.id, confirmRemoveId);
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        );
      })()} */}

      <div className="mb-4 shrink-0" />

      {/* Cards + info panel */}
      {viewMode === "scroll" ? (
        /* ── Scroll mode ──────────────────────────────────────── */
        <>
          <div className="flex-1 px-5" style={{ minHeight: 0 }}>
            {/* Scroll container. Visual card height = this - GAP(16px).
                Swipe container is set to this - 16px so both modes show identical card height. */}
            <div className="relative w-full" style={{ height: "calc(100dvh - 212px)" }}>
              {allDone || (queue.length === 0 && !loading) ? (
                <AllDoneScreen
                  mode={session?.mode ?? "live"}
                  watchMode={session?.watch_mode ?? "home"}
                  neverHadFilms={queue.length === 0}
                  onResults={() => router.push(`/session/${code}/results`)}
                  onSearch={() => router.push(`/session/${code}/add`)}
                  onBrowseMore={async () => { if (session && participant) { await loadFilms(session, participant.id); setAllDone(false); } }} />
              ) : (
                <ScrollView
                  ref={scrollViewRef}
                  films={queue}
                  likedIds={likedInScroll}
                  sessionServices={session?.streaming_services ?? []}
                  onLike={handleScrollLike}
                  onUnlike={handleScrollUnlike}
                  onInfo={(film) => setInfoFilm(film)}
                  votePhase={votePhase}
                  filmLikes={filmLikes}
                  participants={participants}
                  myParticipantId={participant?.id}
                  onIndexChange={(i) => { scrollIndexRef.current = i; }}
                  initialIndex={currentIndexRef.current}
                />
              )}
            </div>
          </div>

          {/* Info overlay for scroll mode (all screen sizes) */}
          <FilmInfoOverlay
            film={infoFilm}
            onClose={() => setInfoFilm(null)}
            onLike={infoFilm ? () => {
              handleScrollLike(infoFilm);
              const idx = queue.findIndex(f => f.id === infoFilm.id);
              if (idx !== -1 && idx + 1 < queue.length) {
                scrollViewRef.current?.scrollToIndex(idx + 1);
                setInfoFilm(queue[idx + 1]);
              } else {
                setInfoFilm(null);
              }
            } : undefined}
            onDislike={infoFilm ? () => {
              handleScrollUnlike(infoFilm);
              const idx = queue.findIndex(f => f.id === infoFilm.id);
              if (idx !== -1 && idx + 1 < queue.length) {
                scrollViewRef.current?.scrollToIndex(idx + 1);
                setInfoFilm(queue[idx + 1]);
              } else {
                setInfoFilm(null);
              }
            } : undefined}
            sessionServices={session?.streaming_services ?? []}
          />
        </>
      ) : (
        /* ── Swipe mode ───────────────────────────────────────── */
        <>
          <div className="flex gap-0 flex-1 px-5" style={{ minHeight: 0 }}>
            {/* Swipe card */}
            <div className="relative shrink-0 w-full"
              style={{ height: "calc(100dvh - 228px)", position: "relative", zIndex: 1 }}>
              <AnimatePresence>
                {allDone || (queue.length === 0 && !loading) ? (
                  <AllDoneScreen
                    mode={session?.mode ?? "live"}
                    watchMode={session?.watch_mode ?? "home"}
                    neverHadFilms={queue.length === 0}
                    onResults={() => router.push(`/session/${code}/results`)}
                    onSearch={() => router.push(`/session/${code}/add`)}
                    onBrowseMore={async () => { if (session && participant) { await loadFilms(session, participant.id); setAllDone(false); } }} />
                ) : (
                  <>
                    {nextFilm && (
                      <SwipeCard key={`${nextFilm.id}-next`} film={nextFilm}
                        onLike={() => {}} onDislike={() => {}}
                        onInfo={() => setInfoFilm(nextFilm)} isTop={false}
                        sessionServices={session?.streaming_services ?? []}
                        promotionMV={promotionMV} />
                    )}
                    {currentFilm && (
                      <motion.div key={currentFilm.id} className="absolute inset-0"
                        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}>
                        <SwipeCard film={currentFilm}
                          onLike={() => handleSwipe(true)}
                          onDislike={() => handleSwipe(false)}
                          onInfo={() => setInfoFilm(currentFilm)}
                          isTop={true}
                          sessionServices={session?.streaming_services ?? []}
                          votePhase={votePhase}
                          voteInfo={{
                            count: (filmLikes.get(currentFilm.id) ?? []).filter(id => id !== participant?.id).length,
                            participantIds: (filmLikes.get(currentFilm.id) ?? []).filter(id => id !== participant?.id),
                          }}
                          participants={participants}
                          onDragStart={() => { swipeInProgress.current = true; }}
                          onDragEnd={() => {
                            swipeInProgress.current = false;
                            // Flush any propagation events that arrived mid-drag.
                            for (const fid of pendingPropagationsRef.current) propagateFilm(fid);
                            pendingPropagationsRef.current = [];
                          }}
                          promotionMV={promotionMV} />
                      </motion.div>
                    )}
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Info overlay for swipe mode (all screen sizes) */}
          <FilmInfoOverlay
            film={infoFilm}
            onClose={() => setInfoFilm(null)}
            onLike={!allDone ? () => {
              handleSwipe(true);
              const next = queue[currentIndex + 1] ?? null;
              setInfoFilm(next);
            } : undefined}
            onDislike={!allDone ? () => {
              handleSwipe(false);
              const next = queue[currentIndex + 1] ?? null;
              setInfoFilm(next);
            } : undefined}
            sessionServices={session?.streaming_services ?? []}
          />
        </>
      )}

      {/* Character source film — read-only, no like/dislike */}
      <FilmInfoOverlay
        film={charInfoFilm}
        onClose={() => setCharInfoFilm(null)}
        sessionServices={[]}
      />

      <div className="h-24 shrink-0" />
    </div>

    {/* ShortlistOverlay during swipe phase — the version in the matchList block only
        renders on the tie/match screen. This one covers the active swiping phase so
        the host can trigger a vote before any unanimous match has occurred. */}
    {showShortlist && session && shortlistData && matchList.length === 0 && (
      participants.length === 1 ? (
        <SinglePlayerVoteOverlay
          films={shortlistData.films}
          sessionId={session.id}
          sessionServices={session.streaming_services ?? []}
          region={session.region ?? "AU"}
          onComplete={async (winnerId) => {
            await resolveMatch(session.id, winnerId);
            const allMatches = await getMatches(session.id);
            if (allMatches.length > 0) setMatchList(allMatches);
            setShowShortlist(false);
          }}
        />
      ) : (
        <ShortlistOverlay
          films={shortlistData.films}
          pinnedFilmIds={shortlistData.pinnedFilmIds}
          sessionId={session.id}
          participantId={participant?.id ?? ""}
          isHost={isHost}
          totalParticipants={participants.length}
          sessionServices={session.streaming_services ?? []}
          region={session.region ?? "AU"}
          onComplete={async (winnerId) => {
            if (isHost) {
              await resolveMatch(session.id, winnerId);
              const allMatches = await getMatches(session.id);
              if (allMatches.length > 0) setMatchList(allMatches);
            }
            setShowShortlist(false);
          }}
        />
      )
    )}

    {/* ── Late-joiner hints modal ───────────────────────────────────────── */}
    {showLateModal && (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-4"
        style={{ background: "rgba(12,12,14,0.75)", backdropFilter: "blur(4px)" }}>
        <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-5"
          style={{ background: "var(--surface)" }}>
          <div className="flex items-center justify-center gap-2">
            <Logo size="sm" showText={false} />
            <p className="text-lg font-light tracking-[0.15em] uppercase leading-tight" style={{ color: "var(--text)" }}>Filmclub</p>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}>How to</p>
            {[
              { icon: <Search size={16} />, text: "Search to add films to the pool" },
              { icon: <Trophy size={16} />, text: "See everyone's results as you go" },
              { icon: <Clock size={16} />, text: "Press and hold any film for more info" },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <span className="shrink-0" style={{ color: "var(--accent)" }}>{icon}</span>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{text}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}>How it&apos;s decided</p>
            <div className="flex items-center gap-3">
              <span className="shrink-0" style={{ color: "var(--accent)" }}><Zap size={16} /></span>
              <span className="text-xs font-medium" style={{ color: "var(--text)" }}>Everyone swipes right → instant match</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-center text-[10px] font-bold" style={{ color: "var(--accent)" }}>OR</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="shrink-0" style={{ color: "var(--accent)" }}><Crown size={16} /></span>
              <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                {participants[0]?.name ?? "Host"} can call a shortlist vote at any time
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              sessionStorage.setItem(`filmclub-hints-${code}`, "1");
              setShowLateModal(false);
            }}
            className="w-full py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e" }}>
            Got it
          </button>
        </div>
      </div>
    )}

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
    </div>
  );
}



function AllDoneScreen({ mode, watchMode, neverHadFilms, onResults, onSearch, onBrowseMore }: {
  mode: string;
  watchMode: string;
  neverHadFilms: boolean;
  onResults: () => void;
  onSearch: () => void;
  onBrowseMore: () => void;
}) {
  const isCinemaOnly = watchMode === "cinema";
  const noSessionsToday = isCinemaOnly && neverHadFilms;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
      <div className="mb-5">
        {noSessionsToday ? (
          <span className="text-4xl">🎭</span>
        ) : (
          <svg width="56" height="56" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="14" width="40" height="26" rx="3" fill="#1c1c20" stroke="#e8b86d" strokeWidth="1.5" />
            <rect x="14" y="8" width="16" height="7" rx="2" fill="#1c1c20" stroke="#e8b86d" strokeWidth="1.5" />
            <circle cx="22" cy="27" r="9" fill="#0c0c0e" stroke="#e8b86d" strokeWidth="1.5" />
            <circle cx="22" cy="27" r="5.5" fill="#141416" stroke="#e8b86d" strokeWidth="1" />
            <circle cx="20" cy="25" r="1.5" fill="#e8b86d" opacity="0.4" />
            <line x1="34" y1="18" x2="34" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />
            <line x1="37" y1="18" x2="37" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />
            <line x1="40" y1="18" x2="40" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />
            <circle cx="38" cy="12" r="3" fill="#e8b86d" opacity="0.8" />
            <path d="M4 38 Q8 44 14 42 Q18 40 22 43 Q26 46 30 42 Q36 38 44 40"
              stroke="#e8b86d" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.55" />
          </svg>
        )}
      </div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text)" }}>
        {noSessionsToday ? "Nothing on tonight" : "You're all caught up"}
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {noSessionsToday
          ? "No sessions found at Dendy Newtown for today's time window. Try again later or switch to a streaming session."
          : "Waiting for the rest of the group."}
      </p>
      {!noSessionsToday && (
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button onClick={onSearch} className="w-full px-6 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--surface)", color: "var(--text)" }}>
            Search
          </button>
          <button onClick={onBrowseMore} className="w-full px-6 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--surface)", color: "var(--text)" }}>
            Browse more
          </button>
          <button onClick={onResults} className="w-full px-6 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e" }}>
            Results
          </button>
        </div>
      )}
    </div>
  );
}

function MatchScreen({ matches, session, isHost, onRandomise, onShortlist }: {
  matches: Match[];
  session: Session;
  isHost: boolean;
  onRandomise?: (winnerFilmId: string) => void;
  onShortlist?: () => void;
}) {
  const router = useRouter();
  if (matches.length === 0 || !matches[0]?.film) return null;
  const isTied = matches.length > 1;

  // Single match — use the shared winner screen
  if (!isTied) {
    return (
      <FilmWinnerScreen
        film={matches[0].film!}
        sessionServices={session.streaming_services ?? []}
        region={session.region ?? "AU"}
      />
    );
  }

  // Tied — show all tied films with host actions
  const cardWidthClass = matches.length === 2 ? "w-36" : "w-28";

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Blurred backdrop from first film */}
      <div className="fixed inset-0 opacity-10 pointer-events-none overflow-hidden">
        <img src={posterUrl(matches[0].film!.poster_path, "w500")} alt=""
          className="w-full h-full object-cover" style={{ filter: "blur(20px)" }} />
      </div>

      <div className="relative z-10 flex flex-col items-center px-5 pt-12 pb-32 flex-1 overflow-y-auto">
        <div className="mb-3"><Logo size="sm" /></div>
        <h1 className="text-xl font-medium mb-1" style={{ color: "var(--accent)" }}>It's a tie!</h1>
        <p className="text-xs mb-8 text-center" style={{ color: "var(--text-muted)" }}>
          {matches.length} films everyone agreed on
        </p>

        <div className={`flex gap-3 justify-center ${matches.length >= 3 ? "flex-wrap" : ""}`}>
          {matches.map((m) => {
            if (!m.film) return null;
            const providers = (m.film.watch_providers_au ?? []) as { serviceId: string; logoPath?: string | null }[];
            const sessionServices = session.streaming_services ?? [];
            const available = providers.filter((p) => sessionServices.includes(p.serviceId));
            return (
              <div key={m.id} className={`${cardWidthClass} flex flex-col gap-2`}>
                <div className="relative rounded-2xl overflow-hidden shadow-2xl" style={{ aspectRatio: "2/3" }}>
                  <img src={posterUrl(m.film.poster_path, "w342")} alt={m.film.title}
                    className="w-full h-full object-cover" />
                  <div className="absolute inset-0"
                    style={{ background: "linear-gradient(to top, rgba(12,12,14,0.85) 0%, transparent 50%)" }} />
                  {available.length > 0 && (
                    <div className="absolute bottom-2 left-2 flex gap-1 flex-wrap">
                      {available.slice(0, 3).map((p) => {
                        const svc = getService(p.serviceId, session.region ?? "AU");
                        if (!svc) return null;
                        const logo = p.logoPath ?? (svc as typeof svc & { tmdbLogoPath?: string | null }).tmdbLogoPath;
                        return logo ? (
                          <img key={p.serviceId} src={`https://image.tmdb.org/t/p/w45${logo}`}
                            alt={svc.name} title={svc.name} className="w-5 h-5 rounded object-cover" />
                        ) : (
                          <span key={p.serviceId} className="text-[9px] px-1 py-0.5 rounded font-bold"
                            style={{ background: svc.color, color: "#fff" }}>{svc.abbrev}</span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text)" }}>{m.film.title}</p>
                  {m.film.release_year && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{m.film.release_year}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20 px-5 pb-6 pt-3"
        style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
        <div className="mx-auto flex gap-3" style={{ maxWidth: 480 }}>
          {isHost && onShortlist && (
            <button onClick={onShortlist} className="flex-1 py-3 rounded-xl text-sm font-semibold border"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
              Shortlist Vote
            </button>
          )}
          {isHost && onRandomise && (
            <button onClick={() => {
              const winner = matches[Math.floor(Math.random() * matches.length)];
              onRandomise(winner.film_id);
            }} className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: "var(--accent)", color: "#0c0c0e" }}>
              Randomise
            </button>
          )}
          {!isHost && (
            <p className="flex-1 text-xs text-center py-3" style={{ color: "var(--text-muted)" }}>
              Waiting for the host to decide…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

