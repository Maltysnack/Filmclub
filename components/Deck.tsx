"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import FilmInfo, { useDetail } from "./FilmInfo";
import { frontFilms, likedByOthers, type DeckState } from "@/lib/deck";
import { posterUrl } from "@/lib/images";
import { serviceById } from "@/lib/services";
import { room } from "@/lib/supabase";
import type { Film, Participant, Session } from "@/lib/types";

const SWIPE_DISTANCE = 110;
const SWIPE_VELOCITY = 600;

function Card({ film, top, onSwipe }: { film: Film; top: boolean; onSwipe: (liked: boolean) => void }) {
  const x = useMotionValue(0);
  const tick = useTransform(x, [0, SWIPE_DISTANCE], [0, 1]);
  const cross = useTransform(x, [-SWIPE_DISTANCE, 0], [1, 0]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const far = Math.abs(info.offset.x) > SWIPE_DISTANCE || Math.abs(info.velocity.x) > SWIPE_VELOCITY;
    if (far) onSwipe(info.offset.x > 0);
  };

  return (
    <motion.div
      className="absolute inset-0 touch-pan-y bg-black"
      style={{ x, zIndex: top ? 2 : 1, cursor: top ? "grab" : "default" }}
      drag={top ? "x" : false}
      dragSnapToOrigin
      dragElastic={0.9}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      exit="gone"
      variants={{
        gone: (dir: number) => ({ x: dir * 900, transition: { duration: 0.22, ease: [0.3, 0, 0.1, 1] } }),
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

export default function Deck({ session, people, me, deck, swipe }: {
  session: Session;
  people: Participant[];
  me: Participant;
  deck: DeckState;
  swipe: (id: number, liked: boolean) => void;
}) {
  const films = useMemo(() => frontFilms(deck), [deck]);
  const front = films[0];
  const [dir, setDir] = useState(1);
  const [info, setInfo] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const detail = useDetail(front?.id ?? 0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const decide = useCallback((liked: boolean) => {
    if (!front) return;
    setDir(liked ? 1 : -1);
    swipe(front.id, liked);
  }, [front, swipe]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (info) return;
      if (e.key === "ArrowLeft") decide(false);
      if (e.key === "ArrowRight") decide(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, info]);

  const setReady = useCallback(
    (ready: boolean) => room("ready", { sessionId: session.id, ready }).catch(() => {}),
    [session.id],
  );

  // Running out of cards counts as being ready.
  useEffect(() => {
    if (!front && !me.ready) setReady(true);
  }, [front, me.ready, setReady]);

  const readyCount = people.filter((p) => p.ready).length;
  const names = new Map(people.map((p) => [p.id, p.name]));
  const likedBy = front ? likedByOthers(deck, front.id).map((id) => names.get(id)).filter(Boolean) as string[] : [];
  const left = session.swipe_deadline ? Date.parse(session.swipe_deadline) - now : 0;
  const meta = front && [front.year, serviceById(front.services[0])?.name, detail?.imdb && `IMDb ${detail.imdb}`].filter(Boolean).join(" / ");

  return (
    <main className="screen flex h-dvh flex-col lg:flex-row">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-panel lg:w-[600px] lg:flex-none">
        <AnimatePresence custom={dir} initial={false}>
          {[...films].reverse().map((film) => (
            <Card key={film.id} film={film} top={film.id === front?.id} onSwipe={decide} />
          ))}
        </AnimatePresence>
        {!front && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
            <p className="display text-[28px]">That&apos;s your deck. Waiting on the others.</p>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2 lg:hidden">
          {likedBy.length > 0 ? <span className="label bg-text px-2.5 py-2.5 text-black">{likedBy.join(", ")} liked this</span> : <span />}
          <span className="label flex shrink-0 items-center gap-2 bg-black px-2.5 py-2.5">
            <span className="size-2.5 bg-red" />
            {clock(left)}
          </span>
        </div>
      </div>

      <div className="relative flex shrink-0 flex-col gap-3 bg-black px-4 pb-5 pt-3 lg:flex-1 lg:justify-center lg:gap-5 lg:px-16">
        <div className="hidden justify-between lg:flex">
          <span className="display text-[18px]">You are {me.name}</span>
          <span className="label flex items-center gap-2.5">
            <span className="size-2.5 bg-red" />
            {readyCount} of {people.length} ready / {clock(left)}
          </span>
        </div>
        {front && (
          <div className="flex items-center justify-between gap-3 lg:mt-auto lg:block">
            <div className="min-w-0">
              {likedBy.length > 0 && <p className="label mb-3 hidden lg:block">{likedBy.join(", ")} liked this</p>}
              <h1 className="display truncate text-[24px] lg:whitespace-normal lg:text-[72px]">{front.title}</h1>
              <p className="label mt-1 truncate text-muted lg:mt-4">{meta}</p>
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
