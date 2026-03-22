"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Logo from "@/components/Logo";
import SwipeCard from "@/components/SwipeCard";
import FilmModal from "@/components/FilmModal";
import {
  getSession, getParticipantId, getIsHost, getParticipants, getSessionFilmsWithMeta,
  getMySwipes, recordSwipe, checkForMatch, getMatches, closeSession, startSession,
  addFilmToSession,
} from "@/lib/session";
import { getTrendingFilms, getTopRatedFilms, posterUrl } from "@/lib/tmdb";
import { getDendySessions, DendyFilm } from "@/lib/dendy";
import { getService, TMDB_GENRES } from "@/lib/streaming";
import { supabase } from "@/lib/supabase";
import { Film, Session, Participant, Match } from "@/types";
import { Plus, Users, Trophy, Share2, CheckCircle, Play, SlidersHorizontal, X, Heart } from "lucide-react";

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
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showGenreFilter, setShowGenreFilter] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  // Map from film.id -> dendy session info
  const [dendyMap, setDendyMap] = useState<Map<string, DendyFilm>>(new Map());
  // Debounce timer so background batch-inserts don't hammer loadFilms
  const queueRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // session_films upsert is idempotent so re-adding later is safe.
  async function seedHomePool(s: Session) {
    const trending = await getTrendingFilms(1);
    const seen = new Set<number>();
    const initial = trending.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).slice(0, 5);
    await Promise.all(initial.map((m) => addFilmToSession(s.id, m.id, null)));
  }

  // Background expander — runs silently after the session page is shown.
  // Adds ~80 more films in batches of 8; the real-time subscription
  // picks up each batch and extends the live queue automatically.
  async function seedMoreHomePool(s: Session) {
    const [moreTrending, topRated] = await Promise.all([
      getTrendingFilms(3),
      getTopRatedFilms(2),
    ]);
    const seen = new Set<number>();
    const all = [...moreTrending, ...topRated].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    }).slice(0, 80);

    const BATCH = 8;
    for (let i = 0; i < all.length; i += BATCH) {
      await Promise.all(all.slice(i, i + BATCH).map((m) => addFilmToSession(s.id, m.id, null)));
      if (i + BATCH < all.length) await new Promise((r) => setTimeout(r, 400));
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

    const mySwiped = await getMySwipes(s.id, participantId);
    const unswiped = poolWithMeta.filter(({ film }) => !mySwiped.has(film.id));

    const userAdded = unswiped.filter(({ addedBy }) => addedBy && addedBy !== participantId);
    const autoSeeded = unswiped.filter(({ addedBy }) => !addedBy || addedBy === participantId);
    setUserAddedIds(new Set(userAdded.map(({ film }) => film.id)));

    // Filter home pool by streaming services.
    // Only exclude films that have provider data AND none of it matches — never exclude
    // films with empty watch_providers_au (data may not be populated yet).
    let filteredAuto = autoSeeded;
    if ((s.watch_mode === "home" || s.watch_mode === "both") && s.streaming_services?.length > 0) {
      filteredAuto = autoSeeded.filter(({ film }) => {
        const providers: { serviceId: string }[] = film.watch_providers_au ?? [];
        if (!providers.length) return true;
        return providers.some((p) => s.streaming_services.includes(p.serviceId));
      });
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
    // isInitial=false → background update: only append genuinely new films so the
    //   user's current swipe position is preserved (no jarring reset/flash).
    if (isInitial) {
      setFullQueue(ordered);
      setCurrentIndex(0);
      setAllDone(ordered.length === 0);
    } else {
      setFullQueue((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const fresh = ordered.filter((f) => !existingIds.has(f.id));
        if (fresh.length > 0) setAllDone(false);
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
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
          }
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "swipes", filter: `session_id=eq.${session.id}` },
        async () => {
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
    const film = queue[currentIndex];
    await recordSwipe(session.id, participant.id, film.id, liked);

    if (liked && session.started) {
      const isMatch = await checkForMatch(session.id, film.id, session.threshold);
      if (isMatch && session.mode === "live") {
        await closeSession(session.id);
        const allMatches = await getMatches(session.id);
        if (allMatches.length > 0) { setMatchList(allMatches); return; }
      }
    }

    const next = currentIndex + 1;
    setCurrentIndex(next);
    if (next >= queue.length) {
      setAllDone(true);
      setInfoFilm(null);
    } else if (infoFilm) {
      // Panel is open — slide to the next film's info instead of closing
      setInfoFilm(queue[next]);
    }
  }

  async function handleStart() {
    if (!session) return;
    setStarting(true);
    await startSession(session.id);
    if (session.mode === "live") {
      const poolWithMeta = await getSessionFilmsWithMeta(session.id);
      let found = false;
      for (const { film } of poolWithMeta) {
        if (await checkForMatch(session.id, film.id, session.threshold)) found = true;
      }
      if (found) {
        await closeSession(session.id);
        const allMatches = await getMatches(session.id);
        if (allMatches.length > 0) { setMatchList(allMatches); setStarting(false); return; }
      }
    }
    setStarting(false);
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: "Filmclub", text: `Join my Filmclub session! Code: ${code}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (loading) {
    const loadMsg = session?.watch_mode === "cinema"
      ? "Checking what's on at Dendy…"
      : "Loading session…";
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center space-y-4 mx-auto" style={{ maxWidth: 480 }}>
          <Logo size="md" />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{loadMsg}</p>
        </div>
      </div>
    );
  }

  if (matchList.length > 0) {
    return (
      <div style={{ background: "var(--bg)" }}>
        <div className="mx-auto" style={{ maxWidth: 480 }}>
          <MatchScreen matches={matchList} session={session!} dendyMap={dendyMap} onShare={handleShare} />
        </div>
      </div>
    );
  }

  const currentFilm = queue[currentIndex];
  const nextFilm = queue[currentIndex + 1];
  const sessionStarted = session?.started ?? false;

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
    <div className="flex flex-col min-h-dvh mx-auto"
      style={{ maxWidth: infoFilm ? 920 : 480, transition: "max-width 0.3s cubic-bezier(0.4,0,0.2,1)" }}>
      <header className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
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
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
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
            <Share2 size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <span className="font-mono font-bold tracking-widest text-sm" style={{ color: "var(--accent)" }}>
              {code}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {copied ? "Copied!" : "tap to share"}
            </span>
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
        {!sessionStarted && isHost && (
          <p className="text-xs text-center mt-2" style={{ color: "var(--text-muted)" }}>
            Share the code, wait for everyone to join, then hit Start
          </p>
        )}
      </div>

      {/* Participants */}
      <div className="flex items-center gap-2 px-5 pb-3 shrink-0">
        <Users size={12} style={{ color: "var(--text-muted)" }} />
        <div className="flex gap-1 flex-wrap">
          {participants.map((p) => (
            <span key={p.id} className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background: p.id === participant?.id ? "var(--accent)" : "var(--surface)",
                color: p.id === participant?.id ? "#0c0c0e" : "var(--text-muted)",
              }}>
              {p.name}
            </span>
          ))}
        </div>
      </div>

      {/* Progress */}
      <div className="px-5 mb-4 shrink-0">
        <div className="h-0.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ background: "var(--accent)", width: queue.length > 0 ? `${(currentIndex / queue.length) * 100}%` : "0%" }} />
        </div>
        <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
          {currentIndex} of {queue.length} film{queue.length !== 1 ? "s" : ""}
          {selectedGenres.length > 0 && " (filtered)"}
        </p>
      </div>

      {/* Cards + info panel — side by side when info is open */}
      <div className="flex gap-3 flex-1 px-5" style={{ minHeight: 0 }}>
        {/* Swipe card column */}
        <div className="relative shrink-0 transition-all duration-300"
          style={{
            width: infoFilm ? "calc(50% - 6px)" : "100%",
            height: "calc(100dvh - 310px)",
            maxHeight: 480,
          }}>
          <AnimatePresence>
            {allDone || (queue.length === 0 && !loading) ? (
              <AllDoneScreen mode={session?.mode ?? "live"}
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
                      isTop={!infoFilm}
                      dendyInfo={dendyMap.get(currentFilm.id)}
                      sessionServices={session?.streaming_services ?? []} />
                  </motion.div>
                )}
              </>
            )}
          </AnimatePresence>
        </div>

        {/* Info panel — slides in next to the card */}
        <AnimatePresence>
          {infoFilm && (
            <motion.div
              className="rounded-2xl overflow-hidden shrink-0 flex flex-col"
              style={{
                width: "calc(50% - 6px)",
                height: "calc(100dvh - 310px)",
                maxHeight: 480,
                background: "var(--surface)",
              }}
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 32 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
            >
              <FilmInfoPanel
                film={infoFilm}
                onClose={() => setInfoFilm(null)}
                onLike={!allDone ? () => handleSwipe(true) : undefined}
                onDislike={!allDone ? () => handleSwipe(false) : undefined}
                dendyInfo={dendyMap.get(infoFilm.id)}
                sessionServices={session?.streaming_services ?? []}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="h-24 shrink-0" />
    </div>
    </div>
  );
}

// ── Inline info panel (replaces full-screen FilmModal on swipe screen) ────────

function FilmInfoPanel({ film, onClose, onLike, onDislike, dendyInfo, sessionServices }: {
  film: Film;
  onClose: () => void;
  onLike?: () => void;
  onDislike?: () => void;
  dendyInfo?: DendyFilm;
  sessionServices: string[];
}) {
  const providers: { serviceId: string }[] = film.watch_providers_au ?? [];
  const availableProviders = providers.filter((p) => sessionServices.includes(p.serviceId));
  const showWhere = dendyInfo || availableProviders.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header row */}
      <div className="shrink-0 flex items-start justify-between px-3 pt-3 pb-1 gap-2">
        <h2 className="text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>
          {film.title}
        </h2>
        <button onClick={onClose} className="shrink-0 p-1.5 rounded-full mt-0.5"
          style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
          <X size={13} />
        </button>
      </div>

      {/* Meta */}
      <div className="shrink-0 flex items-center gap-2 px-3 pb-2 flex-wrap">
        {film.release_year && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{film.release_year}</span>
        )}
        {film.runtime && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {Math.floor(film.runtime / 60)}h {film.runtime % 60}m
          </span>
        )}
        {film.rating && (
          <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>★ {film.rating}</span>
        )}
        {film.genres?.slice(0, 2).map((g) => (
          <span key={g.id} className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
            {g.name}
          </span>
        ))}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-3 space-y-3 pb-2">
        {/* Where to watch */}
        {showWhere && (
          <div className="p-2.5 rounded-xl space-y-2" style={{ background: "var(--surface-2)" }}>
            {dendyInfo && (
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: "var(--accent)" }}>
                  🎬 Dendy Newtown{dendyInfo.tmdbMatch === "low" ? " ⚠️" : ""}
                </p>
                <div className="flex flex-wrap gap-1">
                  {dendyInfo.sessionTimes.map((t) => (
                    <a key={t} href={dendyInfo.bookingUrls[t] ?? "#"} target="_blank" rel="noopener noreferrer"
                      className="text-xs px-2 py-0.5 rounded font-medium"
                      style={{ background: "var(--accent)", color: "#0c0c0e" }}>
                      {t}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {availableProviders.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>🏠 Stream at home</p>
                <div className="flex flex-wrap gap-2">
                  {availableProviders.map((p) => {
                    const svc = getService(p.serviceId);
                    if (!svc) return null;
                    const lp = p.logoPath ?? (svc as typeof svc & { tmdbLogoPath: string | null }).tmdbLogoPath;
                    return lp ? (
                      <div key={p.serviceId} className="flex items-center gap-1.5">
                        <img src={`https://image.tmdb.org/t/p/w45${lp}`} alt={svc.name}
                          title={svc.name}
                          className="w-7 h-7 rounded-lg object-cover" />
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{svc.name}</span>
                      </div>
                    ) : (
                      <span key={p.serviceId} className="text-xs px-2 py-0.5 rounded font-bold"
                        style={{ background: `${svc.color}25`, color: svc.color, border: `1px solid ${svc.color}50` }}>
                        {svc.abbrev} {svc.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Overview */}
        {film.overview && (
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {film.overview}
          </p>
        )}

        {/* Cast */}
        {film.film_cast && film.film_cast.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-1.5"
              style={{ color: "var(--text-muted)" }}>Cast</p>
            <div className="space-y-1.5">
              {film.film_cast.slice(0, 6).map((member, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-xs font-medium"
                    style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                    {member.profile_path
                      ? <img src={`https://image.tmdb.org/t/p/w45${member.profile_path}`}
                          alt={member.name} className="w-full h-full object-cover" />
                      : member.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate" style={{ color: "var(--text)" }}>{member.name}</p>
                    {member.character && (
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{member.character}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons — icon buttons matching the main card controls */}
      {(onLike || onDislike) && (
        <div className="shrink-0 flex justify-center gap-6 px-3 pb-4 pt-2">
          {onDislike && (
            <button
              onClick={onDislike}
              className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
              style={{
                background: "var(--surface-2)",
                border: "2px solid var(--dislike)",
                color: "var(--dislike)",
              }}>
              <X size={24} />
            </button>
          )}
          {onLike && (
            <button
              onClick={onLike}
              className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
              style={{
                background: "var(--surface-2)",
                border: "2px solid var(--like)",
                color: "var(--like)",
              }}>
              <Heart size={22} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AllDoneScreen({ mode, onResults }: { mode: string; onResults: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
      <CheckCircle size={48} style={{ color: "var(--accent)" }} className="mb-4" />
      <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text)" }}>You&apos;re all caught up</h2>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {mode === "planned" ? "Results will be revealed at the deadline." : "Waiting for the rest of the group."}
      </p>
      <button onClick={onResults} className="px-6 py-3 rounded-xl text-sm font-semibold"
        style={{ background: "var(--accent)", color: "#0c0c0e" }}>
        {mode === "planned" ? "See current scores" : "See what everyone liked"}
      </button>
    </div>
  );
}

function MatchScreen({ matches, session, dendyMap, onShare }: {
  matches: Match[];
  session: Session;
  dendyMap: Map<string, DendyFilm>;
  onShare: () => void;
}) {
  const router = useRouter();
  const topMatch = matches[0];
  const topFilm = topMatch?.film;
  if (!topFilm) return null;
  const hasMultiple = matches.length > 1;
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
          {hasMultiple ? "You've got matches" : "You've got a match"}
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

        {/* Runner-ups */}
        {hasMultiple && (
          <div className="w-full mb-6 mt-4">
            <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
              Also matched
            </p>
            <div className="space-y-2">
              {matches.slice(1).map((m) => m.film && (
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

        <div className="flex gap-3 w-full max-w-xs mt-auto pt-4">
          <button onClick={onShare} className="flex-1 py-3 rounded-xl text-sm font-medium border"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>Share</button>
          <button onClick={() => router.push("/")} className="flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e" }}>Done</button>
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
  const providers: { serviceId: string }[] = (film as Film & { watch_providers_au?: { serviceId: string }[] }).watch_providers_au ?? [];
  const sessionServices = session.streaming_services ?? [];
  const availableProviders = providers.filter((p) => sessionServices.includes(p.serviceId));

  if (!dendy && !availableProviders.length) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {dendy && (
          <span className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: "rgba(232,184,109,0.15)", color: "var(--accent)" }}>
            🎬 Dendy
          </span>
        )}
        {availableProviders.slice(0, 2).map((p) => {
          const svc = getService(p.serviceId);
          return svc ? (
            <span key={p.serviceId} className="text-xs px-1.5 py-0.5 rounded font-bold"
              style={{ background: `${svc.color}22`, color: svc.color }}>
              {svc.abbrev}
            </span>
          ) : null;
        })}
      </div>
    );
  }

  return (
    <div className="w-full mb-4">
      {dendy && (
        <div className="p-3 rounded-xl mb-2" style={{ background: "rgba(232,184,109,0.08)", border: "1px solid rgba(232,184,109,0.2)" }}>
          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--accent)" }}>🎬 At Dendy Newtown</p>
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
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Also on:</p>
          {availableProviders.map((p) => {
            const svc = getService(p.serviceId);
            return svc ? (
              <span key={p.serviceId} className="text-xs px-2.5 py-1 rounded-lg font-bold"
                style={{ background: `${svc.color}25`, color: svc.color, border: `1px solid ${svc.color}50` }}>
                {svc.abbrev}
                <span className="font-normal ml-1 opacity-80">{svc.name}</span>
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
