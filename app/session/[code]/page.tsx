"use client";

import { useEffect, useState, useCallback, useRef, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
import { getTrendingFilms, getTopRatedFilms, discoverFilmsByProviders, getProviderList, posterUrl, getFilmDetail, tmdbToFilm } from "@/lib/tmdb";
import { CHARACTER_FILMS } from "@/lib/characters";
import { getDendySessions, DendyFilm } from "@/lib/dendy";
import { getService, getServicesForRegion, TMDB_GENRES } from "@/lib/streaming";
import { getCurrentRound } from "@/lib/shortlist";
import { supabase } from "@/lib/supabase";
import { participantColor } from "@/lib/names";
import { Film, Session, Participant, Match } from "@/types";
import { Plus, Users, Trophy, CheckCircle, Play, SlidersHorizontal, X, Heart, Layers, List, Clock } from "lucide-react";
import SpinWheel from "@/components/SpinWheel";
import ShortlistOverlay from "@/components/ShortlistOverlay";
import FilmWinnerScreen from "@/components/FilmWinnerScreen";

const LOAD_MESSAGE = "Arguing with the studio execs…";

export default function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [isHost, setIsHostState] = useState(false);
  const [fullQueue, setFullQueue] = useState<Film[]>([]);   // all films before genre filter
  const [showShortlist, setShowShortlist] = useState(false);
  const [shortlistData, setShortlistData] = useState<{ films: import("@/types").Film[]; pinnedFilmIds: string[] } | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [characterFilm, setCharacterFilm] = useState<Film | null>(null);
  const [characterFilmLoading, setCharacterFilmLoading] = useState(false);
  const [matchList, setMatchList] = useState<Match[]>([]);
  // Wheel state — lifted here so SpinWheel can overlay MatchScreen without flash
  const [wheelFilms, setWheelFilms] = useState<Match[] | null>(null);
  const [wheelWinnerId, setWheelWinnerId] = useState<string | null>(null);
  const wheelChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [minLoadDone, setMinLoadDone] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showGenreFilter, setShowGenreFilter] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
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

  // ── Persist queue + index to sessionStorage so returning from + / results is instant ──
  useEffect(() => {
    if (fullQueue.length > 0 && !loading) {
      sessionStorage.setItem(`filmclub-queue-${code}`, JSON.stringify(fullQueue));
    }
  }, [fullQueue, loading, code]);
  useEffect(() => {
    if (!loading) {
      sessionStorage.setItem(`filmclub-index-${code}`, String(currentIndex));
    }
  }, [currentIndex, loading, code]);

  // ── Minimum loading screen (3s) — only on genuine first visit ─────────────
  useEffect(() => {
    const timer = setTimeout(() => setMinLoadDone(true), 3000);
    return () => clearTimeout(timer);
  }, []);

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

  // Derived: genre-filtered queue (user-added films always shown)
  const [userAddedIds, setUserAddedIds] = useState<Set<string>>(new Set());
  const queue = selectedGenres.length === 0
    ? fullQueue
    : fullQueue.filter((f) =>
        userAddedIds.has(f.id) ||
        (f.genres ?? []).some((g) => selectedGenres.includes(g.id))
      );

  function toggleGenre(id: number) {
    setSelectedGenres((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

  // Fast initial seed — just enough to show the first card immediately.
  // Resolve session streaming_services (service IDs like "netflix") → TMDB provider IDs
  function sessionProviderTmdbIds(s: Session): number[] {
    const services = getServicesForRegion(s.region ?? "AU");
    return (s.streaming_services ?? [])
      .flatMap((sid) => {
        const tmdbId = services.find((svc) => svc.id === sid)?.tmdbId;
        return tmdbId != null ? [tmdbId] : [];
      });
  }

  // session_films upsert is idempotent so re-adding later is safe.
  async function seedHomePool(s: Session) {
    const region = s.region ?? "AU";
    const providerIds = sessionProviderTmdbIds(s);
    console.log("[seed] region:", region, "services:", s.streaming_services, "→ providerIds:", providerIds);
    // DEV: log the real TMDB provider list once to verify IDs
    if (process.env.NODE_ENV === "development") {
      getProviderList(region).then((list) => {
        const relevant = list.filter((p) =>
          /stan|binge|netflix|prime|disney|apple|paramount|foxtel|hulu|peacock|max|now|britbox|itvx|bbc/i.test(p.provider_name)
        );
        console.log(`[TMDB ${region} providers]`, relevant.map(p => `${p.provider_name} (${p.provider_id})`));
      });
    }
    // When streaming services are selected, seed from TMDB Discover so only
    // films actually available on those services are added.
    // Fall back to trending when no services are specified.
    const films = providerIds.length > 0
      ? await discoverFilmsByProviders(providerIds, 1, region)
      : await getTrendingFilms(1);
    console.log("[seed] discover returned", films.length, "films, titles:", films.slice(0, 3).map(f => f.title));
    const seen = new Set<number>();
    const initial = films.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).slice(0, 10);
    await Promise.all(initial.map((m) => addFilmToSession(s.id, m.id, null)));
  }

  // Background expander — runs silently after the session page is shown.
  // Adds ~80 more films in batches of 8; the real-time subscription
  // picks up each batch and extends the live queue automatically.
  async function seedMoreHomePool(s: Session) {
    const region = s.region ?? "AU";
    const providerIds = sessionProviderTmdbIds(s);
    const raw = providerIds.length > 0
      ? await discoverFilmsByProviders(providerIds, 4, region)
      : await Promise.all([getTrendingFilms(3), getTopRatedFilms(2)]).then(([a, b]) => [...a, ...b]);
    const seen = new Set<number>();
    const deduped = raw.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).slice(0, 80);

    const BATCH = 8;
    for (let i = 0; i < deduped.length; i += BATCH) {
      await Promise.all(deduped.slice(i, i + BATCH).map((m) => addFilmToSession(s.id, m.id, null)));
      if (i + BATCH < deduped.length) await new Promise((r) => setTimeout(r, 400));
    }
  }

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

    const [mySwiped, myLikes] = await Promise.all([
      getMySwipes(s.id, participantId),
      getMyLikes(s.id, participantId),
    ]);
    setLikedInScroll(myLikes);
    const unswiped = poolWithMeta.filter(({ film }) => !mySwiped.has(film.id));

    const userAdded = unswiped.filter(({ addedBy }) => addedBy && addedBy !== participantId);
    const autoSeeded = unswiped.filter(({ addedBy }) => !addedBy || addedBy === participantId);
    setUserAddedIds(new Set(userAdded.map(({ film }) => film.id)));

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
    shuffle(filteredAuto);

    const insertAt = Math.max(3, Math.floor(filteredAuto.length * 0.3));
    const ordered = [
      ...filteredAuto.slice(0, insertAt).map(({ film }) => film),
      ...userAdded.map(({ film }) => film),
      ...filteredAuto.slice(insertAt).map(({ film }) => film),
    ];

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
    // isInitial=true  → first load: replace queue entirely and reset position.
    // isInitial=false → background update: splice new films into the unseen
    //   portion of the queue so the user's position is preserved but films
    //   arrive in a natural mixed order rather than service-grouped at the tail.
    if (isInitial) {
      setFullQueue(ordered);
      setCurrentIndex(0);
      setAllDone(ordered.length === 0);
    } else {
      // Capture the index outside the functional update (refs are always current)
      const ci = currentIndexRef.current;
      const userAddedFilmIds = new Set(userAdded.map(({ film }) => film.id));

      setFullQueue((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const fresh = ordered.filter((f) => !existingIds.has(f.id));
        if (fresh.length === 0) return prev;

        setAllDone(false);

        const freshUserAdded = fresh.filter((f) => userAddedFilmIds.has(f.id));
        const freshAuto = fresh.filter((f) => !userAddedFilmIds.has(f.id));

        // Split queue into already-seen and unseen portions
        const seen = prev.slice(0, ci);
        const unseen = [...prev.slice(ci)];

        // Auto-seeded films: scatter randomly throughout the unseen portion.
        // Always insert at position ≥ 1 so the current card (unseen[0]) is never displaced.
        for (const film of freshAuto) {
          const pos = unseen.length <= 1
            ? unseen.length
            : 1 + Math.floor(Math.random() * unseen.length);
          unseen.splice(pos, 0, film);
        }

        // User-added films: surface near positions 3–8 of the unseen portion,
        // but never before position 1 (don't displace the current card).
        const userInsertBase = Math.max(1, Math.min(3, unseen.length));
        for (const film of freshUserAdded) {
          const pos = Math.min(userInsertBase + Math.floor(Math.random() * 6), unseen.length);
          unseen.splice(pos, 0, film);
        }

        return [...seen, ...unseen];
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
      setIsHostState(getIsHost(code));

      if (s.status === "closed") {
        const existing = await getMatches(s.id);
        if (existing.length > 0) { setMatchList(existing); setLoading(false); return; }
        else { router.push("/"); return; }
      }

      const allParticipants = await getParticipants(s.id);
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
        setMinLoadDone(true); // skip 3s timer — not a first visit
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
    await recordSwipe(s.id, participant.id, film.id, liked);

    if (liked && s.started) {
      const isMatch = await checkForMatch(s.id, film.id, s.threshold);
      if (isMatch && s.mode === "live") {
        await closeSession(s.id);
        await new Promise((r) => setTimeout(r, 300));
        const allMatches = await getMatches(s.id);
        if (allMatches.length > 0) { setMatchList(allMatches); return; }
      }
    }

    const next = currentIndex + 1;
    if (next >= queue.length) {
      // Final batch check — catches the case where this was the last voter
      if (s.started && s.mode === "live") {
        let found = false;
        for (const f of queue) {
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
    } else {
      setCurrentIndex(next);
      if (infoFilm) setInfoFilm(queue[next]);
    }
  }

  async function handleStart() {
    if (!session) return;
    setStarting(true);
    await startSession(session.id);
    // Update local state immediately so handleSwipe checks fire correctly
    setSession((s) => s ? { ...s, started: true } : s);

    if (session.mode === "live") {
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

  if (loading || !minLoadDone) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center space-y-5 mx-auto px-6" style={{ maxWidth: 480 }}>
          <Logo size="md" />
          {/* Spinning film reel */}
          <div className="flex justify-center">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin"
                style={{ borderColor: `var(--accent) transparent var(--accent) var(--accent)` }} />
              <div className="absolute inset-0 flex items-center justify-center text-2xl">🎬</div>
            </div>
          </div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{LOAD_MESSAGE}</p>
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
        )}
      </div>
    );
  }

  const currentFilm = queue[currentIndex];
  const nextFilm = queue[currentIndex + 1];
  const sessionStarted = session?.started ?? false;

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
      <header className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          {/* SCROLL_HIDDEN: toggle button removed — swipe is always active */}
          <button onClick={() => setShowGenreFilter((v) => !v)}
            className="p-2 rounded-lg relative"
            style={{ background: "var(--surface)", color: selectedGenres.length > 0 ? "var(--accent)" : "var(--text-muted)" }}>
            <SlidersHorizontal size={18} />
            {selectedGenres.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-xs flex items-center justify-center"
                style={{ background: "var(--accent)", color: "#0c0c0e" }}>
                {selectedGenres.length}
              </span>
            )}
          </button>
          <button onClick={() => router.push(`/session/${code}/add`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Plus size={18} />
          </button>
          <button onClick={() => router.push(`/session/${code}/results`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Trophy size={18} />
          </button>
        </div>
      </header>

      {/* Genre filter panel */}
      <AnimatePresence>
        {showGenreFilter && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden shrink-0">
            <div className="px-5 pb-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Filter by genre
                </p>
                {selectedGenres.length > 0 && (
                  <button onClick={() => setSelectedGenres([])}
                    className="text-xs flex items-center gap-1"
                    style={{ color: "var(--text-muted)" }}>
                    <X size={11} /> Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TMDB_GENRES.map((g) => {
                  const on = selectedGenres.includes(g.id);
                  return (
                    <button key={g.id} onClick={() => toggleGenre(g.id)}
                      className="px-2.5 py-1 rounded-full text-xs border transition-all"
                      style={{
                        background: on ? "var(--accent)" : "var(--surface)",
                        borderColor: on ? "var(--accent)" : "var(--border)",
                        color: on ? "#0c0c0e" : "var(--text-muted)",
                      }}>
                      {g.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                {selectedGenres.length === 0
                  ? "Showing all genres"
                  : `${queue.length} film${queue.length !== 1 ? "s" : ""} match your filter`}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Code + start bar */}
      <div className="px-5 pb-3 shrink-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
          style={{ background: "var(--surface)" }}>
          <button onClick={handleShare} className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-bold tracking-widest text-sm" style={{ color: "var(--accent)" }}>
              {code}
            </span>
            {copied && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Copied</span>
            )}
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {isHost && !sessionStarted ? (
              <button onClick={handleStart} disabled={starting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: "var(--like)", color: "#0c0c0e", opacity: starting ? 0.6 : 1 }}>
                <Play size={12} fill="currentColor" />
                {starting ? "Starting…" : "Start"}
              </button>
            ) : (
              <span className="text-xs px-2.5 py-1 rounded-full flex items-center gap-1 shrink-0"
                style={{
                  background: sessionStarted ? "rgba(74,222,128,0.12)" : "var(--surface-2)",
                  color: sessionStarted ? "var(--like)" : "var(--text-muted)",
                }}>
                {sessionStarted ? <CheckCircle size={11} /> : <Clock size={11} />}
                {sessionStarted ? "Live" : "Waiting"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Participants */}
      <div className="flex flex-col items-center px-5 py-3 shrink-0">
        <div className="flex justify-center gap-1 flex-wrap">
          {participants.map((p, i) => {
            const isMe = p.id === participant?.id;
            const hasFilm = !!CHARACTER_FILMS[p.name];
            return (
              <span key={p.id} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span style={{ color: "var(--text-muted)", opacity: 0.35 }}>·</span>
                )}
                <button
                  onClick={async () => {
                    if (!hasFilm || characterFilmLoading) return;
                    setCharacterFilmLoading(true);
                    const entry = CHARACTER_FILMS[p.name];
                    const detail = await getFilmDetail(entry.tmdbId);
                    if (detail) {
                      const film = { ...tmdbToFilm(detail), id: `char-${entry.tmdbId}` } as Film;
                      setCharacterFilm(film);
                    }
                    setCharacterFilmLoading(false);
                  }}
                  style={{
                    color: isMe ? "var(--text)" : "var(--text-muted)",
                    fontWeight: isMe ? 600 : 400,
                    fontSize: isMe ? "13px" : "12px",
                    cursor: hasFilm ? "pointer" : "default",
                    opacity: characterFilmLoading ? 0.5 : 1,
                    background: "none",
                    border: "none",
                    padding: 0,
                  }}>
                  {p.name}
                </button>
              </span>
            );
          })}
        </div>
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
                        sessionServices={session?.streaming_services ?? []} />
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
                          onDragEnd={() => { swipeInProgress.current = false; }} />
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

      {/* Character film overlay — tap your own name bubble to open */}
      <FilmInfoOverlay
        film={characterFilm}
        onClose={() => setCharacterFilm(null)}
        sessionServices={session?.streaming_services ?? []}
      />

      <div className="h-24 shrink-0" />
    </div>
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
              Shortlist
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
