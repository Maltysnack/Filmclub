"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { posterUrl } from "@/lib/tmdb";
import { getService } from "@/lib/streaming";
import { Film, Region } from "@/types";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";
import { useLongPress } from "@/hooks/useLongPress";
import { Share2 } from "lucide-react";

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
  const [copied, setCopied] = useState(false);
  const { handlers: posterLp } = useLongPress(() => setInfoOpen(true));

  const providers = (film.watch_providers_au ?? []) as { serviceId: string; logoPath?: string | null }[];
  const available = providers.filter((p) => sessionServices.includes(p.serviceId));

  // #116: format runtime as "1h 47m" or "47m" if under an hour. Returns null
  // if runtime is missing so the chip strip drops the cell gracefully.
  const runtimeLabel = (() => {
    if (!film.runtime || film.runtime <= 0) return null;
    const h = Math.floor(film.runtime / 60);
    const m = film.runtime % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  async function handleShare() {
    // #116: native share where supported (iOS/Android/modern desktop), copy-to-
    // clipboard fallback otherwise. Both paths swallow user-cancel silently.
    const yearSuffix = film.release_year ? ` (${film.release_year})` : "";
    const text = `We matched on ${film.title}${yearSuffix} on Filmclub`;
    const url = "https://filmclub.watch";
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ title: "Filmclub", text, url });
        return;
      }
    } catch {
      // user cancelled, or share rejected — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked — silent
    }
  }

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

          {/* Title + meta strip. #116: surface year · runtime · ★rating
              in one architectural row so the payoff moment feels denser than
              the lone year that used to live here. Middle dots separate; any
              missing cell drops cleanly without leaving a hanging separator. */}
          <div className="text-center">
            <p className="text-sm font-semibold leading-tight" style={{ color: "var(--text)" }}>
              {film.title}
            </p>
            {(film.release_year || runtimeLabel || film.imdb_rating) && (
              <p
                className="text-xs mt-1 inline-flex items-center justify-center"
                style={{ color: "var(--text-muted)", letterSpacing: "0.04em" }}
              >
                {[
                  film.release_year ? String(film.release_year) : null,
                  runtimeLabel,
                  film.imdb_rating ? `★ ${film.imdb_rating}` : null,
                ]
                  .filter(Boolean)
                  .map((part, i, arr) => (
                    <span key={i}>
                      {i > 0 && (
                        <span className="mx-1.5" aria-hidden style={{ opacity: 0.5 }}>·</span>
                      )}
                      <span style={i === arr.length - 1 && film.imdb_rating ? { color: "#F5C518" } : undefined}>
                        {part}
                      </span>
                    </span>
                  ))}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Sticky action bar. #116: Share + Done. Done stays the primary
          (filled gold), Share is the secondary virality hook (outlined
          accent with the share glyph). On supported devices native share
          sheet fires; elsewhere the title+link copies to clipboard with
          a brief inline confirmation. */}
      <div
        className="fixed bottom-0 left-0 right-0 z-20 px-5 pb-6 pt-3"
        style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}
      >
        <div className="mx-auto flex items-center gap-3 w-72" style={{ maxWidth: 480 }}>
          <button
            onClick={handleShare}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium border transition-all active:scale-[0.98]"
            style={{
              borderColor: copied ? "var(--like)" : "var(--accent)",
              color: copied ? "var(--like)" : "var(--accent)",
              background: "transparent",
              minWidth: 96,
            }}
            aria-label={copied ? "Link copied" : "Share match"}
          >
            <Share2 size={14} />
            <span>{copied ? "Copied" : "Share"}</span>
          </button>
          <button
            onClick={handleDone}
            disabled={doneDisabled}
            className="flex-1 py-3 rounded-xl text-sm font-semibold"
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
