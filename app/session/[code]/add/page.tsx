"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Search, Plus, Check } from "lucide-react";
import { searchFilms, getPopularFilms, posterUrl } from "@/lib/tmdb";
import { addFilmToSession, getSession, getParticipantId, getSessionFilms } from "@/lib/session";
import { TMDBMovie, Film } from "@/types";
import Logo from "@/components/Logo";

export default function AddFilmsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TMDBMovie[]>([]);
  const [popular, setPopular] = useState<TMDBMovie[]>([]);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [alreadyInPool, setAlreadyInPool] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");
      setSessionId(s.id);
      setParticipantId(pid);

      const pool = await getSessionFilms(s.id);
      setAlreadyInPool(new Set(pool.map((f: Film) => f.tmdb_id)));

      const pop = await getPopularFilms(1);
      setPopular(pop.slice(0, 20));
    }
    init();
  }, [code, router]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      setLoading(true);
      const res = await searchFilms(query);
      setResults(res.slice(0, 12));
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  async function handleAdd(movie: TMDBMovie) {
    if (!sessionId) return;
    setAddedIds((prev) => new Set([...prev, movie.id]));
    await addFilmToSession(sessionId, movie.id, participantId);
    setAlreadyInPool((prev) => new Set([...prev, movie.id]));
  }

  const displayList = query.trim() ? results : popular;

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
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
        <h1 className="text-base font-semibold" style={{ color: "var(--text)" }}>Add films</h1>
      </header>

      {/* Search */}
      <div className="px-5 mb-4 shrink-0">
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

      {/* Section label */}
      <p className="px-5 text-xs font-medium uppercase tracking-wider mb-3"
        style={{ color: "var(--text-muted)" }}>
        {query.trim() ? "Search results" : "Trending this week"}
      </p>

      {/* Film grid */}
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {loading && (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Searching…</p>
          </div>
        )}

        {!loading && displayList.length === 0 && query.trim() && (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>No results for &ldquo;{query}&rdquo;</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {displayList.map((movie) => {
            const inPool = alreadyInPool.has(movie.id);
            const justAdded = addedIds.has(movie.id);

            return (
              <motion.div
                key={movie.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative rounded-xl overflow-hidden"
                style={{ aspectRatio: "2/3", background: "var(--surface)" }}
              >
                <img
                  src={posterUrl(movie.poster_path, "w342")}
                  alt={movie.title}
                  className="w-full h-full object-cover"
                />
                {/* Overlay */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(to top, rgba(12,12,14,0.9) 0%, transparent 50%)",
                  }}
                />
                {/* Title */}
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <p className="text-xs font-medium leading-tight line-clamp-2"
                    style={{ color: "var(--text)" }}>
                    {movie.title}
                  </p>
                  {movie.release_date && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {movie.release_date.slice(0, 4)}
                    </p>
                  )}
                </div>
                {/* Add button */}
                <button
                  onClick={() => !inPool && handleAdd(movie)}
                  disabled={inPool}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center transition-all"
                  style={{
                    background: inPool ? "var(--like)" : "rgba(12,12,14,0.7)",
                    color: inPool ? "#0c0c0e" : "var(--text)",
                    border: inPool ? "none" : "1px solid var(--border)",
                  }}
                >
                  {inPool ? <Check size={14} /> : <Plus size={14} />}
                </button>
                {justAdded && !inPool && (
                  <motion.div
                    className="absolute inset-0 rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(74,222,128,0.2)" }}
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                  />
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
