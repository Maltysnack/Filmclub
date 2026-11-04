"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applySwipe, buildDeck, type DeckState } from "@/lib/deck";
import { ensureUser, room, supabase } from "@/lib/supabase";
import type { Film, Mark, Participant, Round, Session, Swipe } from "@/lib/types";

const HOST_GONE_MS = 12_000;
const SAFETY_POLL_MS = 8_000;

export function useRoom(code: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [people, setPeople] = useState<Participant[]>([]);
  const [pool, setPool] = useState<Film[]>([]);
  const [deck, setDeck] = useState<DeckState | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kicked, setKicked] = useState(false);

  const gameRef = useRef<number | null>(null);
  const roundRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const swipesRef = useRef<Swipe[]>([]);
  const peopleRef = useRef<Participant[]>([]);
  useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  const me = useMemo(() => people.find((p) => p.user_id === userId) ?? null, [people, userId]);

  // Refetching is always safe: every swipe folds into the deck idempotently.
  const refresh = useCallback(async () => {
    const db = supabase();
    const { data: found } = await db.from("sessions")
      .select("id, code, status, character_set, services, game, swipe_deadline, winner_film_id, reveal_film_ids, created_at")
      .eq("code", code).maybeSingle();
    if (!found) return;
    const current = found as Session;
    setSession(current);

    const { data: members } = await db.from("participants").select("*").eq("session_id", current.id).order("joined_at");
    const list = (members ?? []) as Participant[];
    setPeople(list.filter((p) => !p.left_session));

    const [{ data: swipes }, { data: rounds }] = await Promise.all([
      db.from("swipes").select("participant_id, film_id, liked").eq("session_id", current.id),
      db.from("rounds").select("*").eq("session_id", current.id).order("number", { ascending: false }).limit(1),
    ]);
    const all = (swipes ?? []) as Swipe[];
    swipesRef.current = all;

    const latest = (rounds?.[0] ?? null) as Round | null;
    roundRef.current = latest?.id ?? null;
    setRound(latest);
    if (latest) {
      const { data: roundMarks } = await db.from("marks").select("*").eq("round_id", latest.id);
      setMarks((roundMarks ?? []) as Mark[]);
    }

    if (current.status === "lobby") return;
    const needsDeal = gameRef.current !== current.game;
    if (needsDeal) {
      const { data: films } = await db.from("session_films").select("data").eq("session_id", current.id).order("position");
      const dealt = ((films ?? []) as { data: Film }[]).map((f) => f.data);
      if (dealt.length === 0) return;
      const user = (await ensureUser()).id;
      const self = list.find((p) => p.user_id === user);
      if (!self) return;
      gameRef.current = current.game;
      setPool(dealt);
      setDeck(buildDeck(dealt, self.id, list.indexOf(self), all));
    } else {
      setDeck((d) => (d ? all.reduce(applySwipe, d) : d));
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      try {
        const user = await ensureUser();
        if (cancelled) return;
        setUserId(user.id);
        await room("join", { code });
        joinedRef.current = true;
        await refresh();
        if (cancelled) return;
        const { data: found } = await supabase().from("sessions").select("id").eq("code", code).single();
        const sid = found!.id as string;
        const db = supabase();
        const filter = `session_id=eq.${sid}`;
        const channel = db.channel(`room:${sid}`, { config: { presence: { key: user.id } } })
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${sid}` }, (payload) => {
            setSession((s) => (s ? { ...s, ...(payload.new as Session) } : s));
            refresh();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter }, () => refresh())
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "swipes", filter }, (payload) => {
            const swipe = payload.new as Swipe;
            swipesRef.current = [...swipesRef.current, swipe];
            setDeck((d) => (d ? applySwipe(d, swipe) : d));
          })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "rounds", filter }, () => refresh())
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "marks", filter }, (payload) => {
            const mark = payload.new as Mark;
            if (mark.round_id === roundRef.current) {
              setMarks((m) => (m.some((x) => x.participant_id === mark.participant_id) ? m : [...m, mark]));
            }
          })
          .on("presence", { event: "sync" }, () => {
            const online = new Set(Object.keys(channel.presenceState()));
            const host = peopleRef.current.find((p) => p.is_host);
            if (!host?.user_id || online.has(host.user_id)) {
              clearTimeout(hostTimer);
              hostTimer = undefined;
            } else if (!hostTimer) {
              hostTimer = setTimeout(() => room("claimHost", { sessionId: sid }).catch(() => {}), HOST_GONE_MS);
            }
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              channel.track({ at: Date.now() });
              refresh();
            }
          });
        let hostTimer: ReturnType<typeof setTimeout> | undefined;

        const onVisible = () => document.visibilityState === "visible" && refresh();
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("online", refresh);
        const poll = setInterval(refresh, SAFETY_POLL_MS);
        cleanup = () => {
          clearTimeout(hostTimer);
          clearInterval(poll);
          document.removeEventListener("visibilitychange", onVisible);
          window.removeEventListener("online", refresh);
          db.removeChannel(channel);
        };
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [code, refresh]);

  useEffect(() => {
    if (joinedRef.current && userId && people.length > 0 && !me) setKicked(true);
  }, [me, people, userId]);

  const deckRef = useRef<DeckState | null>(null);
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  // Local swipes apply at once. The write retries in the background and never blocks the deck.
  const swipe = useCallback((filmId: number, liked: boolean) => {
    const current = deckRef.current;
    if (!current || !session || current.swiped.has(filmId)) return;
    const next = applySwipe(current, { participant_id: current.me, film_id: filmId, liked });
    deckRef.current = next;
    setDeck(next);
    const write = async (attempt = 0): Promise<void> => {
      const { error: failed } = await supabase().from("swipes")
        .insert({ participant_id: current.me, session_id: session.id, film_id: filmId, liked });
      if (failed && failed.code !== "23505" && failed.code !== "42501" && attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        return write(attempt + 1);
      }
    };
    write();
  }, [session]);

  return { session, people, pool, deck, round, marks, me, error, kicked, swipe, refresh };
}
