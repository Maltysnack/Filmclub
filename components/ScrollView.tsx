"use client";

import { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Film } from "@/types";
import { DendyFilm } from "@/lib/dendy";
import { posterUrl } from "@/lib/tmdb";
import { getService } from "@/lib/streaming";
import { Heart, Info } from "lucide-react";

interface ScrollViewProps {
  films: Film[];
  likedIds: Set<string>;
  sessionServices: string[];
  dendyMap: Map<string, DendyFilm>;
  onLike: (film: Film) => void;
  onUnlike: (film: Film) => void;
  onInfo: (film: Film) => void;
}

export default function ScrollView({
  films, likedIds, sessionServices, dendyMap, onLike, onUnlike, onInfo,
}: ScrollViewProps) {
  return (
    <div
      className="w-full h-full overflow-y-scroll"
      style={{ scrollSnapType: "y mandatory", scrollbarWidth: "none" }}
    >
      {films.map((film) => (
        <FilmScrollCard
          key={film.id}
          film={film}
          liked={likedIds.has(film.id)}
          sessionServices={sessionServices}
          dendyInfo={dendyMap.get(film.id)}
          onLike={() => onLike(film)}
          onUnlike={() => onUnlike(film)}
          onInfo={() => onInfo(film)}
        />
      ))}
      {/* Bottom padding so last card doesn't feel cut off */}
      <div style={{ scrollSnapAlign: "start", height: "1px" }} />
    </div>
  );
}

function FilmScrollCard({
  film, liked, sessionServices, dendyInfo, onLike, onUnlike, onInfo,
}: {
  film: Film;
  liked: boolean;
  sessionServices: string[];
  dendyInfo?: DendyFilm;
  onLike: () => void;
  onUnlike: () => void;
  onInfo: () => void;
}) {
  const lastTap = useRef(0);
  const [heartBurst, setHeartBurst] = useState(false);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 350) {
      // Double tap
      if (liked) {
        onUnlike();
      } else {
        onLike();
        setHeartBurst(true);
        setTimeout(() => setHeartBurst(false), 700);
      }
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  }, [liked, onLike, onUnlike]);

  const providers = (film.watch_providers_au ?? []).filter(
    (p) => !sessionServices.length || sessionServices.includes(p.serviceId)
  );

  return (
    <div
      className="relative w-full shrink-0 overflow-hidden"
      style={{ height: "100%", scrollSnapAlign: "start" }}
      onClick={handleTap}
    >
      {/* Poster */}
      <img
        src={posterUrl(film.poster_path, "w500")}
        alt={film.title}
        className="w-full h-full object-cover"
        draggable={false}
      />

      {/* Gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to top, rgba(12,12,14,0.95) 0%, rgba(12,12,14,0.1) 55%, transparent 100%)" }}
      />

      {/* Info button — top right */}
      <button
        onClick={(e) => { e.stopPropagation(); onInfo(); }}
        className="absolute top-4 right-4 p-2 rounded-full"
        style={{ background: "rgba(0,0,0,0.55)", color: "var(--text)" }}
      >
        <Info size={16} />
      </button>

      {/* Liked badge — top left */}
      <AnimatePresence>
        {liked && (
          <motion.div
            className="absolute top-4 left-4 p-2 rounded-full"
            style={{ background: "var(--like)", color: "#0c0c0e" }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", damping: 15, stiffness: 300 }}
          >
            <Heart size={16} fill="currentColor" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Heart burst on double-tap */}
      <AnimatePresence>
        {heartBurst && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 1, scale: 0.4 }}
            animate={{ opacity: 0, scale: 1.6 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <Heart size={96} fill="var(--like)" color="var(--like)" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
        {/* Service logos */}
        {providers.length > 0 && (
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {dendyInfo && (
              <span className="text-xs px-2 py-0.5 rounded font-medium"
                style={{ background: "rgba(232,184,109,0.2)", color: "var(--accent)" }}>
                🎬 Dendy
              </span>
            )}
            {providers.map((p) => {
              const svc = getService(p.serviceId);
              if (!svc) return null;
              const lp = p.logoPath ?? (svc as typeof svc & { tmdbLogoPath?: string | null }).tmdbLogoPath;
              return lp ? (
                <img key={p.serviceId} src={`https://image.tmdb.org/t/p/w45${lp}`}
                  alt={svc.name} title={svc.name}
                  className="w-6 h-6 rounded object-cover" />
              ) : (
                <span key={p.serviceId} className="text-xs px-1.5 py-0.5 rounded font-bold"
                  style={{ background: `${svc.color}25`, color: svc.color }}>
                  {svc.abbrev}
                </span>
              );
            })}
          </div>
        )}

        <h2 className="text-xl font-bold leading-tight mb-1" style={{ color: "var(--text)" }}>
          {film.title}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {film.release_year && (
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>{film.release_year}</span>
          )}
          {film.runtime && (
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {Math.floor(film.runtime / 60)}h {film.runtime % 60}m
            </span>
          )}
          {film.rating && (
            <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>★ {film.rating}</span>
          )}
        </div>
        <p className="text-xs mt-1 line-clamp-2 leading-relaxed" style={{ color: "var(--text-muted)", opacity: 0.85 }}>
          {film.overview}
        </p>

        {/* Double-tap hint — only show on first render */}
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)", opacity: 0.5 }}>
          Double-tap to like · Scroll to browse
        </p>
      </div>
    </div>
  );
}
