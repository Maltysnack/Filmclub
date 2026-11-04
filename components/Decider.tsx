"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Mark from "./Mark";
import { posterUrl } from "@/lib/images";
import { room } from "@/lib/supabase";
import type { Film, Mark as MarkRow, Participant, Round, Session } from "@/lib/types";

const HOLD_MS = 320;

function Tile({ film, crossed, ticked, label, onTap, onPreview }: {
  film: Film; crossed: boolean; ticked: boolean; label: number;
  onTap: () => void; onPreview: (f: Film | null) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  return (
    <button
      aria-label={`${film.title}${crossed ? ", crossed" : ticked ? ", ticked" : ""}`}
      className="relative min-h-0 overflow-hidden bg-black"
      onPointerDown={() => {
        held.current = false;
        timer.current = setTimeout(() => {
          held.current = true;
          onPreview(film);
        }, HOLD_MS);
      }}
      onPointerUp={() => {
        clearTimeout(timer.current);
        if (held.current) onPreview(null);
      }}
      onPointerCancel={() => {
        clearTimeout(timer.current);
        onPreview(null);
      }}
      onClick={() => !held.current && onTap()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={posterUrl(film.poster)} alt="" draggable={false} className={`size-full select-none object-cover ${crossed ? "opacity-40" : ""}`} />
      <span className="label absolute left-0 top-0 hidden size-7 items-center justify-center bg-black lg:flex">{label}</span>
      <span className="absolute inset-0 flex items-center justify-center">
        {crossed && <Mark kind="cross" className="w-4/5 max-w-44" />}
        {ticked && <Mark kind="tick" className="w-4/5 max-w-44" />}
      </span>
    </button>
  );
}

function Countdown({ deadline }: { deadline: string }) {
  const [seconds] = useState(() => Math.max(0, (Date.parse(deadline) - Date.now()) / 1000));
  return <div className="countdown h-1 bg-text" style={{ animationDuration: `${seconds}s` }} />;
}

export default function Decider({ session, round, marks, pool, people, me }: {
  session: Session;
  round: Round;
  marks: MarkRow[];
  pool: Film[];
  people: Participant[];
  me: Participant;
}) {
  const [cross, setCross] = useState<number | null>(null);
  const [tick, setTick] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const [preview, setPreview] = useState<Film | null>(null);
  const [error, setError] = useState<string | null>(null);

  const films = useMemo(
    () => round.film_ids.map((id) => pool.find((f) => f.id === id)).filter(Boolean) as Film[],
    [round.film_ids, pool],
  );
  const final = films.length === 2;
  const mine = marks.some((m) => m.participant_id === me.id);
  const done = locked || mine;
  const ready = final ? tick !== null : cross !== null && tick !== null;
  const lockedIn = new Set(marks.map((m) => m.participant_id)).size;

  // Reset local marks when a new round opens, without an effect.
  const [roundId, setRoundId] = useState(round.id);
  if (roundId !== round.id) {
    setRoundId(round.id);
    setCross(null);
    setTick(null);
    setLocked(false);
  }

  const tap = useCallback((id: number) => {
    if (done) return;
    if (final) return setTick((t) => (t === id ? null : id));
    if (id === cross) return setCross(null);
    if (id === tick) return setTick(null);
    if (cross === null) return setCross(id);
    setTick(id);
  }, [cross, done, final, tick]);

  const confirm = useCallback(async () => {
    if (!ready || done) return;
    setLocked(true);
    setError(null);
    try {
      await room("mark", { sessionId: session.id, roundId: round.id, cross, tick });
    } catch (e) {
      setLocked(false);
      setError((e as Error).message);
    }
  }, [cross, done, ready, round.id, session.id, tick]);

  // At the deadline a completed sheet still counts, and any client can move the round on.
  const confirmRef = useRef(confirm);
  useEffect(() => {
    confirmRef.current = confirm;
  }, [confirm]);
  useEffect(() => {
    const ms = Date.parse(round.deadline) - Date.now();
    const lockIn = setTimeout(() => confirmRef.current(), Math.max(0, ms - 400));
    const nudge = setTimeout(() => room("advance", { sessionId: session.id }).catch(() => {}), Math.max(0, ms + 300));
    return () => {
      clearTimeout(lockIn);
      clearTimeout(nudge);
    };
  }, [round.deadline, round.id, session.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const film = films[Number(e.key) - 1];
      if (film) tap(film.id);
      if (e.key === "Enter") confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, films, tap]);

  const rows = films.length > 3 ? Math.ceil(films.length / 2) : films.length;
  const prompt = final ? "Final. Tick one" : cross === null ? "Cross one" : "Tick one";

  return (
    <main className="screen flex h-dvh flex-col">
      <div
        className={`grid min-h-0 flex-1 gap-px ${films.length > 3 ? "grid-cols-2" : "grid-cols-1"} lg:!grid-cols-[repeat(var(--count),minmax(0,1fr))] lg:!grid-rows-1`}
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, "--count": films.length } as React.CSSProperties}
      >
        {films.map((film, i) => (
          <Tile key={film.id} film={film} label={i + 1} crossed={film.id === cross} ticked={film.id === tick} onTap={() => tap(film.id)} onPreview={setPreview} />
        ))}
      </div>
      <div className="h-1 shrink-0 bg-line">
        <Countdown key={round.id} deadline={round.deadline} />
      </div>
      <div className="flex h-[122px] shrink-0 flex-col justify-center px-4 pb-4 pt-2 lg:h-[160px] lg:px-16">
        <div className="column lg:!max-w-none">
          {error && <p role="alert" className="label mb-2 text-[var(--red-text)]">{error}</p>}
          {done ? (
            <p className="label flex h-[72px] items-center justify-center border border-text text-center">
              Locked in / {lockedIn} of {people.length}
            </p>
          ) : ready ? (
            <button className="slab !h-[72px] !text-[22px]" onClick={confirm}>Confirm</button>
          ) : (
            <div className="flex items-center justify-between">
              <span className="display text-[30px]">{prompt}</span>
              <span className="label">Round {round.number}</span>
            </div>
          )}
        </div>
      </div>
      {preview && (
        <div className="pointer-events-none absolute inset-0 z-20 bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={posterUrl(preview.poster)} alt="" className="size-full object-contain" />
          <p className="display absolute inset-x-0 bottom-0 bg-black p-4 text-[20px]">{preview.title}</p>
        </div>
      )}
    </main>
  );
}
