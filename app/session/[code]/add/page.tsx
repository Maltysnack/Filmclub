"use client";

import { useState, useEffect, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Trophy, Layers, Lock, Clock } from "lucide-react";
import { useLongPress } from "@/hooks/useLongPress";
import { searchFilms, getFilmDetail, tmdbToFilm, posterUrl } from "@/lib/tmdb";
import { fetchWatchProvidersAU, getService } from "@/lib/streaming";
import { addFilmToSession, getSession, getParticipantId, getSessionFilms, recordSwipe } from "@/lib/session";
import { TMDBMovie, Film } from "@/types";
import Logo from "@/components/Logo";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";

// Module-level provider cache — persists across re-renders and back/forward navigation
const providerCache = new Map<number, string[]>();

const MIN_VOTES = 50;  // filter out films with fewer TMDB votes than this
const MAX_RESULTS = 9; // always show a 3×3 grid

export default function AddFilmsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [alreadyInPool, setAlreadyInPool] = useState<Set<number>>(new Set());
  const [likedByMe, setLikedByMe] = useState<Set<number>>(new Set());
  const [searching, setSearching] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [participantId, setParticipantIdState] = useState<string | null>(null);
  const [filmIdMap, setFilmIdMap] = useState<Map<number, string>>(new Map());
  const [sessionServices, setSessionServices] = useState<string[]>([]);
  // tmdbId → serviceIds (populated lazily, one film at a time)
  const [providerMap, setProviderMap] = useState<Map<number, string[]>>(new Map());
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);

  // Tracks the current set of displayed result IDs — used to drop stale provider callbacks
  const currentResultIds = useRef(new Set<number>());

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");
      setSessionId(s.id);
      setParticipantIdState(pid);
      setSessionServices(s.streaming_services ?? []);
      setSessionStarted(s.started);
      setSessionClosed(s.status === "closed");

      const pool = await getSessionFilms(s.id);
      setAlreadyInPool(new Set(pool.map((f: Film) => f.tmdb_id)));
      setFilmIdMap(new Map(pool.map((f: Film) => [f.tmdb_id, f.id])));
    }
    init();
  }, [code, router]);

  // Debounced search — show results immediately, check providers lazily
  useEffect(() => {
    const timer = setTimeout(async () => {
      const q = query.trim();
      if (!q) {
        setResults([]);
        setProviderMap(new Map());
        currentResultIds.current = new Set();
        return;
      }
      setSearching(true);
      const raw = await searchFilms(q);
      setSearching(false);

      // Filter: must have a poster and enough votes to be a real film
      const filtered = raw
        .filter(m => m.poster_path && m.vote_count >= MIN_VOTES)
        .slice(0, MAX_RESULTS);

      currentResultIds.current = new Set(filtered.map(m => m.id));
      setResults(filtered);
      // Seed providerMap with any already-cached entries so cards update instantly
      setProviderMap(new Map(
        filtered
          .filter(m => providerCache.has(m.id))
          .map(m => [m.id, providerCache.get(m.id)!])
      ));

      // Check providers for uncached films one at a time — each resolves independently
      if (sessionServices.length > 0) {
        const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
        filtered.forEach(async (movie) => {
          if (providerCache.has(movie.id)) return; // already seeded above
          const providers = await fetchWatchProvidersAU(movie.id, apiKey);
          const serviceIds = providers.map(p => p.serviceId);
          providerCache.set(movie.id, serviceIds);
          // Only update state if this film is still in the current results
          if (!currentResultIds.current.has(movie.id)) return;
          setProviderMap(prev => new Map(prev).set(movie.id, serviceIds));
        });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [query, sessionServices]);

  async function handleAdd(movie: TMDBMovie) {
    if (!sessionId || !participantId) return;
    setAlreadyInPool((prev) => new Set([...prev, movie.id]));
    const success = await addFilmToSession(sessionId, movie.id, participantId);
    if (!success) return;
    const pool = await getSessionFilms(sessionId);
    const added = pool.find((f) => f.tmdb_id === movie.id);
    if (added) {
      setFilmIdMap((prev) => new Map([...prev, [movie.id, added.id]]));
      await recordSwipe(sessionId, participantId, added.id, true);
      setLikedByMe((prev) => new Set([...prev, movie.id]));
    }
  }

  async function handleLike(movie: TMDBMovie) {
    if (!sessionId || !participantId) return;
    if (!alreadyInPool.has(movie.id)) {
      await handleAdd(movie);
    } else {
      const filmId = filmIdMap.get(movie.id);
      if (filmId) {
        await recordSwipe(sessionId, participantId, filmId, true);
        setLikedByMe((prev) => new Set([...prev, movie.id]));
      }
    }
  }

  async function handleInfo(movie: TMDBMovie) {
    // Show overlay immediately with data we already have from the search result
    const provisional: Film = {
      id: String(movie.id),
      tmdb_id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path ?? null,
      backdrop_path: movie.backdrop_path ?? null,
      overview: movie.overview ?? null,
      release_year: movie.release_date ? parseInt(movie.release_date.slice(0, 4)) : null,
      runtime: null,
      genres: [],
      film_cast: [],
      rating: null,
      imdb_id: null,
      imdb_rating: null,
      watch_providers_au: [],
    };
    setInfoFilm(provisional);

    // Fetch full detail + providers in background, then update the open overlay
    const detail = await getFilmDetail(movie.id);
    if (detail) {
      const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
      const providers = await fetchWatchProvidersAU(movie.id, apiKey);
      setInfoFilm({ ...tmdbToFilm(detail), id: String(movie.id), watch_providers_au: providers });
    }
  }

  const showSearch = query.trim().length > 0;

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
      <div className="flex flex-col min-h-dvh mx-auto" style={{ maxWidth: 480 }}>
        {/* Header */}
        <header className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
          <Logo size="sm" showText={false} />
          <h1 className="flex-1 text-base font-semibold" style={{ color: "var(--text)" }}>Search</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(`/session/${code}`)}
              className="p-2 rounded-lg"
              style={{ background: "var(--surface)", color: "var(--accent)" }}>
              <Layers size={18} />
            </button>
            <button onClick={() => router.push(`/session/${code}/results`)}
              className="p-2 rounded-lg"
              style={{ background: "var(--surface)", color: "var(--accent)" }}>
              <Trophy size={18} />
            </button>
            <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
              style={{
                background: (sessionStarted || sessionClosed) ? "rgba(74,222,128,0.1)" : "var(--surface)",
                color: (sessionStarted || sessionClosed) ? "var(--like)" : "var(--text-muted)",
              }}>
              {sessionClosed ? <Lock size={11} /> : <Clock size={11} />}
              {sessionClosed ? "Closed" : sessionStarted ? "Live" : "Waiting"}
            </div>
          </div>
        </header>

        {/* Search bar */}
        <div className="px-5 mb-5 shrink-0">
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <Search size={16} style={{ color: "var(--text-muted)" }} />
            <input
              type="search"
              placeholder="Search for a film…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--text)" }}
              autoFocus
            />
            {searching && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>…</span>
            )}
          </div>

          {/* Active service filter — logo icons */}
          {sessionServices.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {sessionServices.map((sid) => {
                const svc = getService(sid);
                if (!svc) return null;
                return (
                  <span key={sid} title={svc.name}
                    className="relative inline-flex items-center justify-center w-7 h-7 rounded-lg text-[9px] font-bold shrink-0"
                    style={{ background: svc.color, color: "#fff" }}>
                    {svc.abbrev}
                    {svc.tmdbLogoPath && (
                      <img
                        src={`https://image.tmdb.org/t/p/w45${svc.tmdbLogoPath}`}
                        alt={svc.name}
                        className="absolute inset-0 w-7 h-7 rounded-lg object-cover"
                        onError={e => { e.currentTarget.style.display = "none"; }}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pb-8">
          {/* Empty state */}
          {!showSearch && (
            <div className="flex flex-col items-center justify-center gap-3 pt-20 px-8 text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "var(--surface)" }}>
                <Search size={24} style={{ color: "var(--text-muted)" }} />
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                Search for any film
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {sessionServices.length > 0
                  ? "Films not on your selected services will be faded out."
                  : "Add films to the pool for everyone to swipe on."}
              </p>
            </div>
          )}

          {/* No results */}
          {showSearch && !searching && results.length === 0 && (
            <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
              No results for &ldquo;{query}&rdquo;
            </p>
          )}

          {/* Results grid */}
          {showSearch && results.length > 0 && (
            <section className="px-5">
              <AnimatePresence mode="popLayout">
                <FilmGrid
                  films={results}
                  alreadyInPool={alreadyInPool}
                  likedByMe={likedByMe}
                  sessionServices={sessionServices}
                  providerMap={providerMap}
                  onInfo={handleInfo}
                />
              </AnimatePresence>
            </section>
          )}
        </div>
      </div>

      <FilmInfoOverlay
        film={infoFilm}
        onClose={() => setInfoFilm(null)}
        onLike={infoFilm ? () => {
          const movie = results.find((r) => r.id === infoFilm.tmdb_id);
          if (movie) handleLike(movie);
          setInfoFilm(null);
        } : undefined}
        sessionServices={sessionServices}
      />

    </div>
  );
}

function FilmGrid({
  films, alreadyInPool, likedByMe, sessionServices, providerMap, onInfo,
}: {
  films: TMDBMovie[];
  alreadyInPool: Set<number>;
  likedByMe: Set<number>;
  sessionServices: string[];
  providerMap: Map<number, string[]>;
  onInfo: (m: TMDBMovie) => void;
}) {
  // Split into available and unavailable — films not yet checked stay in available (optimistic)
  const isUnavailable = (movie: TMDBMovie) => {
    const sids = providerMap.get(movie.id);
    return sessionServices.length > 0 && sids !== undefined && !sids.some(id => sessionServices.includes(id));
  };

  const available = films.filter(m => !isUnavailable(m));
  const unavailable = sessionServices.length > 0 ? films.filter(isUnavailable) : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        {available.map(movie => (
          <SearchFilmCard
            key={movie.id}
            movie={movie}
            inPool={alreadyInPool.has(movie.id)}
            liked={likedByMe.has(movie.id)}
            onInfo={onInfo}
          />
        ))}
      </div>

      {unavailable.length > 0 && (
        <>
          <p className="text-xs font-medium uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}>
            Not on your services
          </p>
          <div className="grid grid-cols-3 gap-3" style={{ opacity: 0.4 }}>
            {unavailable.map(movie => (
              <SearchFilmCard
                key={movie.id}
                movie={movie}
                inPool={alreadyInPool.has(movie.id)}
                liked={likedByMe.has(movie.id)}
                onInfo={onInfo}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SearchFilmCard({
  movie, inPool, liked, onInfo,
}: {
  movie: TMDBMovie;
  inPool: boolean;
  liked: boolean;
  onInfo: (m: TMDBMovie) => void;
}) {
  const { handlers } = useLongPress(() => onInfo(movie));
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative rounded-xl overflow-hidden"
      style={{ aspectRatio: "2/3", background: "var(--surface)" }}
      {...handlers}
    >
      <img
        src={posterUrl(movie.poster_path, "w500")}
        alt={movie.title}
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0"
        style={{ background: "linear-gradient(to top, rgba(12,12,14,0.92) 0%, transparent 55%)" }} />

      {/* Title + year */}
      <div className="absolute bottom-0 left-0 right-0 p-2">
        <p className="text-xs font-medium leading-tight line-clamp-2" style={{ color: "var(--text)" }}>
          {movie.title}
        </p>
        {movie.release_date && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {movie.release_date.slice(0, 4)}
          </p>
        )}
      </div>

      {/* Status dot — top-left, shows when already added or liked */}
      {(liked || inPool) && (
        <div className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full"
          style={{ background: liked ? "var(--like)" : "rgba(255,255,255,0.3)" }} />
      )}
    </motion.div>
  );
}
