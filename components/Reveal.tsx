"use client";

import { useEffect, useState } from "react";
import { posterUrl } from "@/lib/images";
import { logoUrl, serviceById } from "@/lib/services";
import { room } from "@/lib/supabase";
import type { Film, Participant, Session } from "@/lib/types";

const CUTS = 16;

export default function Reveal({ session, pool, me }: { session: Session; pool: Film[]; me: Participant }) {
  const winner = pool.find((f) => f.id === session.winner_film_id);
  const tied = session.reveal_film_ids.map((id) => pool.find((f) => f.id === id)).filter(Boolean) as Film[];
  const [shown, setShown] = useState(tied.length > 1 ? tied[0] : winner);
  const [landed, setLanded] = useState(tied.length <= 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tied.length <= 1) return;
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const cut = () => {
      step++;
      if (step >= CUTS) {
        setShown(winner);
        setLanded(true);
        return;
      }
      setShown(tied[step % tied.length]);
      timer = setTimeout(cut, 60 + 280 * (step / CUTS) ** 3); // about two seconds, slowing to a stop
    };
    timer = setTimeout(cut, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.game, session.winner_film_id]);

  if (!shown) return null;
  const services = (winner?.services ?? []).map(serviceById).filter(Boolean);

  return (
    <main className="screen flex h-dvh flex-col lg:flex-row">
      <div className="relative min-h-0 flex-1 lg:w-[600px] lg:flex-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={posterUrl(shown.poster, landed ? "original" : "w780")} alt={`${shown.title} poster`} className="absolute inset-0 size-full object-cover" />
        {landed ? <span className="pointer-events-none absolute inset-3 border-[3px] border-text" /> : <span className="label absolute left-3 top-3 bg-black px-2.5 py-1.5">Tie</span>}
      </div>
      {landed && winner && (
        <div className="flex shrink-0 flex-col gap-2 bg-black px-6 pb-7 pt-4 lg:flex-1 lg:justify-center lg:gap-4 lg:px-16">
          <div className="flex items-center justify-between">
            <span className="label">Tonight&apos;s film</span>
            <span className="flex gap-1.5">
              {services.map((s) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={s!.id} src={logoUrl(s!.logo)} alt={s!.name} className="size-8" />
              ))}
            </span>
          </div>
          <h1 className="display text-[42px] lg:text-[72px]">{winner.title}</h1>
          {error && <p role="alert" className="label text-[var(--red-text)]">{error}</p>}
          {me.is_host ? (
            <button className="slab mt-2" disabled={busy} onClick={() => { setBusy(true); setError(null); room("again", { sessionId: session.id }).catch((e) => { setBusy(false); setError(e.message); }); }}>
              {busy ? "Dealing films" : "Play again"}
            </button>
          ) : (
            <p className="label py-5 text-center">Waiting for the host</p>
          )}
        </div>
      )}
    </main>
  );
}
