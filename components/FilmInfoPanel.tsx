"use client";

import { Film } from "@/types";
import { DendyFilm } from "@/lib/dendy";
import { getService } from "@/lib/streaming";
import { X, Heart } from "lucide-react";

interface FilmInfoPanelProps {
  film: Film;
  onClose: () => void;
  onLike?: () => void;
  onDislike?: () => void;
  dendyInfo?: DendyFilm;
  sessionServices: string[];
}

export default function FilmInfoPanel({ film, onClose, onLike, onDislike, dendyInfo, sessionServices }: FilmInfoPanelProps) {
  const providers: { serviceId: string; logoPath?: string | null }[] = film.watch_providers_au ?? [];
  const availableProviders = providers.filter((p) => sessionServices.includes(p.serviceId));
  const showWhere = dendyInfo || availableProviders.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header row */}
      <div className="shrink-0 flex items-start justify-between px-3 pt-3 pb-1 gap-2">
        <h2 className="text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>
          {film.title}
        </h2>
        <button onClick={onClose} className="shrink-0 p-1.5 rounded-full mt-0.5"
          style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
          <X size={13} />
        </button>
      </div>

      {/* Meta */}
      <div className="shrink-0 flex items-center gap-2 px-3 pb-2 flex-wrap">
        {film.release_year && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{film.release_year}</span>
        )}
        {film.runtime && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {Math.floor(film.runtime / 60)}h {film.runtime % 60}m
          </span>
        )}
        {film.rating && (
          <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>★ {film.rating}</span>
        )}
        {film.genres?.slice(0, 2).map((g) => (
          <span key={g.id} className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
            {g.name}
          </span>
        ))}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-3 space-y-3 pb-2">
        {/* Where to watch */}
        {showWhere && (
          <div className="p-2.5 rounded-xl space-y-2" style={{ background: "var(--surface-2)" }}>
            {dendyInfo && (
              <div>
                <p className="text-xs font-medium mb-1.5" style={{ color: "var(--accent)" }}>
                  🎬 Dendy Newtown{dendyInfo.tmdbMatch === "low" ? " ⚠️" : ""}
                </p>
                <div className="flex flex-wrap gap-1">
                  {dendyInfo.sessionTimes.map((t) => (
                    <a key={t} href={dendyInfo.bookingUrls[t] ?? "#"} target="_blank" rel="noopener noreferrer"
                      className="text-xs px-2 py-0.5 rounded font-medium"
                      style={{ background: "var(--accent)", color: "#0c0c0e" }}>
                      {t}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {availableProviders.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {availableProviders.map((p) => {
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
                    <span key={p.serviceId} className="text-xs px-2 py-0.5 rounded font-bold"
                      style={{ background: `${svc.color}25`, color: svc.color, border: `1px solid ${svc.color}50` }}>
                      {svc.abbrev} {svc.name}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Overview */}
        {film.overview && (
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {film.overview}
          </p>
        )}

        {/* Cast */}
        {film.film_cast && film.film_cast.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-1.5"
              style={{ color: "var(--text-muted)" }}>Cast</p>
            <div className="space-y-1.5">
              {film.film_cast.slice(0, 6).map((member, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-xs font-medium"
                    style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                    {member.profile_path
                      ? <img src={`https://image.tmdb.org/t/p/w45${member.profile_path}`}
                          alt={member.name} className="w-full h-full object-cover" />
                      : member.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs truncate" style={{ color: "var(--text)" }}>{member.name}</p>
                    {member.character && (
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{member.character}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {(onLike || onDislike) && (
        <div className="shrink-0 flex justify-center gap-6 px-3 pb-4 pt-2">
          {onDislike && (
            <button
              onClick={onDislike}
              className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
              style={{
                background: "var(--surface-2)",
                border: "2px solid var(--dislike)",
                color: "var(--dislike)",
              }}>
              <X size={24} />
            </button>
          )}
          {onLike && (
            <button
              onClick={onLike}
              className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95"
              style={{
                background: "var(--surface-2)",
                border: "2px solid var(--like)",
                color: "var(--like)",
              }}>
              <Heart size={22} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
