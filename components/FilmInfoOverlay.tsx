"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Film } from "@/types";
import { DendyFilm } from "@/lib/dendy";
import { posterUrl } from "@/lib/tmdb";
import FilmInfoPanel from "./FilmInfoPanel";
import { X } from "lucide-react";

interface FilmInfoOverlayProps {
  film: Film | null;
  onClose: () => void;
  onLike?: () => void;
  onDislike?: () => void;
  sessionServices: string[];
  dendyInfo?: DendyFilm;
}

export default function FilmInfoOverlay({
  film, onClose, onLike, onDislike, sessionServices, dendyInfo,
}: FilmInfoOverlayProps) {
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

          {/* ── Mobile: full-screen vertical stack ───────────────────────── */}
          <motion.div
            className="fixed inset-0 z-50 flex flex-col md:hidden"
            style={{ background: "var(--surface)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Poster — top 45% */}
            <div className="relative shrink-0 overflow-hidden" style={{ height: "45dvh" }}>
              <img
                src={posterUrl(film.backdrop_path ?? film.poster_path, "w780")}
                alt={film.title}
                className="w-full h-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{ background: "linear-gradient(to top, var(--surface) 0%, transparent 60%)" }}
              />
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-full"
                style={{ background: "rgba(0,0,0,0.55)", color: "var(--text)" }}
              >
                <X size={18} />
              </button>
              {/* Drag handle */}
              <div className="absolute top-3 left-0 right-0 flex justify-center">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
              </div>
            </div>

            {/* Info panel — scrollable bottom */}
            <div className="flex-1 overflow-hidden">
              <FilmInfoPanel
                film={film}
                onClose={onClose}
                onLike={onLike}
                onDislike={onDislike}
                sessionServices={sessionServices}
                dendyInfo={dendyInfo}
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
          >
            <div
              className="flex gap-3 w-full"
              style={{ maxWidth: 920, height: "min(calc(100dvh - 120px), 520px)" }}
            >
              {/* Poster card */}
              <div
                className="relative rounded-2xl overflow-hidden shrink-0"
                style={{ width: "calc(50% - 6px)", height: "100%" }}
              >
                <img
                  src={posterUrl(film.poster_path, "w500")}
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
                className="rounded-2xl overflow-hidden shrink-0 flex flex-col"
                style={{ width: "calc(50% - 6px)", height: "100%", background: "var(--surface)" }}
              >
                <FilmInfoPanel
                  film={film}
                  onClose={onClose}
                  onLike={onLike}
                  onDislike={onDislike}
                  sessionServices={sessionServices}
                  dendyInfo={dendyInfo}
                />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
