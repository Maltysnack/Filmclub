"use client";

import { useState } from "react";
import Image from "next/image";
import { Film } from "@/types";
import { posterUrl } from "@/lib/tmdb";
import Logo from "@/components/Logo";
import SpinWheel from "@/components/SpinWheel";
import FilmWinnerScreen from "@/components/FilmWinnerScreen";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";
import { useLongPress } from "@/hooks/useLongPress";
import type { Region } from "@/types";

interface Props {
  films: Film[];
  sessionId: string;
  sessionServices: string[];
  region: Region;
  onComplete: (winnerId: string) => void;
}

type Phase = "select" | "spinning" | "winner";

function gridCols(n: number): number {
  if (n <= 2) return n || 1;
  if (n === 4) return 2;
  if (n > 20) return 4;
  return 3;
}

export default function SinglePlayerVoteOverlay({
  films, sessionId, sessionServices, region, onComplete,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("select");
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [winnerFilm, setWinnerFilm] = useState<Film | null>(null);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);

  function toggleFilm(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function handleSpin() {
    if (selected.length < 2) return;
    const pick = selected[Math.floor(Math.random() * selected.length)];
    setWinnerId(pick);
    setPhase("spinning");
  }

  // ── Spin phase ────────────────────────────────────────────────────────────
  if (phase === "spinning" && winnerId) {
    const spinFilms = films.filter(f => selected.includes(f.id));
    const spinMatches = spinFilms.map(f => ({
      id: f.id, session_id: sessionId, film_id: f.id,
      score: 1, matched_at: new Date().toISOString(), film: f,
    }));
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <SpinWheel
        films={spinMatches as any}
        winnerId={winnerId}
        onComplete={() => {
          const film = films.find(f => f.id === winnerId) ?? null;
          setWinnerFilm(film);
          setPhase("winner");
        }}
      />
    );
  }

  // ── Winner phase ──────────────────────────────────────────────────────────
  if (phase === "winner" && winnerFilm) {
    return (
      <FilmWinnerScreen
        film={winnerFilm}
        sessionServices={sessionServices}
        region={region}
        onDone={() => onComplete(winnerFilm.id)}
      />
    );
  }

  // ── Select phase ──────────────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 z-50 flex flex-col items-center" style={{ background: "var(--bg)" }}>
        <div className="relative w-full flex flex-col flex-1 min-h-0 mx-auto" style={{ maxWidth: 480 }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-10 pb-4">
            <Logo size="sm" showText />
            <span className="text-xs px-2.5 py-1 rounded-full"
              style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
              {selected.length} selected
            </span>
          </div>

          {/* Heading */}
          <div className="px-5 mb-4">
            <p className="text-lg font-bold" style={{ color: "var(--text)" }}>
              Pick your finalists
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              Select at least 2 films to spin
            </p>
          </div>

          {/* Film grid */}
          <div className="flex-1 overflow-y-auto px-5">
            <div className="grid gap-3 pb-32"
              style={{ gridTemplateColumns: `repeat(${gridCols(films.length)}, minmax(0, 1fr))` }}>
              {films.map(film => {
                const isSelected = selected.includes(film.id);
                return (
                  <SelectCard
                    key={film.id}
                    film={film}
                    isSelected={isSelected}
                    onToggle={() => toggleFilm(film.id)}
                    onInfo={() => setInfoFilm(film)}
                  />
                );
              })}
            </div>
          </div>

          {/* Spin button */}
          <div className="absolute bottom-0 left-0 right-0 p-5"
            style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
            <button
              onClick={handleSpin}
              disabled={selected.length < 2}
              className="w-full py-4 rounded-2xl text-sm font-semibold transition-opacity"
              style={{
                background: "var(--accent)",
                color: "#0c0c0e",
                opacity: selected.length < 2 ? 0.4 : 1,
              }}>
              {selected.length < 2
                ? `Select ${2 - selected.length} more to spin`
                : `Spin ${selected.length} films`
              }
            </button>
          </div>
        </div>
      </div>

      <FilmInfoOverlay film={infoFilm} onClose={() => setInfoFilm(null)} sessionServices={sessionServices} />
    </>
  );
}

// ── Film card with tap-to-select and long-press-for-info ─────────────────────
function SelectCard({
  film, isSelected, onToggle, onInfo,
}: {
  film: Film;
  isSelected: boolean;
  onToggle: () => void;
  onInfo: () => void;
}) {
  const { handlers, consumeFired } = useLongPress(onInfo);
  return (
    <button
      type="button"
      className="relative rounded-xl overflow-hidden transition-all"
      style={{ aspectRatio: "2/3", border: `2px solid ${isSelected ? "var(--like)" : "transparent"}` }}
      {...handlers}
      onClick={(e) => {
        if (consumeFired()) { e.preventDefault(); return; }
        onToggle();
      }}
    >
      {film.poster_path
        ? <Image src={posterUrl(film.poster_path, "w342")} alt={film.title} fill sizes="(max-width: 640px) 33vw, 200px" className="object-cover" />
        : <div className="w-full h-full flex items-center justify-center text-xs text-center p-2"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}>{film.title}</div>
      }
      {isSelected && (
        <div className="absolute inset-0 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}>
          <span className="text-white text-2xl font-bold">✓</span>
        </div>
      )}
    </button>
  );
}
