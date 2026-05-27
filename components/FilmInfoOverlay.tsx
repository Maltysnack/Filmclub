"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import { Film } from "@/types";
import { posterUrl } from "@/lib/tmdb";
import FilmInfoPanel from "./FilmInfoPanel";
import { X } from "lucide-react";

interface FilmInfoOverlayProps {
  film: Film | null;
  onClose: () => void;
  onLike?: () => void;
  onDislike?: () => void;
  sessionServices: string[];
}

export default function FilmInfoOverlay({
  film, onClose, onLike, onDislike, sessionServices,
}: FilmInfoOverlayProps) {
  // Motion value drives the mobile sheet's vertical position.
  // The poster area acts as a drag handle — dragging it moves the whole sheet.
  // This avoids scroll conflicts with the cast list below.
  const sheetY = useMotionValue(0);
  const posterRef = useRef<HTMLDivElement>(null);

  // Lock body scroll while overlay is open
  useEffect(() => {
    if (film) {
      document.body.style.overflow = "hidden";
      // Reset sheet position whenever a new film opens
      sheetY.set(0);
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [film, sheetY]);

  function handleDragEnd(_: unknown, info: { offset: { y: number }; velocity: { y: number } }) {
    if (info.offset.y > 120 || info.velocity.y > 600) {
      // Fly the sheet off-screen at natural velocity, then close
      animate(sheetY, window.innerHeight, {
        duration: 0.25,
        ease: [0.32, 0, 0.67, 0],
      }).then(() => onClose());
    } else {
      // Snap back
      animate(sheetY, 0, { type: "spring", stiffness: 400, damping: 35 });
    }
  }

  return (
    <AnimatePresence>
      {film && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.75)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* ── Mobile: full-screen sheet, slides up from bottom ─────────── */}
          <motion.div
            className="fixed inset-0 z-50 flex flex-col md:hidden"
            style={{ background: "var(--surface)", y: sheetY }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Poster — the drag handle. dragConstraints={posterRef} self-constrains
                so the poster element barely moves visually while the sheet (sheetY) slides. */}
            <motion.div
              ref={posterRef}
              className="relative shrink-0 overflow-hidden"
              // #120: cap absolute height so on short/landscape viewports (iPad-ish)
              // the poster doesn't dominate. 45dvh is fine on tall phones (~360-400px),
              // but 45dvh on landscape iPad ≈ 360px in a 1366×900 viewport — still
              // visually OK, just makes sure we never exceed 450px.
              style={{ height: "min(45dvh, 450px)" }}
              drag="y"
              dragConstraints={posterRef}
              dragElastic={{ top: 0, bottom: 0.4 }}
              onDrag={(_: unknown, info: { offset: { y: number } }) => {
                sheetY.set(Math.max(0, info.offset.y));
              }}
              onDragEnd={handleDragEnd}
            >
              <img
                src={posterUrl(film.backdrop_path ?? film.poster_path, "w1280")}
                alt={film.title}
                className="w-full h-full object-cover"
                draggable={false}
              />
              <div
                className="absolute inset-0"
                style={{ background: "linear-gradient(to top, var(--surface) 0%, transparent 60%)" }}
              />
              {/* X button — only one on mobile, lives here in the poster */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-full"
                style={{ background: "rgba(0,0,0,0.55)", color: "var(--text)" }}
              >
                <X size={18} />
              </button>
              {/* Drag handle indicator */}
              <div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.3)" }} />
              </div>
            </motion.div>

            {/* Info panel — hideClose removes the duplicate X button */}
            <div className="flex-1 overflow-hidden">
              <FilmInfoPanel
                film={film}
                onClose={onClose}
                onLike={onLike}
                onDislike={onDislike}
                sessionServices={sessionServices}
                hideClose={true}
              />
            </div>
          </motion.div>

          {/* ── Desktop: side-by-side overlay ────────────────────────────── */}
          <motion.div
            className="fixed inset-0 z-50 hidden md:flex items-center justify-center px-5"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            onClick={onClose}
          >
            <div
              className="flex items-stretch gap-0 w-full"
              style={{ maxWidth: 920, height: "min(calc(100dvh - 120px), 520px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Poster card */}
              <div
                className="relative rounded-2xl overflow-hidden shrink-0"
                style={{ width: "calc(60% - 6px)", position: "relative", zIndex: 1 }}
              >
                <img
                  src={posterUrl(film.backdrop_path ?? film.poster_path, "w1280")}
                  alt={film.title}
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0"
                  style={{ background: "linear-gradient(to top, rgba(12,12,14,0.85) 0%, transparent 50%)" }}
                />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <p className="text-base font-semibold leading-tight" style={{ color: "var(--text)" }}>
                    {film.title}
                  </p>
                  {film.release_year && (
                    <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>{film.release_year}</p>
                  )}
                </div>
              </div>

              {/* Info panel */}
              <div
                className="overflow-hidden shrink-0 flex flex-col"
                style={{ width: "calc(40% - 6px)", background: "var(--surface)", boxShadow: "-100px 0 0 var(--surface)", borderRadius: "0 16px 16px 0", position: "relative", zIndex: 0 }}
              >
                <FilmInfoPanel
                  film={film}
                  onClose={onClose}
                  onLike={onLike}
                  onDislike={onDislike}
                  sessionServices={sessionServices}
                />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
