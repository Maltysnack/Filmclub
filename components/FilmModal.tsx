"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Film } from "@/types";
import { posterUrl } from "@/lib/tmdb";
import { X, Clock, Star } from "lucide-react";

interface FilmModalProps {
  film: Film | null;
  onClose: () => void;
  onLike?: () => void;
  onDislike?: () => void;
}

export default function FilmModal({ film, onClose, onLike, onDislike }: FilmModalProps) {
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

          {/* Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-hidden"
            style={{ background: "var(--surface)", maxHeight: "90dvh" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--border)" }} />
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: "calc(90dvh - 20px)" }}>
              {/* Hero image */}
              <div className="relative h-56 overflow-hidden">
                <img
                  src={posterUrl(film.backdrop_path ?? film.poster_path, "w500")}
                  alt={film.title}
                  className="w-full h-full object-cover"
                  style={{ transform: "scale(1.05)" }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(to top, var(--surface) 0%, transparent 60%)",
                  }}
                />
                <button
                  onClick={onClose}
                  className="absolute top-4 right-4 p-2 rounded-full"
                  style={{ background: "rgba(0,0,0,0.5)", color: "var(--text)" }}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-5 pb-8 -mt-4">
                {/* Title row */}
                <h2 className="text-2xl font-semibold mb-1" style={{ color: "var(--text)" }}>
                  {film.title}
                </h2>

                {/* Meta row */}
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  {film.release_year && (
                    <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {film.release_year}
                    </span>
                  )}
                  {film.runtime && (
                    <span className="flex items-center gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
                      <Clock size={13} />
                      {Math.floor(film.runtime / 60)}h {film.runtime % 60}m
                    </span>
                  )}
                  {film.rating && (
                    <span className="flex items-center gap-1 text-sm" style={{ color: "var(--accent)" }}>
                      <Star size={13} fill="currentColor" />
                      {film.rating}
                    </span>
                  )}
                  {film.genres?.map((g) => (
                    <span
                      key={g.id}
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
                    >
                      {g.name}
                    </span>
                  ))}
                </div>

                {/* Overview */}
                {film.overview && (
                  <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--text-muted)" }}>
                    {film.overview}
                  </p>
                )}

                {/* Cast */}
                {film.cast && film.cast.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-xs font-medium uppercase tracking-wider mb-3"
                      style={{ color: "var(--text-muted)" }}>
                      Cast
                    </h3>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {film.cast.slice(0, 8).map((member, i) => (
                        <div key={i} className="shrink-0 text-center w-14">
                          <div
                            className="w-14 h-14 rounded-full mb-1 overflow-hidden flex items-center justify-center text-xs"
                            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
                          >
                            {member.profile_path ? (
                              <img
                                src={`https://image.tmdb.org/t/p/w185${member.profile_path}`}
                                alt={member.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              member.name.charAt(0)
                            )}
                          </div>
                          <p className="text-xs leading-tight truncate" style={{ color: "var(--text)" }}>
                            {member.name.split(" ")[0]}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                {(onLike || onDislike) && (
                  <div className="flex gap-3">
                    {onDislike && (
                      <button
                        onClick={() => { onDislike(); onClose(); }}
                        className="flex-1 py-3.5 rounded-xl text-sm font-semibold border transition-colors"
                        style={{
                          borderColor: "var(--dislike)",
                          color: "var(--dislike)",
                          background: "transparent",
                        }}
                      >
                        Not for me
                      </button>
                    )}
                    {onLike && (
                      <button
                        onClick={() => { onLike(); onClose(); }}
                        className="flex-1 py-3.5 rounded-xl text-sm font-semibold"
                        style={{ background: "var(--like)", color: "#0c0c0e" }}
                      >
                        I&apos;m in
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
