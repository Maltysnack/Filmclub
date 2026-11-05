"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import FilmInfo, { ServiceLogos, useDetail } from "./FilmInfo";
import { frontFilms, likedByOthers, type DeckState } from "@/lib/deck";
import { posterUrl } from "@/lib/images";
import { room } from "@/lib/supabase";
import type { Film, Participant, Session } from "@/lib/types";

const SWIPE_DISTANCE = 100;
const SWIPE_VELOCITY = 500;
const THROW_DISTANCE = 1100;

export interface Toss {
  x: number;
  y: number;
  rotate: number;
}

function Card({ film, top, onSwipe }: { film: Film; top: boolean; onSwipe: (liked: boolean, toss: Toss) => void }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-320, 320], [-16, 16]);
  const tick = useTransform(x, [0, SWIPE_DISTANCE], [0, 1]);
  const cross = useTransform(x, [-SWIPE_DISTANCE, 0], [1, 0]);

  // Only sideways intent decides. Throwing it straight up or down springs it back.
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (Math.abs(offset.x) <= SWIPE_DISTANCE && Math.abs(velocity.x) <= SWIPE_VELOCITY) return;
    const liked = offset.x + velocity.x * 0.1 > 0;
    const dx = offset.x + velocity.x * 0.25;
    const dy = offset.y + velocity.y * 0.25;
    const scale = THROW_DISTANCE / Math.max(Math.hypot(dx, dy), 1);
    onSwipe(liked, { x: dx * scale, y: dy * scale, rotate: liked ? 28 : -28 });
  };

  return (
    <motion.div
      className="absolute inset-0 touch-none bg-black will-change-transform"
      style={{ x, y, rotate, zIndex: top ? 2 : 1, cursor: top ? "grab" : "default" }}
      drag={top}
      dragSnapToOrigin
      dragElastic={1}
      dragMomentum={false}
      dragTransition={{ bounceStiffness: 500, bounceDamping: 30 }}
      whileDrag={{ cursor: "grabbing", scale: 1.02 }}
      onDragEnd={onDragEnd}
      exit="gone"
      variants={{
        gone: (toss: Toss) => ({ ...toss, transition: { duration: 0.3, ease: [0.2, 0, 0.4, 1] } }),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={posterUrl(film.poster)} alt={`${film.title} poster`} draggable={false} className="size-full select-none object-cover" />
      {top && (
        <svg viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth={8} strokeLinecap="square" aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 size-52 -translate-x-1/2 -translate-y-1/2">
          <motion.path d="M10 56 L36 84 L92 14" style={{ pathLength: tick, opacity: tick }} />
          <motion.path d="M14 14 L88 86 M88 14 L14 86" style={{ pathLength: cross, opacity: cross }} />
        </svg>
      )}
    </motion.div>
  );
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Deck({ session, people, me, deck, swipe, flush }: {
  session: Session;
  people: Participant[];
  me: Participant;
  deck: DeckState;
  swipe: (id: number, liked: boolean) => void;
  flush: () => Promise<void>;
}) {
  const films = useMemo(() => frontFilms(deck), [deck]);
  const front = films[0];
  const [toss, setToss] = useState<Toss>({ x: 1100, y: 0, rotate: 28 });
  const [info, setInfo] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const detail = useDetail(front?.id ?? 0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const decide = useCallback((liked: boolean, thrown?: Toss) => {
    if (!front) return;
    setToss(thrown ?? { x: liked ? 1100 : -1100, y: 0, rotate: liked ? 28 : -28 });
    swipe(front.id, liked);
  }, [front, swipe]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (info || document.querySelector("[data-modal]")) return;
      if (e.key === "ArrowLeft") decide(false);
      if (e.key === "ArrowRight") decide(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, info]);

  const setReady = useCallback(
    // Wait for our swipes to land first, or the shortlist can miss our last likes.
    async (ready: boolean) => {
      await flush();
      await room("ready", { sessionId: session.id, ready }).catch(() => {});
    },
    [session.id, flush],
  );

  // Running out of cards counts as being ready.
  useEffect(() => {
    if (!front && !me.ready) setReady(true);
  }, [front, me.ready, setReady]);

  const readyCount = people.filter((p) => p.ready).length;
  const names = new Map(people.map((p) => [p.id, p.name]));
  const likedBy = front ? likedByOthers(deck, front.id).map((id) => names.get(id)).filter(Boolean) as string[] : [];
  const left = session.swipe_deadline ? Date.parse(session.swipe_deadline) - now : 0;
  const waitingOn = people.filter((p) => !p.ready).map((p) => p.name);
  const waiting = me.ready && waitingOn.length > 0 ? `Ready. Waiting on ${waitingOn.join(", ")}. Keep swiping.` : null;

  return (
    <main className="screen flex h-dvh flex-col lg:flex-row">
      <div className="relative z-20 min-h-0 flex-1 bg-panel lg:w-[600px] lg:flex-none">
        <AnimatePresence custom={toss} initial={false}>
          {[...films].reverse().map((film) => (
            <Card key={film.id} film={film} top={film.id === front?.id} onSwipe={decide} />
          ))}
        </AnimatePresence>
        {!front && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
            <p className="display text-[28px]">That&apos;s your deck. Waiting on the others.</p>
          </div>
        )}
        <span className="label pointer-events-none absolute right-3 top-3 z-10 flex h-9 items-center gap-2 bg-black px-2.5 lg:hidden">
          <span className="size-2.5 bg-red" />
          {clock(left)}
        </span>
        {waiting && <span className="label pointer-events-none absolute left-3 top-14 z-10 max-w-[75%] bg-black px-2.5 py-2.5 leading-snug lg:hidden">{waiting}</span>}
      </div>

      <div className="relative flex shrink-0 flex-col gap-3 bg-black px-4 pb-5 pt-3 lg:flex-1 lg:justify-center lg:gap-5 lg:px-16">
        <div className="hidden justify-between lg:flex">
          <span className="display text-[18px]">You are {me.name}</span>
          <span className="label flex items-center gap-2.5">
            <span className="size-2.5 bg-red" />
            {waiting ?? `${readyCount} of ${people.length} ready`} / {clock(left)}
          </span>
        </div>
        {front && (
          <div className="flex items-end justify-between gap-3 lg:mt-auto lg:block">
            <div className="min-w-0">
              <p className="label mb-1.5 flex h-4 items-center gap-2 lg:mb-3">
                {likedBy.length > 0 && <span className="size-2 shrink-0 bg-red" />}
                <span className="truncate">{likedBy.length > 0 && `${likedBy.join(", ")} liked this`}</span>
              </p>
              <h1 className="display truncate text-[24px] lg:whitespace-normal lg:text-[72px]">{front.title}</h1>
              <div className="mt-1.5 flex h-5 items-center gap-2 lg:mt-4 lg:h-6">
                <span className="label text-muted">{front.year}</span>
                <ServiceLogos film={front} />
                {detail?.imdb && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/imdb-logo.png" alt="IMDb" className="ml-1 h-4 w-auto" />
                    <span className="label">{detail.imdb}</span>
                  </>
                )}
              </div>
              <p className="mt-4 hidden max-w-xl text-base leading-relaxed text-muted lg:line-clamp-4 lg:[display:-webkit-box]">{front.overview}</p>
            </div>
            <button className="label h-11 w-14 shrink-0 border border-text lg:mt-4" onClick={() => setInfo(true)}>Info</button>
          </div>
        )}
        <div className="grid h-[68px] grid-cols-[88px_minmax(0,1fr)_88px] lg:mt-auto lg:h-[100px] lg:grid-cols-[180px_minmax(0,1fr)_180px]">
          <button aria-label="Skip" disabled={!front} onClick={() => decide(false)} className="flex items-center justify-center border border-text disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="square" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
          <button aria-pressed={me.ready} onClick={() => setReady(!me.ready)} className={`label border-y border-text ${me.ready ? "bg-red" : ""}`}>
            {me.ready ? `Ready ${readyCount}/${people.length}` : "Ready to vote"}
          </button>
          <button aria-label="Like" disabled={!front} onClick={() => decide(true)} className="flex items-center justify-center bg-text text-black disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="square" aria-hidden="true"><path d="M4 13l5 6L20 5" /></svg>
          </button>
        </div>
      </div>

      {info && front && <FilmInfo film={front} likedBy={likedBy} onClose={() => setInfo(false)} />}
    </main>
  );
}
