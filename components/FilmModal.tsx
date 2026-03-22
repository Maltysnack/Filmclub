"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Film } from "@/types";
import { DendyFilm } from "@/lib/dendy";
import { getService } from "@/lib/streaming";
import { posterUrl } from "@/lib/tmdb";
import { X, Clock, Star } from "lucide-react";
import DendyLogo from "./DendyLogo";

interface FilmModalProps {
  film: Film | null;
  onClose: () => void;
  onLike?: () => void;
  onDislike?: () => void;
  dendyInfo?: DendyFilm;
  sessionServices?: string[];
}

export default function FilmModal({ film, onClose, onLike, onDislike, dendyInfo, sessionServices = [] }: FilmModalProps) {
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
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl overflow-hidden flex flex-col"
            style={{ background: "var(--surface)", maxHeight: "92dvh" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Hero image — tall, takes up the top ~45% */}
            <div className="relative shrink-0 overflow-hidden" style={{ height: "42dvh" }}>
              <img
                src={posterUrl(film.backdrop_path ?? film.poster_path, "w780")}
                alt={film.title}
                className="w-full h-full object-cover"
              />
              {/* Gradient fading into the sheet */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(to top, var(--surface) 0%, rgba(20,20,22,0.2) 50%, transparent 100%)",
                }}
              />
              {/* Close button */}
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

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 pt-3 pb-8">
                {/* Title */}
                <h2 className="text-2xl font-semibold mb-2 leading-tight" style={{ color: "var(--text)" }}>
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

                {/* Where to watch */}
                {(dendyInfo || sessionServices.length > 0) && (
                  <div className="mb-4 p-3 rounded-xl space-y-2" style={{ background: "var(--surface-2)" }}>
                    {dendyInfo && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <DendyLogo height={13} />
                          {dendyInfo.tmdbMatch === "low" && <span className="text-xs" style={{ color: "var(--accent)" }}>⚠️</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {dendyInfo.sessionTimes.map((t) => (
                            <a key={t} href={dendyInfo.bookingUrls[t] ?? "#"} target="_blank" rel="noopener noreferrer"
                              className="text-xs px-2.5 py-1 rounded-lg font-medium"
                              style={{ background: "var(--accent)", color: "#0c0c0e" }}>
                              {t}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {sessionServices.length > 0 && (() => {
                      const providers = film.watch_providers_au ?? [];
                      const available = providers.filter((p) => sessionServices.includes(p.serviceId));
                      if (!available.length) return null;
                      return (
                        <div>
                          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>🏠 Stream at home</p>
                          <div className="flex flex-wrap gap-1.5">
                            {available.map((p) => {
                              const svc = getService(p.serviceId);
                              if (!svc) return null;
                              const lp = p.logoPath ?? (svc as typeof svc & { tmdbLogoPath: string | null }).tmdbLogoPath;
                              return lp ? (
                                <div key={p.serviceId} className="flex items-center gap-1.5">
                                  <img src={`https://image.tmdb.org/t/p/w45${lp}`} alt={svc.name}
                                    title={svc.name}
                                    className="w-7 h-7 rounded-lg object-cover" />
                                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{svc.name}</span>
                                </div>
                              ) : (
                                <span key={p.serviceId} className="text-xs px-2.5 py-1 rounded-lg font-bold"
                                  style={{ background: `${svc.color}25`, color: svc.color, border: `1px solid ${svc.color}50` }}>
                                  {svc.abbrev}
                                  <span className="font-normal ml-1 opacity-80">{svc.name}</span>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Overview */}
                {film.overview && (
                  <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--text-muted)" }}>
                    {film.overview}
                  </p>
                )}

                {/* Cast */}
                {film.film_cast && film.film_cast.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-xs font-medium uppercase tracking-wider mb-3"
                      style={{ color: "var(--text-muted)" }}>
                      Cast
                    </h3>
                    <div className="flex gap-3 overflow-x-auto pb-1">
                      {film.film_cast.slice(0, 8).map((member, i) => (
                        <div key={i} className="shrink-0 text-center w-16">
                          <div
                            className="w-16 h-16 rounded-full mb-1.5 overflow-hidden flex items-center justify-center text-sm font-medium"
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
                          {/* Full name, wrapping */}
                          <p className="text-xs leading-tight" style={{ color: "var(--text)" }}>
                            {member.name}
                          </p>
                          {member.character && (
                            <p className="text-xs leading-tight mt-0.5" style={{ color: "var(--text-muted)" }}>
                              {member.character}
                            </p>
                          )}
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
