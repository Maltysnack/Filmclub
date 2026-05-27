"use client";

import { useState } from "react";
import NextImage from "next/image";
import { animate, motion, AnimatePresence, useMotionValue, useTransform, PanInfo, MotionValue } from "framer-motion";
import { Film } from "@/types";
import { getService } from "@/lib/streaming";
import { posterUrl } from "@/lib/tmdb";
import { Heart, X } from "lucide-react";
import { useLongPress } from "@/hooks/useLongPress";
import ParticipantPill from "./ParticipantPill";
import { Participant } from "@/types";

interface SwipeCardProps {
  film: Film;
  onLike: () => void;
  onDislike: () => void;
  onInfo: () => void;
  isTop: boolean;
  sessionServices?: string[];
  votePhase?: 1 | 2 | 3;
  voteInfo?: { count: number; participantIds: string[] };
  participants?: Participant[];
  onDragStart?: () => void;
  onDragEnd?: () => void;
  // Shared motion value: front card writes to it during drag, back card reads from it
  // to smoothly promote itself as the front card moves away.
  promotionMV?: MotionValue<number>;
}

const SWIPE_THRESHOLD = 80;

// Module-level set of poster URLs known to have loaded in this session. New
// SwipeCard instances consult this before the cache probe — if a poster has
// already rendered once during the page lifetime, we trust it's still cached
// and skip the opacity-0 → opacity-1 fade-in. This eliminates the "card
// flashes then comes back" effect that #77 reports: the old front card's
// poster image was decoded, but a fresh SwipeCard mounts as a different
// React instance (different `key`) and resets posterLoaded, even though the
// browser already has the bytes. The set is intentionally never cleared —
// memory cost is one ~80-byte URL per poster, capped by the deck size.
const loadedPosters = new Set<string>();

export default function SwipeCard({ film, onLike, onDislike, onInfo, isTop, sessionServices = [], votePhase = 1, voteInfo, participants = [], onDragStart: onDragStartProp, onDragEnd: onDragEndProp, promotionMV }: SwipeCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-18, 18]);
  // #119: stamps reach full visibility by ~50px so users get unambiguous
  // commit-intent feedback well before the 80px SWIPE_THRESHOLD. Previously
  // peaked at 100px (after the commit), making them feel reactive rather
  // than predictive.
  const likeOpacity = useTransform(x, [15, 50], [0, 1]);
  const dislikeOpacity = useTransform(x, [-50, -15], [1, 0]);

  // Back card promotion — driven by the front card's promotionMV.
  // fallback keeps hook call count stable (hooks can't be conditional).
  const promotionFallback = useMotionValue(0);
  const effectivePMV = promotionMV ?? promotionFallback;
  const backScale = useTransform(effectivePMV, [0, SWIPE_THRESHOLD], [0.98, 1.0]);
  const backY = useTransform(effectivePMV, [0, SWIPE_THRESHOLD], [4, 0]);

  const [isDragging, setIsDragging] = useState(false);
  // Seed from browser cache state so cached posters skip the 300ms fade-in.
  // Without this, every new top card flashes during a swipe — back card was
  // already in cache, but a fresh SwipeCard mount resets posterLoaded.
  const poster = posterUrl(film.poster_path, "w780");
  const [posterLoaded, setPosterLoaded] = useState(() => {
    if (typeof window === "undefined") return false;
    if (loadedPosters.has(poster)) return true;
    const probe = new Image();
    probe.src = poster;
    return probe.complete;
  });
  const { handlers: lpHandlers, cancel: cancelLongPress } = useLongPress(onInfo);

  async function handleDragEnd(_: unknown, info: PanInfo) {
    setIsDragging(false);
    onDragEndProp?.();

    const xAbs = Math.abs(info.offset.x);
    const yAbs = Math.abs(info.offset.y);
    // Block nearly-vertical drags where x drift is incidental rather than
    // deliberate. x must be at least half of y (~63° from horizontal), so
    // equal down+right (45°) registers as a swipe but an 80% vertical drag
    // does not. Pure horizontal swipes always pass (yAbs is small or zero).
    const isHorizontalEnough = xAbs * 2 > yAbs;

    if (isHorizontalEnough && info.offset.x > SWIPE_THRESHOLD) {
      // Fly off at the angle the card was dragged (capped to avoid extreme diagonals)
      const yRatio = Math.max(-2, Math.min(2, info.offset.y / info.offset.x));
      animate(y, 600 * yRatio, { duration: 0.2, ease: "easeOut" });
      await animate(x, 600, { duration: 0.2, ease: "easeOut" });
      // #119: brief haptic confirms commit on supported devices (Android, some iOS).
      // Optional-chained because vibrate() is undefined on iOS Safari + desktop.
      navigator.vibrate?.(20);
      onLike();
    } else if (isHorizontalEnough && info.offset.x < -SWIPE_THRESHOLD) {
      const yRatio = Math.max(-2, Math.min(2, info.offset.y / Math.abs(info.offset.x)));
      animate(y, 600 * yRatio, { duration: 0.2, ease: "easeOut" });
      await animate(x, -600, { duration: 0.2, ease: "easeOut" });
      navigator.vibrate?.(20);
      onDislike();
    } else {
      // Sub-threshold or vertical-dominant — spring everything back to centre
      animate(x, 0, { type: "spring", stiffness: 500, damping: 35 });
      animate(y, 0, { type: "spring", stiffness: 500, damping: 35 });
      if (promotionMV) animate(promotionMV, 0, { type: "spring", stiffness: 500, damping: 35 });
    }
  }

  return (
    <motion.div
      className="absolute inset-0 select-none"
      style={isTop ? { x, y, rotate } : { scale: backScale, y: backY }}
      drag={isTop ? true : false}
      dragMomentum={false}
      onDrag={isTop ? (_e, info) => { promotionMV?.set(Math.abs(info.offset.x)); } : undefined}
      onDragStart={() => { setIsDragging(true); cancelLongPress(); onDragStartProp?.(); }}
      onDragEnd={handleDragEnd}
      whileTap={isTop ? { scale: 1.02 } : undefined}
    >
      <div
        className="relative w-full h-full rounded-[24px] md:rounded-[28px] overflow-hidden shadow-2xl drag-card"
        style={{ background: "var(--surface-2)" }}
        {...lpHandlers}
      >
        {/* Poster image — fades in once loaded so the dark placeholder feels intentional */}
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={poster}
            alt={film.title}
            className="w-full h-full object-cover pointer-events-none transition-opacity duration-300"
            style={{ opacity: posterLoaded ? 1 : 0 }}
            draggable={false}
            onLoad={() => { loadedPosters.add(poster); setPosterLoaded(true); }}
          />
          {/* Gradient overlay at bottom */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(12,12,14,0.95) 0%, rgba(12,12,14,0.3) 40%, transparent 70%)",
            }}
          />
        </div>

        {/* Like overlay */}
        <motion.div
          className="absolute inset-0 like-overlay rounded-2xl pointer-events-none"
          style={{ opacity: likeOpacity }}
        />

        {/* Dislike overlay */}
        <motion.div
          className="absolute inset-0 pointer-events-none rounded-2xl"
          style={{
            opacity: dislikeOpacity,
            background: "linear-gradient(225deg, transparent 0%, rgba(248,113,113,0.35) 100%)",
          }}
        />

        {/* Like / dislike stamps */}
        <motion.div
          className="absolute top-8 left-6 px-3 py-1.5 rounded-lg border-2 font-bold text-lg tracking-widest rotate-[-20deg]"
          style={{
            opacity: likeOpacity,
            borderColor: "var(--like)",
            color: "var(--like)",
            background: "rgba(12,12,14,0.5)",
          }}
        >
          LIKE
        </motion.div>
        <motion.div
          className="absolute top-8 right-6 px-3 py-1.5 rounded-lg border-2 font-bold text-lg tracking-widest rotate-[20deg]"
          style={{
            opacity: dislikeOpacity,
            borderColor: "var(--dislike)",
            color: "var(--dislike)",
            background: "rgba(12,12,14,0.5)",
          }}
        >
          NOPE
        </motion.div>

        {/* Film info at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-5">
          {/* Streaming service logos */}
          {(() => {
            const providers = film.watch_providers_au ?? [];
            const available = providers.filter((p) => sessionServices.includes(p.serviceId));
            if (available.length === 0) return null;
            return (
              <div className="flex items-center gap-1.5 flex-wrap mb-2">
                {available.slice(0, 4).map((p) => {
                  const svc = getService(p.serviceId);
                  if (!svc) return null;
                  const logo = p.logoPath ?? (svc as typeof svc & { tmdbLogoPath: string | null }).tmdbLogoPath;
                  return logo ? (
                    <img
                      key={p.serviceId}
                      src={`https://image.tmdb.org/t/p/w45${logo}`}
                      alt={svc.name}
                      title={svc.name}
                      className="w-6 h-6 rounded object-cover"
                    />
                  ) : (
                    <span key={p.serviceId} className="text-xs px-1.5 py-0.5 rounded font-bold"
                      style={{ background: `${svc.color}30`, color: svc.color, border: `1px solid ${svc.color}50` }}>
                      {svc.abbrev}
                    </span>
                  );
                })}
              </div>
            );
          })()}
          {/* Vote info — appears once phase threshold is reached */}
          {votePhase >= 2 && voteInfo && voteInfo.count > 0 && (
            <div className="flex items-center gap-1 mb-2">
              {votePhase === 2 ? (
                <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(74,222,128,0.12)", color: "var(--like)" }}>
                  <Heart size={9} fill="currentColor" />
                  {voteInfo.count}
                </span>
              ) : (
                <div className="flex items-center gap-1 flex-wrap">
                  {voteInfo.participantIds.map((id) => {
                    const p = participants.find((pt) => pt.id === id);
                    if (!p) return null;
                    return <ParticipantPill key={id} name={p.name} size="sm" />;
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold leading-tight truncate" style={{ color: "var(--text)" }}>
                {film.title}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {film.release_year && (
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {film.release_year}
                  </span>
                )}
                {film.imdb_rating ? (
                  <a
                    href={`https://www.imdb.com/title/${film.imdb_id}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-sm"
                    style={{ color: "#F5C518" }}
                  >
                    <NextImage src="/imdb-logo.png" alt="IMDb" width={24} height={24} className="h-3 w-auto" />
                    {film.imdb_rating}
                  </a>
                ) : film.release_year === new Date().getFullYear() ? (
                  film.imdb_id ? (
                    <a
                      href={`https://www.imdb.com/title/${film.imdb_id}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "rgba(255,255,255,0.12)", color: "var(--text-muted)" }}>
                      New
                    </a>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "rgba(255,255,255,0.12)", color: "var(--text-muted)" }}>
                      New
                    </span>
                  )
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tap buttons (shown only on top card, hidden while dragging) */}
      <AnimatePresence>
        {isTop && !isDragging && (
          <motion.div
            className="absolute bottom-0 left-0 right-0 flex justify-center gap-6 pointer-events-none translate-y-1/2"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <ActionButton onClick={onDislike} variant="dislike">
              <X size={24} />
            </ActionButton>
            <ActionButton onClick={onLike} variant="like">
              <Heart size={22} />
            </ActionButton>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActionButton({
  onClick,
  variant,
  children,
}: {
  onClick: () => void;
  variant: "like" | "dislike";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
      style={{
        background: "var(--surface-2)",
        border: `2px solid ${variant === "like" ? "var(--like)" : "var(--dislike)"}`,
        color: variant === "like" ? "var(--like)" : "var(--dislike)",
      }}
    >
      {children}
    </button>
  );
}
