"use client";

import { useState } from "react";
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { Film } from "@/types";
import { DendyFilm } from "@/lib/dendy";
import { getService } from "@/lib/streaming";
import { posterUrl } from "@/lib/tmdb";
import { Info, Heart, X } from "lucide-react";

interface SwipeCardProps {
  film: Film;
  onLike: () => void;
  onDislike: () => void;
  onInfo: () => void;
  isTop: boolean;
  dendyInfo?: DendyFilm;
  sessionServices?: string[];
}

const SWIPE_THRESHOLD = 80;

export default function SwipeCard({ film, onLike, onDislike, onInfo, isTop, dendyInfo, sessionServices = [] }: SwipeCardProps) {
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

  const poster = posterUrl(film.poster_path, "original");

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
        {/* Poster image — blur-behind so the full poster is always visible */}
        <div className="absolute inset-0 overflow-hidden">
          {/* Blurred background fill (covers letterbox bars) */}
          <img
            src={poster}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{ filter: "blur(24px)", transform: "scale(1.15)", opacity: 0.7 }}
            draggable={false}
          />
          {/* Main poster — object-contain so nothing gets cropped */}
          <img
            src={poster}
            alt={film.title}
            className="relative w-full h-full object-contain pointer-events-none"
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
                      return p.logoPath ? (
                        <img
                          key={p.serviceId}
                          src={`https://image.tmdb.org/t/p/w45${p.logoPath}`}
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
                    <span className="text-xs font-medium leading-none"
                      style={{ color: "var(--accent)" }}>
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
            );
          })()}
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
