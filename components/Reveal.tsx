"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ServiceLogos } from "./FilmInfo";
import { posterUrl } from "@/lib/images";
import { room } from "@/lib/supabase";
import type { Film, Participant, Session } from "@/lib/types";

const MIN_MOVES = 12;
const REST_MS = 900;

function moveMs(step: number, total: number) {
  return 170 + 620 * (step / total) ** 3;
}

// A frame glides between the tied posters, slowing like a wheel until it settles.
function TieBreak({ films, winner, onDone }: { films: Film[]; winner: Film; onDone: () => void }) {
  const [active, setActive] = useState(0);
  const [ms, setMs] = useState(moveMs(0, MIN_MOVES));
  const [settled, setSettled] = useState(false);
  const done = useRef(onDone);

  useEffect(() => {
    const n = films.length;
    const target = films.indexOf(winner);
    const total = Math.ceil(MIN_MOVES / n) * n + target;
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const move = () => {
      step++;
      setActive(step % n);
      const wait = moveMs(step, total);
      setMs(wait);
      if (step >= total) {
        setSettled(true);
        timer = setTimeout(() => done.current(), REST_MS);
        return;
      }
      timer = setTimeout(move, wait);
    };
    timer = setTimeout(move, 500);
    return () => clearTimeout(timer);
  }, [films, winner]);

  const cols = films.length === 3 ? 3 : Math.min(films.length, 2);
  return (
    <main className="screen flex h-dvh flex-col bg-black">
      <div className="px-6 pb-3 pt-14 lg:pt-8">
        <h1 className="display text-center text-[30px]">{settled ? "That's the one" : "It's a tie"}</h1>
      </div>
      <div
        className="grid min-h-0 flex-1 content-center gap-3 p-3 lg:!grid-cols-[repeat(var(--count),minmax(0,240px))] lg:justify-center"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, "--count": films.length } as React.CSSProperties}
      >
        {films.map((film, i) => (
          <div key={film.id} className="relative aspect-[2/3] w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={posterUrl(film.poster, "w342")}
              alt={`${film.title} poster`}
              className={`size-full object-cover transition-opacity duration-300 ${settled && i !== active ? "opacity-20" : ""}`}
            />
            {i === active && (
              <motion.span
                layoutId="tie-frame"
                transition={{ duration: Math.min(ms, 700) / 1000, ease: [0.4, 0, 0.3, 1] }}
                className="pointer-events-none absolute -inset-1 z-10 border-4 border-text"
              />
            )}
          </div>
        ))}
      </div>
    </main>
  );
}

export default function Reveal({ session, pool, people, me }: { session: Session; pool: Film[]; people: Participant[]; me: Participant }) {
  const winner = pool.find((f) => f.id === session.winner_film_id);
  const [tied] = useState(() => session.reveal_film_ids.map((id) => pool.find((f) => f.id === id)).filter(Boolean) as Film[]);
  const [landed, setLanded] = useState(tied.length <= 1);
  const [error, setError] = useState<string | null>(null);

  if (!winner) return null;
  if (!landed) return <TieBreak films={tied} winner={winner} onDone={() => setLanded(true)} />;

  const humans = people.filter((p) => !p.is_bot);
  const keen = humans.filter((p) => p.rematch).length;
  const needed = Math.floor(humans.length / 2) + 1;

  const vote = () => {
    setError(null);
    room("rematch", { sessionId: session.id, rematch: !me.rematch }).catch((e) => setError(e.message));
  };

  return (
    <main className="screen flex h-dvh flex-col lg:flex-row">
      <motion.div
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative min-h-0 flex-1 lg:w-[600px] lg:flex-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={posterUrl(winner.poster, "original")} alt={`${winner.title} poster`} className="absolute inset-0 size-full object-cover" />
        <span className="pointer-events-none absolute inset-3 border-[3px] border-text" />
      </motion.div>
      <div className="flex shrink-0 flex-col gap-2 bg-black px-6 pb-7 pt-4 lg:flex-1 lg:justify-center lg:gap-4 lg:px-16">
        <div className="flex items-center justify-between">
          <span className="label">Tonight&apos;s film</span>
          <span className="flex gap-1.5"><ServiceLogos film={winner} className="size-8" /></span>
        </div>
        <h1 className="display text-[42px] lg:text-[72px]">{winner.title}</h1>
        {error && <p role="alert" className="label text-[var(--red-text)]">{error}</p>}
        <button className={`slab mt-2 ${me.rematch ? "slab-outline" : ""}`} onClick={vote}>
          {me.rematch ? `Waiting ${keen}/${needed}` : needed > 1 && keen > 0 ? `Play again ${keen}/${needed}` : "Play again"}
        </button>
      </div>
    </main>
  );
}
