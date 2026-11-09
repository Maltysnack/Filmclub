"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applySwipe, buildDeck, type DeckState } from "@/lib/deck";
import { ensureUser, report, room, supabase } from "@/lib/supabase";
import type { Film, Mark, Participant, Round, Session, Swipe } from "@/lib/types";

const HOST_GONE_MS = 12_000;
const SAFETY_POLL_MS = 15_000;
const NOTICE_MS = 5_000;

type RoundWithMarks = Round & { marks?: Mark[] };

export function useRoom(code: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [members, setMembers] = useState<Participant[]>([]); // everyone who ever joined, in join order
  const [pool, setPool] = useState<Film[]>([]);
  const [deck, setDeck] = useState<DeckState | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kicked, setKicked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const gameRef = useRef<number | null>(null);
  const roundRef = useRef<string | null>(null);
  const joinedRef = useRef(false);
  const peopleRef = useRef<Participant[]>([]);

  const people = useMemo(() => members.filter((p) => !p.left_session), [members]);
  useEffect(() => {
    peopleRef.current = people;
  }, [people]);
  const me = useMemo(() => people.find((p) => p.user_id === userId) ?? null, [people, userId]);

  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const showRound = useCallback((latest: Round | null, latestMarks?: Mark[]) => {
    if (latest?.id !== roundRef.current) setMarks([]);
    roundRef.current = latest?.id ?? null;
    setRound(latest);
    if (latestMarks) setMarks(latestMarks);
  }, []);

  // Reads everything in two steps: the session, then the rest at once.
  // Refetching is always safe: every swipe folds into the deck idempotently.
  const load = useCallback(async () => {
    const db = supabase();
    const { data: found } = await db.from("sessions")
      .select("id, code, status, character_set, services, game, swipe_deadline, winner_film_id, reveal_film_ids, created_at")
      .eq("code", code).maybeSingle();
    if (!found) return;
    const current = found as Session;
    const needsDeal = current.status !== "lobby" && gameRef.current !== current.game;

    const [{ data: list }, { data: swipes }, { data: rounds }, { data: films }] = await Promise.all([
      db.from("participants").select("*").eq("session_id", current.id).order("joined_at"),
      db.from("swipes").select("participant_id, film_id, liked").eq("session_id", current.id),
      db.from("rounds").select("*, marks(*)").eq("session_id", current.id).order("number", { ascending: false }).limit(1),
      needsDeal
        ? db.from("session_films").select("data").eq("session_id", current.id).order("position")
        : Promise.resolve({ data: null }),
    ]);
    const everyone = (list ?? []) as Participant[];
    const all = (swipes ?? []) as Swipe[];
    sessionRef.current = current;
    setSession(current);
    setMembers(everyone);
    const latest = ((rounds ?? [])[0] ?? null) as RoundWithMarks | null;
    showRound(latest, latest?.marks ?? []);

    if (current.status === "lobby") return;
    if (needsDeal) {
      const dealt = ((films ?? []) as { data: Film }[]).map((f) => f.data);
      if (dealt.length === 0) return;
      const user = (await ensureUser()).id;
      const self = everyone.find((p) => p.user_id === user);
      if (!self) return;
      gameRef.current = current.game;
      setPool(dealt);
      setDeck(buildDeck(dealt, self.id, everyone.indexOf(self), all));
    } else {
      setDeck((d) => (d ? all.reduce(applySwipe, d) : d));
    }
  }, [code, showRound]);

  // One load at a time. A request made during a load runs once more afterwards, so a
  // slow, older read can never land on top of a newer one.
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = async () => {
      do {
        again.current = false;
        await load().catch(() => {});
      } while (again.current);
    };
    running.current = run().finally(() => {
      running.current = null;
    });
    return running.current;
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      try {
        const user = await ensureUser();
        if (cancelled) return;
        setUserId(user.id);
        // Someone already in the session sees it straight away; a newcomer waits for the join.
        await Promise.all([room("join", { code }), refresh()]);
        joinedRef.current = true;
        if (!sessionRef.current) await refresh();
        if (cancelled || !sessionRef.current) return;
        const sid = sessionRef.current.id;
        const db = supabase();
        const filter = `session_id=eq.${sid}`;
        let hostTimer: ReturnType<typeof setTimeout> | undefined;
        const channel = db.channel(`room:${sid}`, { config: { presence: { key: user.id } } })
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sessions", filter: `id=eq.${sid}` }, (payload) => {
            const next = payload.new as Session;
            const before = sessionRef.current;
            sessionRef.current = before ? { ...before, ...next } : before;
            setSession((s) => (s ? { ...s, ...next } : s));
            // A new phase or a new game needs films or a round this phone doesn't have yet.
            if (!before || before.status !== next.status || before.game !== next.game) refresh();
          })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "participants", filter }, (payload) => {
            const added = payload.new as Participant;
            setMembers((list) => (list.some((p) => p.id === added.id) ? list : [...list, added]));
          })
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "participants", filter }, (payload) => {
            const changed = payload.new as Participant;
            setMembers((list) => list.map((p) => (p.id === changed.id ? changed : p)));
          })
          // Deletes can't be filtered to one session, so a removal reloads instead.
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "participants" }, () => refresh())
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "swipes", filter }, (payload) => {
            const swipe = payload.new as Swipe;
            setDeck((d) => (d ? applySwipe(d, swipe) : d));
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter }, (payload) => {
            // A new round, or the current one resolving or getting extra time. Deletes carry no row.
            const changed = payload.new as Round;
            if (changed?.id) showRound(changed);
          })
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
  }, [code, refresh, showRound]);

  useEffect(() => {
    if (joinedRef.current && userId && people.length > 0 && !me) setKicked(true);
  }, [me, people, userId]);

  const pendingRef = useRef(new Set<Promise<void>>());
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
      // Already saved, or swiping had just ended: nothing to do.
      if (!failed || failed.code === "23505" || failed.code === "42501") return;
      // The film is not in this game, so this phone is behind. Catch up instead of retrying.
      if (failed.code === "23503") {
        report(session.id, "swipe_failed", { film: filmId, code: failed.code, game: session.game });
        notify("Your deck was out of date. It has been refreshed.");
        refresh();
        return;
      }
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        return write(attempt + 1);
      }
      report(session.id, "swipe_failed", { film: filmId, code: failed.code, message: failed.message.slice(0, 120) });
      notify("A swipe didn't save. Check your connection.");
    };
    const pending = write().finally(() => pendingRef.current.delete(pending));
    pendingRef.current.add(pending);
  }, [session, notify, refresh]);

  // Resolves once local swipes have reached the database, or after 3 seconds.
  const flush = useCallback(
    () => Promise.race([Promise.allSettled([...pendingRef.current]), new Promise((r) => setTimeout(r, 3000))]).then(() => {}),
    [],
  );

  return { session, people, pool, deck, round, marks, me, error, kicked, notice, notify, swipe, flush, refresh };
}
