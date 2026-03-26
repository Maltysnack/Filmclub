"use client";

import { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Film } from "@/types";
import { DendyFilm } from "@/lib/dendy";
import { posterUrl } from "@/lib/tmdb";
import { getService } from "@/lib/streaming";
import { Heart, Info } from "lucide-react";
import DendyLogo from "./DendyLogo";
import { Participant } from "@/types";
import { participantColor } from "@/lib/names";

// Visual gap between cards (px) — increase to taste
const GAP = 16;
// Card corner radius — must match SwipeCard (rounded-[28px])
const CARD_RADIUS = 28;

interface ScrollViewProps {
  films: Film[];
  likedIds: Set<string>;
  sessionServices: string[];
  dendyMap: Map<string, DendyFilm>;
  onLike: (film: Film) => void;
  onUnlike: (film: Film) => void;
  onInfo: (film: Film) => void;
  votePhase?: 1 | 2 | 3;
  filmLikes?: Map<string, string[]>;
  participants?: Participant[];
  myParticipantId?: string;
  onIndexChange?: (index: number) => void;
  initialIndex?: number;
}

export interface ScrollViewHandle {
  scrollToIndex: (i: number) => void;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const ScrollView = forwardRef<ScrollViewHandle, ScrollViewProps>(function ScrollView({
  films, likedIds, sessionServices, dendyMap, onLike, onUnlike, onInfo,
  votePhase = 1, filmLikes, participants = [], myParticipantId, onIndexChange,
  initialIndex = 0,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSnapping = useRef(false);
  const [containerHeight, setContainerHeight] = useState(0);
  const initialIndexApplied = useRef(false);

  // Track container height so cards can be sized correctly
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Whether touch/pointer is currently active (mobile finger OR mouse button held)
  const touching = useRef(false);
  // Whether wheel events are actively firing (trackpad two-finger scroll on desktop)
  const wheeling = useRef(false);
  const wheelEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Custom 2s ease-in-out snap animation
  const animateScroll = useCallback((target: number) => {
    const el = containerRef.current;
    if (!el) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const start = el.scrollTop;
    const distance = target - start;
    if (Math.abs(distance) < 2) { isSnapping.current = false; return; }
    const duration = 2000;
    const startTime = performance.now();

    function step(now: number) {
      const progress = Math.min((now - startTime) / duration, 1);
      el!.scrollTop = start + distance * easeInOutCubic(progress);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        isSnapping.current = false;
      }
    }
    rafRef.current = requestAnimationFrame(step);
  }, []);

  // Slot height = card + gap (fills full container height)
  const slotHeight = containerHeight > 0 ? containerHeight : 0;

  // Jump to initialIndex the first time slotHeight becomes valid (no animation)
  useEffect(() => {
    if (slotHeight > 0 && !initialIndexApplied.current && initialIndex > 0) {
      initialIndexApplied.current = true;
      const el = containerRef.current;
      if (el) el.scrollTop = initialIndex * slotHeight;
    }
  }, [slotHeight, initialIndex]);

  const snapToNearest = useCallback(() => {
    const el = containerRef.current;
    if (!el || slotHeight === 0) return;
    const index = Math.round(el.scrollTop / slotHeight);
    isSnapping.current = true;
    animateScroll(index * slotHeight);
    onIndexChange?.(index);
  }, [slotHeight, animateScroll, onIndexChange]);

  // Expose scrollToIndex so the parent can sync position when switching modes
  useImperativeHandle(ref, () => ({
    scrollToIndex(i: number) {
      const el = containerRef.current;
      if (!el) return;
      // Use instant scroll if slotHeight is ready, else defer one frame
      if (slotHeight > 0) {
        el.scrollTop = i * slotHeight;
      } else {
        requestAnimationFrame(() => { el.scrollTop = i * slotHeight; });
      }
    },
  }), [slotHeight]);

  // While finger is down: cancel any pending snap
  const handleTouchStart = useCallback(() => {
    touching.current = true;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); isSnapping.current = false; }
  }, []);

  // When finger lifts: start the snap timer (handles both still and flick)
  const handleTouchEnd = useCallback(() => {
    touching.current = false;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(snapToNearest, 130);
  }, [snapToNearest]);

  // Wheel = Mac trackpad two-finger scroll (touch events don't fire on desktop).
  // Each wheel event means the user is actively in control — cancel any pending snap.
  // 200ms after the last wheel event we assume they've stopped and snap.
  const handleWheel = useCallback(() => {
    if (isSnapping.current) { cancelAnimationFrame(rafRef.current!); isSnapping.current = false; }
    wheeling.current = true;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    if (wheelEndTimer.current) clearTimeout(wheelEndTimer.current);
    wheelEndTimer.current = setTimeout(() => {
      wheeling.current = false;
      snapToNearest();
    }, 200);
  }, [snapToNearest]);

  // Scroll events: only used to re-debounce during momentum after touch lift
  const handleScroll = useCallback(() => {
    if (isSnapping.current || touching.current || wheeling.current) return;
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(snapToNearest, 130);
  }, [snapToNearest]);

  useEffect(() => {
    return () => {
      if (snapTimer.current) clearTimeout(snapTimer.current);
      if (wheelEndTimer.current) clearTimeout(wheelEndTimer.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Card fills the slot minus the gap strip at the bottom
  const cardHeight = slotHeight > 0 ? slotHeight - GAP : 0;

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-y-scroll"
      style={{ scrollbarWidth: "none" }}
      onScroll={handleScroll}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {films.map((film) => (
        // Slot — determines snap unit
        <div key={film.id} style={{ height: slotHeight || "100%" }}>
          {/* Card — slightly shorter than slot to create gap + peek */}
          <div style={{ height: cardHeight || `calc(100% - ${GAP}px)`, borderRadius: CARD_RADIUS, overflow: "hidden" }}>
            <FilmScrollCard
              film={film}
              liked={likedIds.has(film.id)}
              sessionServices={sessionServices}
              dendyInfo={dendyMap.get(film.id)}
              onLike={() => onLike(film)}
              onUnlike={() => onUnlike(film)}
              onInfo={() => onInfo(film)}
              votePhase={votePhase}
              likedByIds={(filmLikes?.get(film.id) ?? []).filter(id => id !== myParticipantId)}
              participants={participants}
            />
          </div>
        </div>
      ))}
    </div>
  );
});

export default ScrollView;

function FilmScrollCard({
  film, liked, sessionServices, dendyInfo, onLike, onUnlike, onInfo,
  votePhase = 1, likedByIds = [], participants = [],
}: {
  film: Film;
  liked: boolean;
  sessionServices: string[];
  dendyInfo?: DendyFilm;
  onLike: () => void;
  onUnlike: () => void;
  onInfo: () => void;
  votePhase?: 1 | 2 | 3;
  likedByIds?: string[];
  participants?: Participant[];
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
      className="relative w-full h-full overflow-hidden"
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

      {/* Bottom info — matches SwipeCard layout exactly */}
      <div className="absolute bottom-0 left-0 right-0 p-5 pointer-events-none">
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
                <span className="flex items-center gap-1 leading-none">
                  <DendyLogo height={12} />
                  {dendyInfo.tmdbMatch === "low" && <span style={{ color: "var(--accent)" }}>⚠️</span>}
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

        {/* Vote info — appears once phase threshold is reached */}
        {votePhase >= 2 && likedByIds.length > 0 && (
          <div className="flex items-center gap-1 mb-2">
            {votePhase === 2 ? (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(74,222,128,0.12)", color: "var(--like)" }}>
                <Heart size={9} fill="currentColor" />
                {likedByIds.length}
              </span>
            ) : (
              <div className="flex items-center gap-1">
                {likedByIds.map((id) => {
                  const p = participants.find((pt) => pt.id === id);
                  if (!p) return null;
                  const color = participantColor(p.name);
                  return (
                    <span key={id}
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
                      {p.name}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight truncate" style={{ color: "var(--text)" }}>
              {film.title}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {film.release_year && (
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>{film.release_year}</span>
              )}
              {film.imdb_rating && (
                <span className="flex items-center gap-1 text-sm" style={{ color: "#F5C518" }}>
                  <img src="/imdb-logo.png" alt="IMDb" className="h-3" />
                  {film.imdb_rating}
                </span>
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
            className="pointer-events-auto shrink-0 p-2 rounded-full"
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
