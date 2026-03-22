"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Search, Plus, Check, Heart, Trophy, Info, Layers, Lock, Clock } from "lucide-react";
import { searchFilms, getFilmDetail, tmdbToFilm, posterUrl } from "@/lib/tmdb";
import { fetchWatchProvidersAU, getService } from "@/lib/streaming";
import { addFilmToSession, getSession, getParticipantId, getSessionFilms, recordSwipe } from "@/lib/session";
import { TMDBMovie, Film } from "@/types";
import Logo from "@/components/Logo";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";

export default function AddFilmsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [alreadyInPool, setAlreadyInPool] = useState<Set<number>>(new Set());
  const [likedByMe, setLikedByMe] = useState<Set<number>>(new Set());
  const [searching, setSearching] = useState(false);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [participantId, setParticipantIdState] = useState<string | null>(null);
  const [filmIdMap, setFilmIdMap] = useState<Map<number, string>>(new Map());
  const [sessionServices, setSessionServices] = useState<string[]>([]);
  // tmdbId → serviceIds available on (undefined = not yet checked)
  const [providerMap, setProviderMap] = useState<Map<number, string[]>>(new Map());
  // Info modal
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

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

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      const q = query.trim();
      if (!q) { setResults([]); setProviderMap(new Map()); return; }
      setSearching(true);
      const res = await searchFilms(q);
      const trimmed = res.slice(0, 20);
      setResults(trimmed);
      setSearching(false);

      // Fetch providers for all results in parallel if session has service filters
      if (sessionServices.length > 0) {
        setCheckingProviders(true);
        const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
        const entries = await Promise.all(
          trimmed.map(async (movie) => {
            const providers = await fetchWatchProvidersAU(movie.id, apiKey);
            return { tmdbId: movie.id, serviceIds: providers.map((p) => p.serviceId) };
          })
        );
        setProviderMap(new Map(entries.map((e) => [e.tmdbId, e.serviceIds])));
        setCheckingProviders(false);
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
    setInfoLoading(true);
    const detail = await getFilmDetail(movie.id);
    if (detail) {
      const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
      const providers = await fetchWatchProvidersAU(movie.id, apiKey);
      setInfoFilm({ ...tmdbToFilm(detail), id: String(movie.id), watch_providers_au: providers });
    }
    setInfoLoading(false);
  }

  const showSearch = query.trim().length > 0;

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
      <div className="flex flex-col min-h-dvh mx-auto" style={{ maxWidth: 480 }}>
        {/* Header */}
        <header className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}
          >
            <ArrowLeft size={18} />
          </button>
          <Logo size="sm" showText={false} />
          <h1 className="flex-1 text-base font-semibold" style={{ color: "var(--text)" }}>Add films</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => router.push(`/session/${code}/results`)}
              className="p-2 rounded-lg"
              style={{ background: "var(--surface)", color: "var(--accent)" }}>
              <Trophy size={18} />
            </button>
            <button onClick={() => router.push(`/session/${code}`)}
              className="p-2 rounded-lg"
              style={{ background: "var(--surface)", color: "var(--accent)" }}>
              <Layers size={18} />
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
            {(searching || checkingProviders) && (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {searching ? "…" : "checking…"}
              </span>
            )}
          </div>

          {/* Active service filter pills */}
          {sessionServices.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {sessionServices.map((sid) => {
                const svc = getService(sid);
                if (!svc) return null;
                return (
                  <span
                    key={sid}
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: `${svc.color}25`, color: svc.color, border: `1px solid ${svc.color}40` }}
                  >
                    {svc.name}
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
                  ? "Films not on your selected services will be shown greyed out."
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
                  onAdd={handleAdd}
                  onLike={handleLike}
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

      {/* Loading spinner while fetching info */}
      <AnimatePresence>
        {infoLoading && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.4)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="text-3xl animate-spin">🎬</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilmGrid({
  films, alreadyInPool, likedByMe, sessionServices, providerMap, onAdd, onLike, onInfo,
}: {
  films: TMDBMovie[];
  alreadyInPool: Set<number>;
  likedByMe: Set<number>;
  sessionServices: string[];
  providerMap: Map<number, string[]>;
  onAdd: (m: TMDBMovie) => void;
  onLike: (m: TMDBMovie) => void;
  onInfo: (m: TMDBMovie) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {films.map((movie) => {
        const inPool = alreadyInPool.has(movie.id);
        const liked = likedByMe.has(movie.id);

        // Availability — grey out only if checked and confirmed unavailable on a known service
        const serviceIds = providerMap.get(movie.id);
        const unavailable =
          sessionServices.length > 0 &&
          serviceIds !== undefined &&
          serviceIds.length > 0 &&
          !serviceIds.some((id) => sessionServices.includes(id));

        return (
          <motion.div
            key={movie.id}
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: unavailable ? 0.45 : 1, scale: 1 }}
            className="relative rounded-xl overflow-hidden group"
            style={{ aspectRatio: "2/3", background: "var(--surface)" }}
          >
            <img
              src={posterUrl(movie.poster_path, "w500")}
              alt={movie.title}
              className="w-full h-full object-cover"
            />

            {/* Gradient */}
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to top, rgba(12,12,14,0.92) 0%, transparent 55%)" }}
            />

            {/* "Not on your services" banner */}
            {unavailable && (
              <div
                className="absolute top-0 left-0 right-0 px-1.5 py-1 text-center"
                style={{ background: "rgba(12,12,14,0.82)" }}
              >
                <p className="text-xs leading-tight" style={{ color: "var(--text-muted)" }}>
                  Not on your services
                </p>
              </div>
            )}

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

            {/* Center hover — like / add button */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              style={{ background: "rgba(12,12,14,0.55)" }}
            >
              <button
                onClick={() => onLike(movie)}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-90"
                style={{
                  background: liked ? "var(--like)" : "rgba(28,28,32,0.85)",
                  border: liked ? "none" : "1.5px solid var(--like)",
                  color: liked ? "#0c0c0e" : "var(--like)",
                }}
              >
                <Heart size={16} fill={liked ? "currentColor" : "none"} />
              </button>
            </div>

            {/* Top-right — info button, with liked/in-pool dot indicator */}
            <div className="absolute top-2 right-2">
              <button
                onClick={() => onInfo(movie)}
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{ background: "rgba(12,12,14,0.7)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
              >
                <Info size={12} />
              </button>
              {/* Status dot */}
              {(liked || inPool) && (
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 flex items-center justify-center"
                  style={{
                    background: liked ? "var(--like)" : "var(--surface-2)",
                    borderColor: "var(--bg)",
                  }}
                />
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
