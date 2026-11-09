"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import Cast from "@/components/Cast";
import Deck from "@/components/Deck";
import Decider from "@/components/Decider";
import { prefetchDetail } from "@/components/FilmInfo";
import LeaveLogo from "@/components/LeaveLogo";
import Lobby, { LobbyLoading } from "@/components/Lobby";
import Reveal from "@/components/Reveal";
import { useRoom } from "@/hooks/useRoom";
import { posterUrl } from "@/lib/images";
import { room as call } from "@/lib/supabase";

const BOT_TICK_MS = 2000;
const CODE = /^[A-HJ-NP-Z2-9]{4}$/;

function Notice({ title, body }: { title: string; body?: string }) {
  return (
    <main className="column flex min-h-dvh flex-col justify-center gap-4 px-6">
      <h1 className="display text-[38px]">{title}</h1>
      {body && <p className="text-sm leading-relaxed">{body}</p>}
      <Link href="/" className="slab mt-4">Back to start</Link>
    </main>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="status" className="label pointer-events-none fixed inset-x-3 top-3 z-50 mx-auto max-w-md bg-red px-3 py-2.5 text-center leading-snug">
      {message}
    </p>
  );
}

export default function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const upper = code.toUpperCase();
  const room = useRoom(upper);
  const { session, people, pool, deck, round, marks, me, error, kicked, notice, notify, swipe, flush } = room;
  const [castDismissed, setCastDismissed] = useState(false);

  const sessionId = session?.id;
  const status = session?.status;
  const hasBots = people.some((p) => p.is_bot);
  const isHost = me?.is_host;

  // The host's device drives the bots, through the same server rules as everyone else.
  useEffect(() => {
    if (!sessionId || !hasBots || !isHost || (status !== "swiping" && status !== "deciding")) return;
    const t = setInterval(() => call("bots", { sessionId }).catch(() => {}), BOT_TICK_MS);
    return () => clearInterval(t);
  }, [sessionId, hasBots, isHost, status]);

  // Any client can end the swiping phase when the clock runs out.
  const deadline = session?.swipe_deadline;
  useEffect(() => {
    if (!sessionId || status !== "swiping" || !deadline) return;
    const t = setTimeout(() => flush().then(() => call("advance", { sessionId })).catch(() => {}), Math.max(0, Date.parse(deadline) - Date.now()) + 200);
    return () => clearTimeout(t);
  }, [sessionId, status, deadline, flush]);

  // If the shortlist round never appeared, ask the server to finish making it.
  const hasRound = !!round;
  useEffect(() => {
    if (!sessionId || status !== "deciding" || hasRound) return;
    const t = setInterval(() => call("advance", { sessionId }).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [sessionId, status, hasRound]);

  // Posters and ratings for the next cards start loading early, so each card is complete when it arrives.
  const next = deck?.frozen.join();
  useEffect(() => {
    if (!deck || !next) return;
    for (const id of deck.frozen) {
      const film = deck.films.get(id);
      if (film?.poster) new Image().src = posterUrl(film.poster);
      prefetchDetail(id);
    }
    // Only when the cards change, not on every swipe from someone else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);

  if (kicked) return <Notice title="You were removed" body="The host removed you from this session." />;
  if (error) return <Notice title="Can't join" body={error} />;
  if (!session || !me) {
    return CODE.test(upper) ? <LobbyLoading code={upper} /> : <main className="flex min-h-dvh items-center justify-center"><p className="label">Loading</p></main>;
  }

  const leave = <LeaveLogo sessionId={session.id} code={session.code} />;
  const toast = <Toast message={notice} />;

  if (session.status === "lobby") return <>{leave}{toast}<Lobby session={session} people={people} me={me} /></>;

  if (!castDismissed && sessionStorage.getItem(`cast-${session.id}`) !== "1") {
    return <>{leave}<Cast me={me} people={people} onDone={() => {
      sessionStorage.setItem(`cast-${session.id}`, "1");
      setCastDismissed(true);
    }} /></>;
  }

  if (session.status === "swiping" && deck) {
    return <>{leave}{toast}<Deck session={session} people={people} me={me} deck={deck} swipe={swipe} flush={flush} notify={notify} /></>;
  }
  if (session.status === "deciding" && round && pool.length) {
    return <>{leave}{toast}<Decider session={session} round={round} marks={marks} pool={pool} people={people} me={me} /></>;
  }
  if (session.status === "closed" && pool.length) return <>{leave}{toast}<Reveal key={session.game} session={session} pool={pool} people={people} me={me} /></>;
  return <main className="flex min-h-dvh items-center justify-center"><p className="label">Loading</p></main>;
}
