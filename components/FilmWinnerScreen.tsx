"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { posterUrl } from "@/lib/tmdb";
import { getService } from "@/lib/streaming";
import { Film, Region } from "@/types";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";
import { useLongPress } from "@/hooks/useLongPress";

interface FilmWinnerScreenProps {
  film: Film;
  sessionServices: string[];
  region: Region | string;
  /** Called when Done is tapped. Defaults to router.push("/"). */
  onDone?: () => void;
  doneDisabled?: boolean;
}

export default function FilmWinnerScreen({
  film,
  sessionServices,
  region,
  onDone,
  doneDisabled = false,
}: FilmWinnerScreenProps) {
  const router = useRouter();
  const handleDone = onDone ?? (() => router.push("/"));
  const [infoOpen, setInfoOpen] = useState(false);
  const { handlers: posterLp } = useLongPress(() => setInfoOpen(true));

  const providers = (film.watch_providers_au ?? []) as { serviceId: string; logoPath?: string | null }[];
  const available = providers.filter((p) => sessionServices.includes(p.serviceId));

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" style={{ background: "var(--bg)" }}>
      {/* Blurred backdrop */}
      {film.poster_path && (
        <div className="fixed inset-0 opacity-10 pointer-events-none overflow-hidden">
          <img
            src={posterUrl(film.poster_path, "w500")}
            alt=""
            className="w-full h-full object-cover"
            style={{ filter: "blur(20px)" }}
          />
        </div>
      )}

      {/* Centred content — no scroll */}
      <div
        className="relative z-10 flex flex-col items-center px-5 pb-24 w-full"
        style={{ maxWidth: 480 }}
      >
        <div className="mb-3">
          <Logo size="sm" />
        </div>
        <h1 className="text-xl font-medium mb-1" style={{ color: "var(--accent)" }}>
          You've got a match
        </h1>
        <p className="text-xs mb-8 text-center" style={{ color: "var(--text-muted)" }}>
          Everyone agreed on tonight's film
        </p>

        <div className="w-72 flex flex-col gap-2">
          {/* Poster — long press to open info */}
          <div
            className="relative rounded-2xl overflow-hidden shadow-2xl"
            style={{ aspectRatio: "2/3" }}
            {...posterLp}
          >
            <img
              src={posterUrl(film.poster_path, "w342")}
              alt={film.title}
              className="w-full h-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to top, rgba(12,12,14,0.85) 0%, transparent 50%)" }}
            />
            {/* Streaming logos bottom-left */}
            {available.length > 0 && (
              <div className="absolute bottom-2 left-2 flex gap-1 flex-wrap">
                {available.slice(0, 3).map((p) => {
                  const svc = getService(p.serviceId, region as Region);
                  if (!svc) return null;
                  const logo = p.logoPath ?? (svc as typeof svc & { tmdbLogoPath?: string | null }).tmdbLogoPath;
                  return logo ? (
                    <img
                      key={p.serviceId}
                      src={`https://image.tmdb.org/t/p/w45${logo}`}
                      alt={svc.name}
                      title={svc.name}
                      className="w-5 h-5 rounded object-cover"
                    />
                  ) : (
                    <span
                      key={p.serviceId}
                      className="text-[9px] px-1 py-0.5 rounded font-bold"
                      style={{ background: svc.color, color: "#fff" }}
                    >
                      {svc.abbrev}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Title + year */}
          <div className="text-center">
            <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text)" }}>
              {film.title}
            </p>
            {film.release_year && (
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {film.release_year}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Sticky Done bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-20 px-5 pb-6 pt-3"
        style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}
      >
        <div className="mx-auto flex justify-center" style={{ maxWidth: 480 }}>
          <button
            onClick={handleDone}
            disabled={doneDisabled}
            className="w-72 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e", opacity: doneDisabled ? 0.4 : 1 }}
          >
            Done
          </button>
        </div>
      </div>

      <FilmInfoOverlay
        film={infoOpen ? film : null}
        onClose={() => setInfoOpen(false)}
        sessionServices={sessionServices}
      />
    </div>
  );
}
