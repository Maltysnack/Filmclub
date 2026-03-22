"use client";

import { useRef, useState, useCallback, useEffect } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSnapping = useRef(false);

  const snapToNearest = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cardHeight = el.clientHeight;
    if (cardHeight === 0) return;
    const index = Math.round(el.scrollTop / cardHeight);
    const target = index * cardHeight;
    if (Math.abs(el.scrollTop - target) < 2) return;
    isSnapping.current = true;
    el.scrollTo({ top: target, behavior: "smooth" });
    // Clear snapping flag after animation settles
    setTimeout(() => { isSnapping.current = false; }, 600);
  }, []);

  const handleScroll = useCallback(() => {
    if (isSnapping.current) return;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(snapToNearest, 120);
  }, [snapToNearest]);

  useEffect(() => {
    return () => { if (snapTimer.current) clearTimeout(snapTimer.current); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-y-scroll"
      style={{ scrollbarWidth: "none" }}
      onScroll={handleScroll}
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
    (p) => sessionServices.includes(p.serviceId)
  );

  return (
    <div
      className="relative w-full shrink-0 overflow-hidden"
      style={{ height: "100%" }}
      onClick={handleTap}
    >
      {/* Poster */}
      <img
        src={posterUrl(film.poster_path, "original")}
        alt={film.title}
        className="w-full h-full object-cover"
        draggable={false}
      />

      {/* Gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to top, rgba(12,12,14,0.95) 0%, rgba(12,12,14,0.3) 40%, transparent 70%)" }}
      />

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

      {/* Bottom info — matches SwipeCard layout */}
      <div className="absolute bottom-0 left-0 right-0 p-5 pointer-events-none">
        {/* Streaming + Dendy badges */}
        {(providers.length > 0 || dendyInfo) && (
          <div className="flex items-start gap-3 mb-2">
            {providers.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {providers.slice(0, 4).map((p) => {
                  const svc = getService(p.serviceId);
                  if (!svc) return null;
                  const logo = p.logoPath ?? (svc as typeof svc & { tmdbLogoPath: string | null }).tmdbLogoPath;
                  return logo ? (
                    <img key={p.serviceId} src={`https://image.tmdb.org/t/p/w45${logo}`}
                      alt={svc.name} title={svc.name}
                      className="w-6 h-6 rounded object-cover" />
                  ) : (
                    <span key={p.serviceId} className="text-xs px-1.5 py-0.5 rounded font-bold"
                      style={{ background: `${svc.color}30`, color: svc.color, border: `1px solid ${svc.color}50` }}>
                      {svc.abbrev}
                    </span>
                  );
                })}
              </div>
            )}
            {dendyInfo && (
              <div className={`flex flex-col gap-1 shrink-0 ${providers.length > 0 ? "items-end ml-auto" : "items-start"}`}>
                <span className="text-xs font-medium leading-none" style={{ color: "var(--accent)" }}>
                  🎬 Dendy Newtown{dendyInfo.tmdbMatch === "low" ? " ⚠️" : ""}
                </span>
                <div className="flex gap-1 flex-wrap">
                  {dendyInfo.sessionTimes.slice(0, 4).map((t) => (
                    <span key={t} className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ background: "rgba(232,184,109,0.2)", color: "var(--accent)", border: "1px solid rgba(232,184,109,0.3)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight truncate" style={{ color: "var(--text)" }}>
              {film.title}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              {film.release_year && (
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>{film.release_year}</span>
              )}
              {film.rating && (
                <span className="text-sm" style={{ color: "var(--accent)" }}>★ {film.rating}</span>
              )}
              {film.genres?.[0] && (
                <span className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                  {film.genres[0].name}
                </span>
              )}
            </div>
          </div>
          <button
            className="pointer-events-auto shrink-0 p-2 rounded-full transition-opacity"
            style={{ background: "rgba(28,28,32,0.8)", color: "var(--text-muted)" }}
            onClick={(e) => { e.stopPropagation(); onInfo(); }}
          >
            <Info size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
