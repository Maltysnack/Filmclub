"use client";

import { useRef, useState } from "react";
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { Film } from "@/types";
import { posterUrl } from "@/lib/tmdb";
import { Info, Heart, X } from "lucide-react";

interface SwipeCardProps {
  film: Film;
  onLike: () => void;
  onDislike: () => void;
  onInfo: () => void;
  isTop: boolean;
}

const SWIPE_THRESHOLD = 80;

export default function SwipeCard({ film, onLike, onDislike, onInfo, isTop }: SwipeCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-18, 18]);
  const likeOpacity = useTransform(x, [20, 100], [0, 1]);
  const dislikeOpacity = useTransform(x, [-100, -20], [1, 0]);

  const [isDragging, setIsDragging] = useState(false);

  function handleDragEnd(_: unknown, info: PanInfo) {
    setIsDragging(false);
    if (info.offset.x > SWIPE_THRESHOLD) {
      onLike();
    } else if (info.offset.x < -SWIPE_THRESHOLD) {
      onDislike();
    }
  }

  const poster = posterUrl(film.poster_path, "w500");

  return (
    <motion.div
      className="absolute inset-0 select-none"
      style={{ x, rotate }}
      drag={isTop ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={handleDragEnd}
      whileTap={isTop ? { scale: 1.02 } : undefined}
      animate={isTop ? {} : { scale: 0.96, y: 12 }}
    >
      <div
        className="relative w-full h-full rounded-2xl overflow-hidden shadow-2xl drag-card"
        style={{ background: "var(--surface-2)" }}
      >
        {/* Poster image — zoomed 30% */}
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={poster}
            alt={film.title}
            className="w-full h-full object-cover pointer-events-none"
            style={{ transform: "scale(1.3)", transformOrigin: "center center" }}
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
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold leading-tight truncate" style={{ color: "var(--text)" }}>
                {film.title}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {film.release_year && (
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    {film.release_year}
                  </span>
                )}
                {film.rating && (
                  <span className="text-sm" style={{ color: "var(--accent)" }}>
                    ★ {film.rating}
                  </span>
                )}
                {film.genres?.[0] && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "var(--surface)", color: "var(--text-muted)" }}
                  >
                    {film.genres[0].name}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onInfo(); }}
              className="shrink-0 p-2 rounded-full transition-opacity"
              style={{ background: "rgba(28,28,32,0.8)", color: "var(--text-muted)" }}
            >
              <Info size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Tap buttons (shown only on top card, hidden while dragging) */}
      {isTop && !isDragging && (
        <div className="absolute -bottom-16 left-0 right-0 flex justify-center gap-6 pointer-events-none">
          <ActionButton onClick={onDislike} variant="dislike">
            <X size={24} />
          </ActionButton>
          <ActionButton onClick={onLike} variant="like">
            <Heart size={22} />
          </ActionButton>
        </div>
      )}
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
