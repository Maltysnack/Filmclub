"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import Cast from "@/components/Cast";
import Deck from "@/components/Deck";
import Decider from "@/components/Decider";
import LeaveLogo from "@/components/LeaveLogo";
import Lobby from "@/components/Lobby";
import Reveal from "@/components/Reveal";
import { useRoom } from "@/hooks/useRoom";
import { posterUrl } from "@/lib/images";
import { room as call } from "@/lib/supabase";

const BOT_TICK_MS = 1300;

function Notice({ title, body }: { title: string; body?: string }) {
  return (
    <main className="column flex min-h-dvh flex-col justify-center gap-4 px-6">
      <h1 className="display text-[38px]">{title}</h1>
      {body && <p className="text-sm leading-relaxed">{body}</p>}
      <Link href="/" className="slab mt-4">Back to start</Link>
    </main>
  );
}

export default function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const upper = code.toUpperCase();
  const room = useRoom(upper);
  const { session, people, pool, deck, round, marks, me, error, kicked, swipe } = room;
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
    const t = setTimeout(() => call("advance", { sessionId }).catch(() => {}), Math.max(0, Date.parse(deadline) - Date.now()) + 200);
    return () => clearTimeout(t);
  }, [sessionId, status, deadline]);

  // Posters start loading on the who-is-who screen, so the first card is ready when it opens.
  const nextPosters = deck?.frozen.map((id) => deck.films.get(id)?.poster).join();
  useEffect(() => {
    nextPosters?.split(",").forEach((path) => {
      if (path) new Image().src = posterUrl(path);
    });
  }, [nextPosters]);

  if (kicked) return <Notice title="You were removed" body="The host removed you from this session." />;
  if (error) return <Notice title="Can't join" body={error} />;
  if (!session || !me) return <main className="flex min-h-dvh items-center justify-center"><p className="label">Loading</p></main>;

  const leave = <LeaveLogo sessionId={session.id} code={session.code} />;

  if (session.status === "lobby") return <>{leave}<Lobby session={session} people={people} me={me} /></>;

  if (!castDismissed && sessionStorage.getItem(`cast-${session.id}`) !== "1") {
    return <>{leave}<Cast me={me} people={people} onDone={() => {
      sessionStorage.setItem(`cast-${session.id}`, "1");
      setCastDismissed(true);
    }} /></>;
  }

  if (session.status === "swiping" && deck) return <>{leave}<Deck session={session} people={people} me={me} deck={deck} swipe={swipe} /></>;
  if (session.status === "deciding" && round && pool.length) {
    return <>{leave}<Decider session={session} round={round} marks={marks} pool={pool} people={people} me={me} /></>;
  }
  if (session.status === "closed" && pool.length) return <>{leave}<Reveal key={session.game} session={session} pool={pool} people={people} me={me} /></>;
  return <main className="flex min-h-dvh items-center justify-center"><p className="label">Loading</p></main>;
}
