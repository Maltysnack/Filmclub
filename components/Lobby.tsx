"use client";

import { useState } from "react";
import { room } from "@/lib/supabase";
import type { Participant, Session } from "@/lib/types";

export default function Lobby({ session, people, me }: { session: Session; people: Participant[]; me: Participant }) {
  const [askBots, setAskBots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alone = people.length === 1;

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      await room(action, { sessionId: session.id, ...body });
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function share() {
    const url = `${location.origin}/session/${session.code}`;
    if (navigator.share) await navigator.share({ title: "Filmclub", url }).catch(() => {});
    else await navigator.clipboard.writeText(url).catch(() => {});
  }

  if (askBots) {
    return (
      <main className="column flex min-h-dvh flex-col justify-end gap-4 px-6 pb-8 pt-14">
        <h1 className="display text-[44px]">Just you?</h1>
        <p className="text-sm leading-relaxed">Three bots will join to show you what it&apos;s about.</p>
        {error && <p role="alert" className="label text-[var(--red-text)]">{error}</p>}
        <button className="slab" disabled={busy} onClick={async () => { await act("addBots"); setAskBots(false); }}>Play with bots</button>
        <button className="slab slab-outline !h-14 !text-[15px]" onClick={() => setAskBots(false)}>Wait for friends</button>
      </main>
    );
  }

  return (
    <main className="column flex min-h-dvh flex-col gap-5 px-6 pb-8 pt-14">
      <div className="flex justify-between">
        <span className="label">Your code</span>
        <button className="label h-7" onClick={share}>Share invite</button>
      </div>
      <div className="grid grid-cols-4 border border-text" aria-label={`Code ${session.code}`}>
        {[...session.code].map((c, i) => (
          <div key={i} className="display flex h-28 items-center justify-center border-r border-text text-[56px] last:border-r-0">{c}</div>
        ))}
      </div>
      <div className="flex flex-1 flex-col justify-end">
        <span className="label mb-3">{session.character_set} / {people.length} in</span>
        <ul>
          {people.map((p) => (
            <li key={p.id} className="flex h-16 items-center justify-between border-t border-line">
              <span className="display text-[24px]">{p.name}</span>
              <span className="label flex items-center gap-4">
                {p.is_bot && "Bot"}
                {p.id === me.id && "You"}
                {me.is_host && p.id !== me.id && !p.is_bot && (
                  <button className="h-11" onClick={() => act("kick", { participantId: p.id })}>Remove</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {error && <p role="alert" className="label text-[var(--red-text)]">{error}</p>}
      {me.is_host ? (
        <button className="slab" disabled={busy} onClick={() => (alone ? setAskBots(true) : act("start"))}>
          {busy ? "Dealing films" : alone ? "Test it" : "Start swiping"}
        </button>
      ) : (
        <p className="label py-5 text-center">Waiting for the host to start</p>
      )}
    </main>
  );
}
