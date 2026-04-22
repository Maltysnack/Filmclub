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
import DendyLogo from "@/components/DendyLogo";
import {
  getSession, getParticipantId, getIsHost, getParticipants, getSessionFilmsWithMeta,
  getMySwipes, getMyLikes, recordSwipe, checkForMatch, checkAllMatches, getMatches,
  closeSession, startSession, resolveMatch, addFilmToSession, getSessionSwipeStats,
  removeParticipant, getShortlistData,
} from "@/lib/session";
import { posterUrl, getFilmDetail, fetchCollectionTmdbIds } from "@/lib/tmdb";
import { getDendySessions, DendyFilm } from "@/lib/dendy";
import { getService } from "@/lib/streaming";
import { seedHomePool, seedMoreHomePool, sessionProviderTmdbIds, ENGLISH_PRIMARY_REGIONS, FOREIGN_LANG_CAP } from "@/lib/pool";
import MailButton from "@/components/MailButton";
import { getCurrentRound } from "@/lib/shortlist";
import { supabase } from "@/lib/supabase";
import { participantColor } from "@/lib/names";
import { Film, Session, Participant, Match } from "@/types";
import { Search, Trophy, Play, Copy, Check, Clock, Zap, Crown, Layers } from "lucide-react";
import SpinWheel from "@/components/SpinWheel";
import ShortlistOverlay from "@/components/ShortlistOverlay";
import SinglePlayerVoteOverlay from "@/components/SinglePlayerVoteOverlay";
import FilmWinnerScreen from "@/components/FilmWinnerScreen";


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

// Returns the first index >= fromIdx that is not suppressed by a franchise block.
// A film is suppressed if: it has a collection_id, that ID is blocked, and nobody
// has liked it yet (filmLikes has no entries for it).
function skipBlocked(
  fromIdx: number,
  queue: import("@/types").Film[],
  blocked: Set<number>,
  filmLikes: Map<string, string[]>,
): number {
  let idx = fromIdx;
  while (idx < queue.length) {
    const cid = queue[idx].collection_id;
    if (!cid || !blocked.has(cid)) break;                      // not blocked
    if ((filmLikes.get(queue[idx].id)?.length ?? 0) > 0) break; // someone liked it
    idx++;
  }
  return idx;
}

export default function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  // Synchronous check on mount — prevents lobby flash for users returning from search/results
  // (they have a snapshot), while new joiners (no snapshot) correctly see the lobby.
  const hasSnapshot = useRef(!!sessionStorage.getItem(`filmclub-queue-${code}`));

  const [session, setSession] = useState<Session | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
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
  // Computed synchronously — avoids the flash where host briefly sees "Waiting..." before init
  const isHost = getIsHost(code);
  const [fullQueue, setFullQueue] = useState<Film[]>([]);   // all films before genre filter
  const [showShortlist, setShowShortlist] = useState(false);
  const [shortlistData, setShortlistData] = useState<{ films: import("@/types").Film[]; pinnedFilmIds: string[] } | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [matchList, setMatchList] = useState<Match[]>([]);
  // Wheel state — lifted here so SpinWheel can overlay MatchScreen without flash
  const [wheelFilms, setWheelFilms] = useState<Match[] | null>(null);
  const [wheelWinnerId, setWheelWinnerId] = useState<string | null>(null);
  const wheelChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  // Map from film.id -> dendy session info
  const [dendyMap, setDendyMap] = useState<Map<string, DendyFilm>>(new Map());
  // Debounce timer so background batch-inserts don't hammer loadFilms
  const queueRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so handleSwipe always sees the latest session without stale closure
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
  // Ref so shortlist subscription sees latest matchList without stale closure
  const matchListRef = useRef<Match[]>([]);
  useEffect(() => { matchListRef.current = matchList; }, [matchList]);
  // Ref so loadFilms (useCallback with [] deps) always sees the latest index
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  // Ref to track whether the user currently has a finger on the card mid-drag.
  // Like propagation (queue reorder) is deferred while a swipe is in progress
  // to prevent the card being yanked out from under the user's finger (Bug #4).
  const swipeInProgress = useRef(false);
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

  // SCROLL_HIDDEN: scroll mode deprecated — swipe is always active.
  // ScrollView code preserved below in case scroll mode is re-enabled later.
  const viewMode = "swipe" as "swipe" | "scroll";
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function toggleViewMode() { /* SCROLL_HIDDEN */ }

  // Liked film IDs for scroll mode (starts empty, populated from swipe history + new likes)
  const [likedInScroll, setLikedInScroll] = useState<Set<string>>(new Set());

  const queue = fullQueue;

  // loadFilms fetches Dendy sessions itself and keeps the result as a local variable.
  // This avoids the stale-closure bug where useCallback captures the initial empty dendyMap
  // state and never sees updates from setDendyMap.
  const loadFilms = useCallback(async (s: Session, participantId: string, isInitial = false) => {
    let poolWithMeta = await getSessionFilmsWithMeta(s.id);

    // ── Fetch Dendy sessions early so we have the map locally ─────────────────
    // dendyTmdbMap is keyed by String(tmdbId) and lives only in this call's scope.
    const dendyTmdbMap = new Map<string, DendyFilm>();
    if (s.watch_mode !== "home" && s.cinema_date) {
      const dendySessions = await getDendySessions(
        s.cinema_date,
        s.cinema_time_from ?? undefined,
        s.cinema_time_to ?? undefined
      );
      for (const df of dendySessions) {
        if (df.tmdbId) dendyTmdbMap.set(String(df.tmdbId), df);
      }
    }

    // ── Seed pool if empty ────────────────────────────────────────────────────
    // Use === 0 so that background-loaded batches don't re-trigger seeding.
    if (poolWithMeta.length === 0) {
      if (s.watch_mode === "cinema" || s.watch_mode === "both") {
        // Add every Dendy film we already fetched
        await Promise.all(
          [...dendyTmdbMap.values()].map((df) =>
            df.tmdbId ? addFilmToSession(s.id, df.tmdbId, null) : Promise.resolve(false)
          )
        );
      }
      if (s.watch_mode === "home" || s.watch_mode === "both") {
        await seedHomePool(s);
      }
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
    // Since we now seed from TMDB Discover (provider-filtered), films in the pool
    // should already match. This filter is the final safety net for AU sessions —
    // watch_providers_au contains AU provider data so the filter is only reliable there.
    // For non-AU sessions we trust the Discover seed and skip this filter.
    let filteredAuto = autoSeeded;
    if (
      (s.region ?? "AU") === "AU" &&
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

    // ── Resolve tmdbId-keyed map → DB film.id-keyed map ──────────────────────
    if (s.watch_mode !== "home") {
      const newMap = new Map<string, DendyFilm>();
      for (const { film } of poolWithMeta) {
        const df = dendyTmdbMap.get(String(film.tmdb_id));
        if (df) newMap.set(film.id, df);
      }
      setDendyMap(newMap);
    }

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
        initialAuto = autoFilms.slice(slotStart, slotStart + autoSlice);
        // Reserve = everything after this slot, shuffled so each participant drips in a different order.
        reserveQueueRef.current = seededShuffle(autoFilms.slice(slotStart + INITIAL_SLICE), seed);
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

      setFullQueue(initialQueue);
      setCurrentIndex(0);
      setAllDone(initialQueue.length === 0);
    } else {
      // Background update: new user-added films surface near top of active queue;
      // new auto-seeded films go into the reserve to be dripped in gradually.
      const ci = currentIndexRef.current;

      setFullQueue((prev) => {
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
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");

      setSession(s);

      if (s.status === "closed") {
        const existing = await getMatches(s.id);
        if (existing.length > 0) { setMatchList(existing); setLoading(false); return; }
        else { router.push("/"); return; }
      }

      const allParticipants = await getParticipants(s.id);
      participantsRef.current = allParticipants; // set before loadFilms so slot calc sees correct list
      setParticipant(allParticipants.find((p) => p.id === pid) ?? null);
      setParticipants(allParticipants);

      // ── Snapshot restore: instant return from + / results pages ───────────
      const savedQueue = sessionStorage.getItem(`filmclub-queue-${code}`);
      const savedIndex = sessionStorage.getItem(`filmclub-index-${code}`);
      if (savedQueue && savedIndex) {
        setFullQueue(JSON.parse(savedQueue) as Film[]);
        setCurrentIndex(parseInt(savedIndex, 10));
        // Restore phase-scoring state in parallel with silent background refresh
        const stats = await getSessionSwipeStats(s.id);
        setGroupSwipeCount(stats.totalSwipes);
        setGroupLikeCount(stats.totalLikes);
        setFilmLikes(stats.filmLikes);
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
          setSession(updated);
          if (updated.status === "closed") {
            const existing = await getMatches(session.id);
            if (existing.length > 0) setMatchList(existing);
            else router.push("/");
          } else if (updated.tiebreaker_film_ids?.length && participant) {
            // Tiebreaker started — reload queue with only tied films
            setMatchList([]);
            setAllDone(false);
            setCurrentIndex(0);
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
            // Update per-film like map
            setFilmLikes((prev) => {
              const next = new Map(prev);
              const ids = next.get(newSwipe.film_id) ?? [];
              next.set(newSwipe.film_id, [...ids, newSwipe.participant_id]);
              return next;
            });

            // Like propagation: someone else liked a film — surface it near top of our unseen queue.
            // Skip the reorder if the user has a finger on the card mid-drag (Bug #4 fix).
            if (newSwipe.participant_id !== participantRef.current?.id && !swipeInProgress.current) {
              const ci = currentIndexRef.current;
              setFullQueue((prev) => {
                const filmIdx = prev.findIndex((f) => f.id === newSwipe.film_id);
                // Not in queue, or already seen/currently showing — leave as is
                if (filmIdx === -1 || filmIdx <= ci) return prev;
                // Aim for position ci+1 to ci+3 (right behind current card)
                const targetPos = Math.min(ci + 1 + Math.floor(Math.random() * 3), prev.length - 1);
                if (filmIdx <= targetPos) return prev; // already near top
                const next = [...prev];
                const [film] = next.splice(filmIdx, 1);
                next.splice(targetPos, 0, film);
                return next;
              });
            }
          }

          // Existing match check
          const s = await getSession(code);
          if (s?.started && s?.mode === "live" && s.status === "closed") {
            const existing = await getMatches(session.id);
            if (existing.length > 0) setMatchList(existing);
          }
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "session_films", filter: `session_id=eq.${session.id}` },
        () => {
          // Debounce: wait 800 ms after the last insert in a batch before refreshing.
          if (queueRefreshTimer.current) clearTimeout(queueRefreshTimer.current);
          queueRefreshTimer.current = setTimeout(async () => {
            if (!participant || !session) return;
            await loadFilms(session, participant.id);
          }, 800);
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "participants", filter: `session_id=eq.${session.id}` },
        async () => { setParticipants(await getParticipants(session.id)); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, participant, loadFilms, code]);

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

  async function handleSwipe(liked: boolean) {
    if (!session || !participant || currentIndex >= queue.length) return;
    const s = sessionRef.current ?? session; // always fresh — avoids stale closure
    const film = queue[currentIndex];
    const isSolo = participants.length <= 1;

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

    // ── Drip (synchronous) ────────────────────────────────────────────────────
    swipeCountRef.current += 1;
    if (swipeCountRef.current % 20 === 0 && reserveQueueRef.current.length > 0) {
      const drip = reserveQueueRef.current.slice(0, 20);
      reserveQueueRef.current = reserveQueueRef.current.slice(20);
      console.log(`[drip] swipe ${swipeCountRef.current} — spliced ${drip.length} films into queue, reserve remaining: ${reserveQueueRef.current.length}`);
      workingQueue = [...workingQueue, ...drip];
      const ci = currentIndex;
      setFullQueue((prev) => {
        const seen = prev.slice(0, ci + 1);
        const unseen = [...prev.slice(ci + 1)];
        for (const f of drip) {
          const pos = unseen.length <= 1 ? unseen.length : 1 + Math.floor(Math.random() * Math.min(unseen.length, 15));
          unseen.splice(pos, 0, f);
        }
        return [...seen, ...unseen];
      });
    }

    // ── Advance index immediately — don't wait for DB ─────────────────────────
    // The card has already animated off-screen in SwipeCard before onLike/onDislike
    // fires, so advancing here makes the next card appear with zero perceptible delay.
    const nextIdx = skipBlocked(currentIndex + 1, workingQueue, newBlocked, filmLikes);
    if (nextIdx < workingQueue.length) {
      setCurrentIndex(nextIdx);
      if (infoFilm) setInfoFilm(workingQueue[nextIdx]);
    }

    // ── DB write — fire and forget ────────────────────────────────────────────
    void recordSwipe(s.id, participant.id, film.id, liked);

    // ── Async: on-demand franchise fetch for unknown collection_id ────────────
    // Runs after index has advanced so the user never waits for this fetch.
    if (!liked && cid === null) {
      const detail = await getFilmDetail(film.tmdb_id);
      const detailCid = detail?.belongs_to_collection?.id ?? 0;
      if (detailCid) {
        const colMemberIds = await fetchCollectionTmdbIds(detailCid);
        const enriched = fullQueue.map((f) =>
          f.id === film.id || (colMemberIds.has(f.tmdb_id) && f.collection_id == null)
            ? { ...f, collection_id: detailCid }
            : f
        );
        setFullQueue(enriched);
        setBlockedCollections(new Set([...blockedCollections, detailCid]));
      } else {
        setFullQueue((prev) =>
          prev.map((f) => f.id === film.id ? { ...f, collection_id: 0 } : f)
        );
      }
    }

    // ── Async: match check ────────────────────────────────────────────────────
    if (liked && s.started && !isSolo) {
      const isMatch = await checkForMatch(s.id, film.id, s.threshold);
      if (isMatch && s.mode === "live") {
        await closeSession(s.id);
        await new Promise((r) => setTimeout(r, 300));
        const allMatches = await getMatches(s.id);
        if (allMatches.length > 0) { setMatchList(allMatches); return; }
      }
    }

    // ── End-of-deck handling ──────────────────────────────────────────────────
    if (nextIdx >= workingQueue.length) {
      // Layer 1: drain remaining reserve
      if (reserveQueueRef.current.length > 0) {
        const refill = reserveQueueRef.current.slice(0, 20);
        reserveQueueRef.current = reserveQueueRef.current.slice(20);
        setFullQueue((prev) => [...prev, ...refill]);
        setCurrentIndex(workingQueue.length);
        if (infoFilm) setInfoFilm(refill[0]);
        return;
      }

      // Layer 2: second chance — films others liked that you said no to
      const secondChance = allSessionFilmsRef.current
        .filter((f) => {
          const likers = filmLikes.get(f.id) ?? [];
          return likers.length > 0 && mySwipeHistoryRef.current.get(f.id) === false;
        })
        .sort((a, b) => (filmLikes.get(b.id)?.length ?? 0) - (filmLikes.get(a.id)?.length ?? 0));

      if (secondChance.length > 0) {
        setFullQueue((prev) => [...prev, ...secondChance]);
        setCurrentIndex(workingQueue.length);
        if (infoFilm) setInfoFilm(secondChance[0]);
        return;
      }

      // Layer 3: fetch a fresh batch from TMDB (fire-and-forget)
      if (s.watch_mode === "home" || s.watch_mode === "both") seedMoreHomePool(s);

      // Final batch match check — catches the case where this was the last voter
      if (s.started && s.mode === "live" && !isSolo) {
        let found = false;
        for (const f of workingQueue) {
          if (await checkForMatch(s.id, f.id, s.threshold)) found = true;
        }
        if (found) {
          await closeSession(s.id);
          await new Promise((r) => setTimeout(r, 300));
          const allMatches = await getMatches(s.id);
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
    await startSession(session.id);
    // Update local state immediately so handleSwipe checks fire correctly
    setSession((s) => s ? { ...s, started: true } : s);

    if (session.mode === "live" && participants.length > 1) {
      const matched = await checkAllMatches(session.id, session.threshold);
      if (matched.length > 0) {
        await closeSession(session.id);
        await new Promise((r) => setTimeout(r, 300));
        const allMatches = await getMatches(session.id);
        if (allMatches.length > 0) { setMatchList(allMatches); setStarting(false); return; }
      }
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
    return (
      <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
        <MailButton />
        <div className="flex flex-col flex-1 mx-auto w-full px-5 py-10" style={{ maxWidth: 480 }}>

          {/* Logo — slides up from centre on mount */}
          <motion.div
            className="flex justify-center mb-10"
            initial={{ y: 160, opacity: 0 }}
            animate={{ y: [160, 160, 0], opacity: [0, 1, 1] }}
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
            <button
              onClick={handleShare}
              className="inline-flex items-center gap-3 px-6 py-4 rounded-2xl transition-all"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <span className="font-mono font-bold text-3xl tracking-widest" style={{ color: "var(--accent)" }}>
                {code}
              </span>
              {copied
                ? <Check size={18} style={{ color: "var(--like)" }} />
                : <Copy size={18} style={{ color: "var(--text-muted)" }} />}
            </button>
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
                disabled={starting || loading}
                className="w-full py-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: "var(--like)",
                  color: "#0c0c0e",
                  opacity: (starting || loading) ? 0.55 : 1,
                }}>
                <Play size={14} fill="currentColor" />
                {starting ? "Starting…" : loading ? "Loading films…" : `Start · ${participants.length} ${participants.length === 1 ? "person" : "people"}`}
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

  if (matchList.length > 0) {
    return (
      <div style={{ background: "var(--bg)" }}>
        <div className="mx-auto" style={{ maxWidth: 480 }}>
          <MatchScreen
            matches={matchList}
            session={session!}
            dendyMap={dendyMap}
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
  const nextFilm = queue[skipBlocked(currentIndex + 1, queue, blockedCollections, filmLikes)];

  // Preload backdrops for the next 6 films from the current position in either mode.
  // Swipe mode uses currentIndex; scroll mode uses scrollIndexRef.
  // 6 films ≈ ~1MB of background requests — enough buffer without being wasteful.
  const preloadStart = viewMode === "scroll" ? scrollIndexRef.current : currentIndex;
  const preloadBackdrops = queue
    .slice(preloadStart, preloadStart + 6)
    .map((f) => f.backdrop_path ? posterUrl(f.backdrop_path, "w1280") : null)
    .filter(Boolean) as string[];

  return (
    <div className="h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
    {/* Hidden preload images — browser fetches backdrop silently while user views card */}
    {preloadBackdrops.map((url) => (
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
        {isHost && session?.status !== "closed" && !allDone && filmLikes.size > 0 && (
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
        {participants.map((p) => {
          const isMe = p.id === participant?.id;
          const color = participantColor(p.name);
          return (
            <span key={p.id}
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
              {p.name}{isMe ? " (you)" : ""}
            </span>
          );
        })}
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
                  dendyMap={dendyMap}
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
            dendyInfo={infoFilm ? dendyMap.get(infoFilm.id) : undefined}
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
                        dendyInfo={dendyMap.get(nextFilm.id)}
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
                          dendyInfo={dendyMap.get(currentFilm.id)}
                          sessionServices={session?.streaming_services ?? []}
                          votePhase={votePhase}
                          voteInfo={{
                            count: (filmLikes.get(currentFilm.id) ?? []).filter(id => id !== participant?.id).length,
                            participantIds: (filmLikes.get(currentFilm.id) ?? []).filter(id => id !== participant?.id),
                          }}
                          participants={participants}
                          onDragStart={() => { swipeInProgress.current = true; }}
                          onDragEnd={() => { swipeInProgress.current = false; }}
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
            dendyInfo={infoFilm ? dendyMap.get(infoFilm.id) : undefined}
            sessionServices={session?.streaming_services ?? []}
          />
        </>
      )}


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

function MatchScreen({ matches, session, dendyMap, isHost, onRandomise, onShortlist }: {
  matches: Match[];
  session: Session;
  dendyMap: Map<string, DendyFilm>;
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

function WatchOptions({ film, dendy, session, compact = false }: {
  film: Film;
  dendy?: DendyFilm;
  session: Session;
  compact?: boolean;
}) {
  type Provider = { serviceId: string; logoPath?: string | null };
  const providers: Provider[] = (film.watch_providers_au ?? []) as Provider[];
  const sessionServices = session.streaming_services ?? [];
  const availableProviders = providers.filter((p) => sessionServices.includes(p.serviceId));

  if (!dendy && !availableProviders.length) return null;

  function ServiceLogo({ p }: { p: Provider }) {
    const svc = getService(p.serviceId, session.region ?? "AU");
    if (!svc) return null;
    const logo = p.logoPath ?? (svc as typeof svc & { tmdbLogoPath?: string | null }).tmdbLogoPath;
    return logo ? (
      <img src={`https://image.tmdb.org/t/p/w45${logo}`} alt={svc.name} title={svc.name}
        className="w-7 h-7 rounded object-cover" />
    ) : (
      <span className="text-xs px-1.5 py-0.5 rounded font-bold"
        style={{ background: `${svc.color}22`, color: svc.color, border: `1px solid ${svc.color}44` }}>
        {svc.abbrev}
      </span>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {dendy && (
          <span className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: "rgba(232,184,109,0.15)", color: "var(--accent)" }}>
            🎬 Dendy
          </span>
        )}
        {availableProviders.slice(0, 3).map((p) => <ServiceLogo key={p.serviceId} p={p} />)}
      </div>
    );
  }

  return (
    <div className="w-full mb-4">
      {dendy && (
        <div className="p-3 rounded-xl mb-2" style={{ background: "rgba(232,184,109,0.08)", border: "1px solid rgba(232,184,109,0.2)" }}>
          <div className="mb-1.5"><DendyLogo height={13} /></div>
          <div className="flex flex-wrap gap-1.5">
            {dendy.sessionTimes.map((t) => (
              <a key={t} href={dendy.bookingUrls[t] ?? "#"} target="_blank" rel="noopener noreferrer"
                className="text-xs px-2.5 py-1 rounded-lg font-medium"
                style={{ background: "var(--accent)", color: "#0c0c0e" }}>
                {t}
              </a>
            ))}
          </div>
          {dendy.tmdbMatch === "low" && (
            <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
              ⚠️ Title match may not be exact
            </p>
          )}
        </div>
      )}
      {availableProviders.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Available on</p>
          {availableProviders.map((p) => <ServiceLogo key={p.serviceId} p={p} />)}
        </div>
      )}
    </div>
  );
}
