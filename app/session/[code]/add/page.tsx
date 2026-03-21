"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Search, Plus, Check, Heart, Trophy, SlidersHorizontal } from "lucide-react";
import { searchFilms, getPopularFilms, getTrendingFilms, getTopRatedFilms, posterUrl } from "@/lib/tmdb";
import { addFilmToSession, getSession, getParticipantId, getSessionFilms, recordSwipe } from "@/lib/session";
import { TMDBMovie, Film } from "@/types";
import Logo from "@/components/Logo";

export default function AddFilmsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [trending, setTrending] = useState<TMDBMovie[]>([]);
  const [topRated, setTopRated] = useState<TMDBMovie[]>([]);
  const [alreadyInPool, setAlreadyInPool] = useState<Set<number>>(new Set());
  const [likedByMe, setLikedByMe] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participantId, setParticipantIdState] = useState<string | null>(null);
  const [filmIdMap, setFilmIdMap] = useState<Map<number, string>>(new Map()); // tmdbId -> db film.id

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");
      setSessionId(s.id);
      setParticipantIdState(pid);

      const pool = await getSessionFilms(s.id);
      setAlreadyInPool(new Set(pool.map((f: Film) => f.tmdb_id)));
      const idMap = new Map(pool.map((f: Film) => [f.tmdb_id, f.id]));
      setFilmIdMap(idMap);

      const [trendingData, topRatedData] = await Promise.all([
        getTrendingFilms(5),    // 5 pages = ~100 films
        getTopRatedFilms(3),    // 3 pages = ~60 films
      ]);
      setTrending(trendingData);
      setTopRated(topRatedData);
    }
    init();
  }, [code, router]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      setLoading(true);
      const res = await searchFilms(query);
      setResults(res.slice(0, 20));
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  async function handleAdd(movie: TMDBMovie, andLike = false) {
    if (!sessionId || !participantId) return;

    // Optimistically mark as in pool
    setAlreadyInPool((prev) => new Set([...prev, movie.id]));

    const success = await addFilmToSession(sessionId, movie.id, participantId);
    if (!success) return;

    // Fetch the film's db id so we can record the swipe
    const pool = await getSessionFilms(sessionId);
    const added = pool.find((f) => f.tmdb_id === movie.id);
    if (added) {
      setFilmIdMap((prev) => new Map([...prev, [movie.id, added.id]]));

      // Auto-like when the user adds a film
      await recordSwipe(sessionId, participantId, added.id, true);
      setLikedByMe((prev) => new Set([...prev, movie.id]));
    }
  }

  async function handleLike(movie: TMDBMovie) {
    if (!sessionId || !participantId) return;

    if (!alreadyInPool.has(movie.id)) {
      // Add first, which auto-likes
      await handleAdd(movie, true);
    } else {
      // Already in pool — just record a like
      const filmId = filmIdMap.get(movie.id);
      if (filmId) {
        await recordSwipe(sessionId, participantId, filmId, true);
        setLikedByMe((prev) => new Set([...prev, movie.id]));
      }
    }
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
        <button onClick={() => router.push(`/session/${code}/results`)}
          className="p-2 rounded-lg"
          style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
          <Trophy size={18} />
        </button>
      </header>

      {/* Search */}
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {/* Search results */}
        {showSearch && (
          <section className="px-5">
            {loading && (
              <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>Searching…</p>
            )}
            {!loading && results.length === 0 && (
              <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
                No results for &ldquo;{query}&rdquo;
              </p>
            )}
            <FilmGrid films={results} alreadyInPool={alreadyInPool} likedByMe={likedByMe}
              onAdd={handleAdd} onLike={handleLike} />
          </section>
        )}

        {/* Trending */}
        {!showSearch && (
          <>
            <section className="px-5 mb-8">
              <p className="text-xs font-medium uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}>
                Trending this week
              </p>
              <FilmGrid films={trending} alreadyInPool={alreadyInPool} likedByMe={likedByMe}
                onAdd={handleAdd} onLike={handleLike} />
            </section>

            <section className="px-5">
              <p className="text-xs font-medium uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}>
                All-time popular
              </p>
              <FilmGrid films={topRated} alreadyInPool={alreadyInPool} likedByMe={likedByMe}
                onAdd={handleAdd} onLike={handleLike} />
            </section>
          </>
        )}
      </div>
    </div>
    </div>
  );
}

function FilmGrid({
  films, alreadyInPool, likedByMe, onAdd, onLike,
}: {
  films: TMDBMovie[];
  alreadyInPool: Set<number>;
  likedByMe: Set<number>;
  onAdd: (m: TMDBMovie) => void;
  onLike: (m: TMDBMovie) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {films.map((movie) => {
        const inPool = alreadyInPool.has(movie.id);
        const liked = likedByMe.has(movie.id);

        return (
          <motion.div
            key={movie.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative rounded-xl overflow-hidden group"
            style={{ aspectRatio: "2/3", background: "var(--surface)" }}
          >
            <img
              src={posterUrl(movie.poster_path, "w500")}
              alt={movie.title}
              className="w-full h-full object-cover"
            />

            {/* Gradient */}
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

            {/* Hover overlay with like + add buttons */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              style={{ background: "rgba(12,12,14,0.55)" }}
            >
              {/* Like button */}
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

            {/* Top-right status badge */}
            <div className="absolute top-2 right-2">
              {liked ? (
                <div className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "var(--like)" }}>
                  <Heart size={12} fill="#0c0c0e" color="#0c0c0e" />
                </div>
              ) : inPool ? (
                <div className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(28,28,32,0.85)", border: "1.5px solid var(--border)" }}>
                  <Check size={12} style={{ color: "var(--text-muted)" }} />
                </div>
              ) : (
                <button
                  onClick={() => onAdd(movie)}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(12,12,14,0.7)", border: "1px solid var(--border)", color: "var(--text)" }}
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
