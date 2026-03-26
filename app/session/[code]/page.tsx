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
  getMySwipes, getMyLikes, recordSwipe, checkForMatch, getMatches, closeSession, startSession,
  startTiebreaker, resolveMatch, addFilmToSession, getSessionSwipeStats,
} from "@/lib/session";
import { getTrendingFilms, getTopRatedFilms, discoverFilmsByProviders, getAUProviderList, posterUrl } from "@/lib/tmdb";
import { getDendySessions, DendyFilm } from "@/lib/dendy";
import { getService, AU_SERVICES, TMDB_GENRES } from "@/lib/streaming";
import { supabase } from "@/lib/supabase";
import { participantColor } from "@/lib/names";
import { Film, Session, Participant, Match } from "@/types";
import { Plus, Users, Trophy, CheckCircle, Play, SlidersHorizontal, X, Heart, Layers, List } from "lucide-react";

const LOAD_MESSAGES = [
  "Preparing the film reel…",
  "Bribing the critics…",
  "Arguing with the studio execs…",
  "Rewinding the VHS…",
  "Buttering the popcorn…",
  "Negotiating with Spielberg…",
  "Dimming the lights…",
  "Shushing the talkers…",
  "Fast-forwarding through the ads…",
  "Finding a good seat in the dark…",
];

export default function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isHost, setIsHostState] = useState(false);
  const [fullQueue, setFullQueue] = useState<Film[]>([]);   // all films before genre filter
  const [currentIndex, setCurrentIndex] = useState(0);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [matchList, setMatchList] = useState<Match[]>([]);
  const [allDone, setAllDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [minLoadDone, setMinLoadDone] = useState(false);
  const [loadMsgIndex, setLoadMsgIndex] = useState(0);
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
  // Ref so loadFilms (useCallback with [] deps) always sees the latest index
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  // Ref to imperatively scroll ScrollView when switching from swipe → scroll
  const scrollViewRef = useRef<ScrollViewHandle>(null);
  // Tracks the last known scroll mode index so swipe can resume at the same position
  const scrollIndexRef = useRef(0);
  // Ref so swipes subscription always sees the latest participant without stale closure
  const participantRef = useRef<Participant | null>(null);
  useEffect(() => { participantRef.current = participant; }, [participant]);

  // ── Minimum loading screen (3s) with cycling flavour text ─────────────────
  useEffect(() => {
    const timer = setTimeout(() => setMinLoadDone(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!loading && minLoadDone) return; // already past loading
    const interval = setInterval(() => {
      setLoadMsgIndex((i) => (i + 1) % LOAD_MESSAGES.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [loading, minLoadDone]);

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

  // View mode — persisted to localStorage (scroll is the default)
  const [viewMode, setViewMode] = useState<"swipe" | "scroll">(() => {
    if (typeof window === "undefined") return "scroll";
    return (localStorage.getItem("filmclub-view-mode") as "swipe" | "scroll") ?? "scroll";
  });
  function toggleViewMode() {
    setViewMode((m) => {
      const next = m === "swipe" ? "scroll" : "swipe";
      localStorage.setItem("filmclub-view-mode", next);
      if (next === "swipe") {
        // Scroll → swipe: resume swipe at last known scroll index
        setCurrentIndex(scrollIndexRef.current);
      }
      // Swipe → scroll: initialIndex prop handles the position on mount
      return next;
    });
  }

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
    return (s.streaming_services ?? [])
      .flatMap((sid) => {
        const tmdbId = AU_SERVICES.find((svc) => svc.id === sid)?.tmdbId;
        return tmdbId != null ? [tmdbId] : [];
      });
  }

  // session_films upsert is idempotent so re-adding later is safe.
  async function seedHomePool(s: Session) {
    const providerIds = sessionProviderTmdbIds(s);
    console.log("[seed] services:", s.streaming_services, "→ providerIds:", providerIds);
    // DEV: log the real TMDB AU provider list once to verify IDs
    if (process.env.NODE_ENV === "development") {
      getAUProviderList().then((list) => {
        const relevant = list.filter((p) =>
          /stan|binge|netflix|prime|disney|apple|paramount|foxtel/i.test(p.provider_name)
        );
        console.log("[TMDB AU providers]", relevant.map(p => `${p.provider_name} (${p.provider_id})`));
      });
    }
    // When streaming services are selected, seed from TMDB Discover so only
    // films actually available on those services are added.
    // Fall back to trending when no services are specified.
    const films = providerIds.length > 0
      ? await discoverFilmsByProviders(providerIds, 1)
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
    const providerIds = sessionProviderTmdbIds(s);
    const raw = providerIds.length > 0
      ? await discoverFilmsByProviders(providerIds, 4)
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
    // should already match. This filter is the final safety net.
    // Films with no provider data are excluded when services are selected — they
    // shouldn't be in the pool anyway if seeding worked correctly.
    let filteredAuto = autoSeeded;
    if ((s.watch_mode === "home" || s.watch_mode === "both") && s.streaming_services?.length > 0) {
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

        // Auto-seeded films: scatter randomly throughout the unseen portion
        for (const film of freshAuto) {
          const pos = Math.floor(Math.random() * (unseen.length + 1));
          unseen.splice(pos, 0, film);
        }

        // User-added films: surface near positions 3–8 of the unseen portion
        // so they appear soon without immediately interrupting the current card
        const userInsertBase = Math.min(3, unseen.length);
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
      }

      const allParticipants = await getParticipants(s.id);
      setParticipant(allParticipants.find((p) => p.id === pid) ?? null);
      setParticipants(allParticipants);

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

            // Like propagation: someone else liked a film — surface it near top of our unseen queue
            if (newSwipe.participant_id !== participantRef.current?.id) {
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
      const poolWithMeta = await getSessionFilmsWithMeta(session.id);
      let found = false;
      for (const { film } of poolWithMeta) {
        if (await checkForMatch(session.id, film.id, session.threshold)) found = true;
      }
      if (found) {
        await closeSession(session.id);
        // Small delay to let upserts settle before fetching
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
          <p className="text-sm transition-all duration-500" style={{ color: "var(--text-muted)" }}>
            {LOAD_MESSAGES[loadMsgIndex]}
          </p>
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

            onRandomise={async (winnerFilmId: string) => {
              await resolveMatch(session!.id, winnerFilmId);
              // Real-time subscription will fire on all devices and show the winner
            }}
            onVoteAgain={async () => {
              const filmIds = matchList.map((m) => m.film_id);
              await startTiebreaker(session!.id, filmIds);
              setMatchList([]);
              setAllDone(false);
              setCurrentIndex(0);
              await loadFilms({ ...session!, tiebreaker_film_ids: filmIds, status: "active", started: true }, participant!.id, true);
            }}
          />
        </div>
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
          <button onClick={toggleViewMode}
            className="p-2 rounded-lg"
            title={viewMode === "swipe" ? "Switch to scroll" : "Switch to swipe"}
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
            {viewMode === "swipe" ? <List size={18} /> : <Layers size={18} />}
          </button>
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
          {isHost && !sessionStarted && (
            <button onClick={handleStart} disabled={starting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
              style={{ background: "var(--like)", color: "#0c0c0e", opacity: starting ? 0.6 : 1 }}>
              <Play size={12} fill="currentColor" />
              {starting ? "Starting…" : "Start session"}
            </button>
          )}
          {sessionStarted && (
            <span className="text-xs px-2.5 py-1 rounded-full shrink-0"
              style={{ background: "rgba(74,222,128,0.12)", color: "var(--like)" }}>
              Live
            </span>
          )}
        </div>
        {!sessionStarted && !isHost && (
          <p className="text-xs text-center mt-2" style={{ color: "var(--text-muted)" }}>
            Waiting for the host to start — swipe away in the meantime
          </p>
        )}
      </div>

      {/* Participants */}
      <div className="flex items-center gap-2 px-5 pb-3 shrink-0">
        <Users size={12} style={{ color: "var(--text-muted)" }} />
        <div className="flex gap-1 flex-wrap">
          {participants.map((p) => {
            const col = participantColor(p.name);
            const isMe = p.id === participant?.id;
            return (
              <span key={p.id} className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: `${col}22`,
                  color: col,
                  border: `1px solid ${col}55`,
                  outline: isMe ? `2px solid ${col}` : "none",
                  outlineOffset: "1px",
                }}>
                {p.name}
              </span>
            );
          })}
        </div>
      </div>

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
                  onResults={() => router.push(`/session/${code}/results`)} />
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
                    onResults={() => router.push(`/session/${code}/results`)} />
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
                          participants={participants} />
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
    </div>
  );
}



function AllDoneScreen({ mode, watchMode, neverHadFilms, onResults }: {
  mode: string;
  watchMode: string;
  neverHadFilms: boolean;
  onResults: () => void;
}) {
  const isCinemaOnly = watchMode === "cinema";
  const noSessionsToday = isCinemaOnly && neverHadFilms;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
      <div className="text-4xl mb-4">{noSessionsToday ? "🎭" : "✅"}</div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text)" }}>
        {noSessionsToday ? "Nothing on tonight" : "You're all caught up"}
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {noSessionsToday
          ? "No sessions found at Dendy Newtown for today's time window. Try again later or switch to a streaming session."
          : mode === "planned"
            ? "Results will be revealed at the deadline."
            : "Waiting for the rest of the group."}
      </p>
      {!noSessionsToday && (
        <button onClick={onResults} className="px-6 py-3 rounded-xl text-sm font-semibold"
          style={{ background: "var(--accent)", color: "#0c0c0e" }}>
          {mode === "planned" ? "See current scores" : "See what everyone liked"}
        </button>
      )}
    </div>
  );
}

function MatchScreen({ matches, session, dendyMap, isHost, onRandomise, onVoteAgain }: {
  matches: Match[];
  session: Session;
  dendyMap: Map<string, DendyFilm>;
  isHost: boolean;
  onRandomise?: (winnerFilmId: string) => Promise<void>;
  onVoteAgain?: () => void;
}) {
  const router = useRouter();
  const topMatch = matches[0];
  const topFilm = topMatch?.film;
  if (!topFilm) return null;
  const hasMultiple = matches.length > 1;
  const isTied = hasMultiple;
  const topDendy = dendyMap.get(topFilm.id);

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      <div className="fixed inset-0 opacity-10 pointer-events-none overflow-hidden">
        <img src={posterUrl(topFilm.poster_path, "w500")} alt=""
          className="w-full h-full object-cover" style={{ filter: "blur(20px)" }} />
      </div>
      <div className="relative z-10 flex flex-col items-center px-5 pt-12 pb-8 flex-1 overflow-y-auto">
        <div className="text-4xl mb-3">🎬</div>
        <h1 className="text-xl font-medium mb-1" style={{ color: "var(--accent)" }}>
          {hasMultiple ? "It's a tie!" : "You've got a match"}
        </h1>
        <p className="text-xs mb-8 text-center" style={{ color: "var(--text-muted)" }}>
          {hasMultiple ? `${matches.length} films everyone agreed on` : "Everyone agreed on tonight's film"}
        </p>

        <div className="w-44 rounded-2xl overflow-hidden shadow-2xl mb-4" style={{ aspectRatio: "2/3" }}>
          <img src={posterUrl(topFilm.poster_path, "w342")} alt={topFilm.title}
            className="w-full h-full object-cover" />
        </div>
        <h2 className="text-2xl font-bold mb-1 text-center" style={{ color: "var(--text)" }}>{topFilm.title}</h2>
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          {topFilm.release_year}{topFilm.rating ? ` · ★ ${topFilm.rating}` : ""}
        </p>

        {/* Where to watch */}
        <WatchOptions film={topFilm} dendy={topDendy} session={session} />

        {/* Tied films list — shown when there's a tie and no winner picked yet */}
        {isTied && (
          <div className="w-full mb-2 mt-2">
            <div className="space-y-2">
              {matches.map((m) => m.film && (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: "var(--surface)" }}>
                  <div className="w-10 rounded-lg overflow-hidden shrink-0" style={{ aspectRatio: "2/3" }}>
                    <img src={posterUrl(m.film.poster_path, "w342")} alt={m.film.title}
                      className="w-full h-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>{m.film.title}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {m.film.release_year}{m.film.rating ? ` · ★ ${m.film.rating}` : ""}
                    </p>
                    <WatchOptions film={m.film} dendy={dendyMap.get(m.film.id)} session={session} compact />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}



        {/* Tiebreaker actions — host only */}
        {isTied && isHost && (
          <div className="flex gap-3 w-full max-w-xs mt-4">
            {onVoteAgain && (
              <button onClick={onVoteAgain} className="flex-1 py-3 rounded-xl text-sm font-semibold border"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                Vote again
              </button>
            )}
            {onRandomise && (
              <button
                onClick={() => {
                  const winner = matches[Math.floor(Math.random() * matches.length)];
                  onRandomise(winner.film_id);
                }}
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "var(--accent)", color: "#0c0c0e" }}>
                Randomise
              </button>
            )}
          </div>
        )}

        {isTied && !isHost && (
          <p className="text-xs mt-4 text-center" style={{ color: "var(--text-muted)" }}>
            Waiting for the host to decide…
          </p>
        )}

        {!isTied && (
          <div className="flex gap-3 w-full max-w-xs mt-auto pt-4">
            <button onClick={() => router.push("/")} className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: "var(--accent)", color: "#0c0c0e" }}>Done</button>
          </div>
        )}
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
    const svc = getService(p.serviceId);
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
