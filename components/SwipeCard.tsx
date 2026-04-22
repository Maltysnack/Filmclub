"use client";

import { useState } from "react";
import { animate, motion, AnimatePresence, useMotionValue, useTransform, PanInfo, MotionValue } from "framer-motion";
import { Film } from "@/types";
import { DendyFilm } from "@/lib/dendy";
import { getService } from "@/lib/streaming";
import { posterUrl } from "@/lib/tmdb";
import { Heart, X } from "lucide-react";
import { useLongPress } from "@/hooks/useLongPress";
import DendyLogo from "./DendyLogo";
import { Participant } from "@/types";
import { participantColor } from "@/lib/names";

interface SwipeCardProps {
  film: Film;
  onLike: () => void;
  onDislike: () => void;
  onInfo: () => void;
  isTop: boolean;
  dendyInfo?: DendyFilm;
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

export default function SwipeCard({ film, onLike, onDislike, onInfo, isTop, dendyInfo, sessionServices = [], votePhase = 1, voteInfo, participants = [], onDragStart: onDragStartProp, onDragEnd: onDragEndProp, promotionMV }: SwipeCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-18, 18]);
  const likeOpacity = useTransform(x, [20, 100], [0, 1]);
  const dislikeOpacity = useTransform(x, [-100, -20], [1, 0]);

  // Back card promotion — driven by the front card's promotionMV.
  // fallback keeps hook call count stable (hooks can't be conditional).
  const promotionFallback = useMotionValue(0);
  const effectivePMV = promotionMV ?? promotionFallback;
  const backScale = useTransform(effectivePMV, [0, SWIPE_THRESHOLD], [0.98, 1.0]);
  const backY = useTransform(effectivePMV, [0, SWIPE_THRESHOLD], [4, 0]);

  const [isDragging, setIsDragging] = useState(false);
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
      onLike();
    } else if (isHorizontalEnough && info.offset.x < -SWIPE_THRESHOLD) {
      const yRatio = Math.max(-2, Math.min(2, info.offset.y / Math.abs(info.offset.x)));
      animate(y, 600 * yRatio, { duration: 0.2, ease: "easeOut" });
      await animate(x, -600, { duration: 0.2, ease: "easeOut" });
      onDislike();
    } else {
      // Sub-threshold or vertical-dominant — spring everything back to centre
      animate(x, 0, { type: "spring", stiffness: 500, damping: 35 });
      animate(y, 0, { type: "spring", stiffness: 500, damping: 35 });
      if (promotionMV) animate(promotionMV, 0, { type: "spring", stiffness: 500, damping: 35 });
    }
  }

  const poster = posterUrl(film.poster_path, "original");

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
        className="relative w-full h-full rounded-[28px] overflow-hidden shadow-2xl drag-card"
        style={{ background: "var(--surface-2)" }}
        {...lpHandlers}
      >
        {/* Poster image */}
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={poster}
            alt={film.title}
            className="w-full h-full object-cover pointer-events-none"
            draggable={false}
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
          {/* Where-to-watch badges — streaming logos left, Dendy right */}
          {(() => {
            const providers = film.watch_providers_au ?? [];
            const available = providers.filter((p) => sessionServices.includes(p.serviceId));
            if (!dendyInfo && available.length === 0) return null;
            return (
              <div className="flex items-start gap-3 mb-2">
                {/* Streaming service logos — only if film is on a selected service */}
                {available.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {available.slice(0, 4).map((p) => {
                      const svc = getService(p.serviceId);
                      if (!svc) return null;
                      // Use per-film logoPath, fall back to service's static logo
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
                )}
                {/* Dendy label + session times */}
                {dendyInfo && (
                  <div className={`flex flex-col gap-1 shrink-0 ${available.length > 0 ? "items-end ml-auto" : "items-start"}`}>
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
                    <img src="/imdb-logo.png" alt="IMDb" className="h-3" />
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
