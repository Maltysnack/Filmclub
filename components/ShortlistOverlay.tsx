"use client";

import { useEffect, useRef, useState } from "react";
import { Film, ShortlistRound, ShortlistVeto, ShortlistVote } from "@/types";
import { posterUrl } from "@/lib/tmdb";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";
import SpinWheel from "@/components/SpinWheel";
import FilmWinnerScreen from "@/components/FilmWinnerScreen";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";
import { getService } from "@/lib/streaming";
import type { Region } from "@/types";
import { useLongPress } from "@/hooks/useLongPress";
import {
  startShortlist, startNomination, advanceFromNomination,
  getCurrentRound,
  submitVeto, getVetoes, advanceToVotePhase,
  submitVotes, getVotes, tallyVotes, votesAllowed,
  advanceToNextRound, completeShortlist, markSpinning,
} from "@/lib/shortlist";

type UiPhase = "loading" | "nominate" | "veto" | "vote" | "three_film" | "host_decision" | "two_film" | "winner";

interface Props {
  films: Film[];
  pinnedFilmIds?: string[];
  sessionId: string;
  participantId: string;
  isHost: boolean;
  totalParticipants: number;
  sessionServices: string[];
  region: Region;
  onComplete: (winnerId: string) => void;
}

function gridCols(n: number): number {
  if (n <= 2) return n || 1;
  if (n === 4) return 2;
  if (n > 20) return 4;
  return 3;
}

export default function ShortlistOverlay({
  films, pinnedFilmIds = [], sessionId, participantId, isHost, totalParticipants, sessionServices, region, onComplete,
}: Props) {
  const [round, setRound] = useState<ShortlistRound | null>(null);
  const [vetoes, setVetoes] = useState<ShortlistVeto[]>([]);
  const [votes, setVotes] = useState<ShortlistVote[]>([]);
  const [myVeto, setMyVeto] = useState<string | null>(null);
  const [pendingVeto, setPendingVeto] = useState<string | null>(null);
  const [myVotes, setMyVotes] = useState<string[] | null>(null);
  const [pendingVotes, setPendingVotes] = useState<string[]>([]);
  const [pendingFavourite, setPendingFavourite] = useState<string | null>(null);
  const [pendingLeast, setPendingLeast] = useState<string | null>(null);
  const [vetoExclusion, setVetoExclusion] = useState<string | null>(null);
  const [uiPhase, setUiPhase] = useState<UiPhase>("loading");
  const [spinWinnerId, setSpinWinnerId] = useState<string | null>(null);
  const [spinFilmIds, setSpinFilmIds] = useState<string[]>([]);
  const [decisionFilms, setDecisionFilms] = useState<string[]>([]);
  const [winnerFilm, setWinnerFilm] = useState<Film | null>(null);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);

  // Nomination phase state (pre-round, from results page entry point)
  const [pendingNomination, setPendingNomination] = useState<string | null>(null);
  const nominationStartedRef = useRef(false);

  const advancedRef = useRef(false);
  const roundRef = useRef<ShortlistRound | null>(null);
  const revetoCh = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const uiPhaseRef = useRef<UiPhase>("loading");
  // Always-current films ref so stale subscription closures can still find winners
  const filmsRef = useRef<Film[]>(films);
  useEffect(() => { filmsRef.current = films; }, [films]);
  // Pending winner ID — set when winner_id arrives before films prop is populated
  const [pendingWinnerId, setPendingWinnerId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingWinnerId || films.length === 0) return;
    const found = films.find(f => f.id === pendingWinnerId);
    if (found) { setWinnerFilm(found); setPendingWinnerId(null); }
  }, [pendingWinnerId, films]);

  // Derived
  const filmsInRound = round ? films.filter(f => round.film_ids.includes(f.id)) : [];
  const maxVotes = Math.max(1, votesAllowed(filmsInRound.length));
  // Nomination submitted when we have a recorded vote entry (null = not yet, [] or [id] = submitted)
  const nominationSubmitted = uiPhase === "nominate" && myVotes !== null;

  function updateUiPhase(p: UiPhase) {
    uiPhaseRef.current = p;
    setUiPhase(p);
  }

  // ── Sync UI phase from a round snapshot ───────────────────────────────────
  function syncPhase(r: ShortlistRound) {
    roundRef.current = r;
    // Leaving nomination phase — clear votes so nomination entries don't bleed into veto/vote
    if (uiPhaseRef.current === "nominate" && r.phase !== "nominate") {
      setVotes([]);
      setMyVotes(null);
      setPendingVotes([]);
    }
    if (r.phase === "complete") {
      // Don't interrupt a spin that's already playing
      if (uiPhaseRef.current === "two_film") return;
      const winner = r.winner_id ? filmsRef.current.find(f => f.id === r.winner_id) ?? null : null;
      setWinnerFilm(winner);
      // If films haven't loaded yet into the ref, queue the winner_id to resolve later
      if (!winner && r.winner_id) setPendingWinnerId(r.winner_id);
      updateUiPhase("winner");
    } else if (r.phase === "spinning") {
      // Spin state written to DB — non-hosts who missed the broadcast sync here
      setSpinWinnerId(r.winner_id ?? null);
      setSpinFilmIds(r.film_ids);
      updateUiPhase("two_film");
    } else if (r.phase === "vote") {
      updateUiPhase(r.film_ids.length === 3 ? "three_film" : "vote");
    } else if (r.phase === "nominate") {
      updateUiPhase("nominate");
    } else {
      // "veto" phase — skip straight to three_film decider when pool is exactly 3
      if (r.film_ids.length === 3) {
        if (isHost) advanceToVotePhase(sessionId, r.round_number, r.film_ids);
        updateUiPhase("three_film");
      } else {
        updateUiPhase("veto");
      }
    }
  }

  // ── Load submissions for the given round ──────────────────────────────────
  async function loadSubmissions(r: ShortlistRound) {
    const [v, vt] = await Promise.all([
      getVetoes(sessionId, r.round_number),
      getVotes(sessionId, r.round_number),
    ]);
    setVetoes(v);
    setVotes(vt);
    const mine = v.find(x => x.participant_id === participantId);
    if (mine) setMyVeto(mine.film_id);
    const myVt = vt.find(x => x.participant_id === participantId);
    if (myVt) setMyVotes(myVt.film_ids);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      let existing = await getCurrentRound(sessionId);
      if (!existing) {
        if (pinnedFilmIds.length > 0 && films.length > pinnedFilmIds.length) {
          // Nomination phase: host creates the 'nominate' round immediately so all participants
          // receive the INSERT event and open their overlays in sync.
          if (isHost) {
            existing = await startNomination(sessionId, pinnedFilmIds);
            // Fallback: if insert failed (duplicate), fetch the round that already exists
            if (!existing) existing = await getCurrentRound(sessionId);
          }
          // Non-hosts wait here — the subscription will fire when the round is created.
          updateUiPhase("nominate");
          if (existing) setRound(existing);
          return;
        }
        if (isHost) {
          existing = await startShortlist(sessionId, films.map(f => f.id));
        }
      }
      if (existing) {
        setRound(existing);
        await loadSubmissions(existing);
        syncPhase(existing);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Real-time subscriptions ───────────────────────────────────────────────
  useEffect(() => {
    const roundSub = supabase
      .channel(`sl-round:${sessionId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "shortlist_rounds",
        filter: `session_id=eq.${sessionId}`,
      }, async (payload) => {
        const r = payload.new as ShortlistRound;
        setRound(r);

        if (payload.eventType === "INSERT" && r.round_number > 1) {
          // New round — reset local state and sync immediately
          setMyVeto(null); setPendingVeto(null);
          setMyVotes(null); setPendingVotes([]);
          setPendingFavourite(null); setPendingLeast(null);
          setVetoes([]); setVotes([]);
          setVetoExclusion(null);
          advancedRef.current = false;
          syncPhase(r);
        } else {
          syncPhase(r);
        }
      })
      .subscribe(async (status) => {
        // On every (re)connect — including after a WebSocket drop — fetch the
        // current round directly from DB and re-sync. Supabase realtime doesn't
        // replay events missed during a drop, so without this a participant whose
        // connection briefly blipped during a phase transition would be stuck
        // indefinitely. syncPhase and advanceToVotePhase are both idempotent so
        // re-calling on the initial SUBSCRIBED (alongside init()) is harmless.
        if (status === "SUBSCRIBED") {
          const latest = await getCurrentRound(sessionId);
          if (latest) {
            setRound(latest);
            await loadSubmissions(latest);
            syncPhase(latest);
          }
        }
      });

    const vetoSub = supabase
      .channel(`sl-vetoes:${sessionId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shortlist_vetoes",
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const v = payload.new as ShortlistVeto;
        if (roundRef.current && v.round_number !== roundRef.current.round_number) return;
        setVetoes(prev => prev.find(x => x.participant_id === v.participant_id) ? prev : [...prev, v]);
      })
      .on("postgres_changes", {
        event: "DELETE", schema: "public", table: "shortlist_vetoes",
        filter: `session_id=eq.${sessionId}`,
      }, () => {
        setVetoes([]);
        setMyVeto(null);
      })
      .subscribe();

    const voteSub = supabase
      .channel(`sl-votes:${sessionId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shortlist_votes",
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        const v = payload.new as ShortlistVote;
        if (roundRef.current && v.round_number !== roundRef.current.round_number) return;
        setVotes(prev => prev.find(x => x.participant_id === v.participant_id) ? prev : [...prev, v]);
      })
      .subscribe();

    // Broadcast for reveto + spin coordination
    const revotoCh = supabase
      .channel(`sl-reveto:${sessionId}`)
      .on("broadcast", { event: "reveto" }, ({ payload }) => {
        const exclusion = (payload.exclusions as Record<string, string>)?.[participantId];
        if (exclusion) setVetoExclusion(exclusion);
        setMyVeto(null);
        setPendingVeto(null);
      })
      .on("broadcast", { event: "spin_start" }, ({ payload }) => {
        const { winnerId, filmIds } = payload as { winnerId: string; filmIds: string[] };
        setSpinWinnerId(winnerId);
        setSpinFilmIds(filmIds);
        updateUiPhase("two_film");
      })
      .subscribe();
    revetoCh.current = revotoCh;

    return () => {
      supabase.removeChannel(roundSub);
      supabase.removeChannel(vetoSub);
      supabase.removeChannel(voteSub);
      supabase.removeChannel(revotoCh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Broadcast spin helper ─────────────────────────────────────────────────
  function broadcastSpin(filmIds: string[]) {
    const winnerId = filmIds[Math.floor(Math.random() * filmIds.length)];
    setSpinWinnerId(winnerId);
    setSpinFilmIds(filmIds);
    updateUiPhase("two_film");
    // Broadcast for instant sync, AND write to DB so non-hosts who miss the
    // broadcast still transition via their Postgres subscription (Bug B fix).
    revetoCh.current?.send({ type: "broadcast", event: "spin_start", payload: { winnerId, filmIds } });
    if (roundRef.current) {
      markSpinning(sessionId, roundRef.current.round_number, winnerId, filmIds);
    }
  }

  // ── Host: advance veto → vote when all vetoes in ──────────────────────────
  useEffect(() => {
    if (!isHost || !round || round.phase !== "veto" || vetoes.length < totalParticipants) return;

    const vetoedIds = new Set(vetoes.map(v => v.film_id));
    const remaining = round.film_ids.filter(id => !vetoedIds.has(id));

    if (remaining.length === 0) {
      if (round.film_ids.length <= 3) {
        // Too few films for reveto to make progress — spin the pool
        broadcastSpin(round.film_ids);
      } else {
        // Regular reveto
        const exclusions: Record<string, string> = {};
        for (const v of vetoes) exclusions[v.participant_id] = v.film_id;
        revetoCh.current?.send({ type: "broadcast", event: "reveto", payload: { exclusions } });
        supabase.from("shortlist_vetoes")
          .delete()
          .eq("session_id", sessionId)
          .eq("round_number", round.round_number)
          .then(() => {});
      }
      return;
    }

    if (remaining.length === 1) {
      completeShortlist(sessionId, round.round_number, remaining[0]);
      return;
    }

    advanceToVotePhase(sessionId, round.round_number, remaining);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vetoes.length, isHost, round?.phase, totalParticipants]);

  // ── Host: tally votes when all in ─────────────────────────────────────────
  useEffect(() => {
    if (!isHost || !round || round.phase !== "vote") return;
    if (votes.length < totalParticipants) return;
    if (advancedRef.current) return;
    advancedRef.current = true;

    // ── Three-film mechanic: net score (+1 fav, −1 least, 0 middle) ──────────
    if (round.film_ids.length === 3) {
      const scores = new Map(round.film_ids.map(id => [id, 0]));
      for (const vote of votes) {
        const fav = vote.film_ids[0];
        const least = vote.film_ids[1];
        if (fav && scores.has(fav)) scores.set(fav, (scores.get(fav) ?? 0) + 1);
        if (least && scores.has(least)) scores.set(least, (scores.get(least) ?? 0) - 1);
      }
      const maxScore = Math.max(...scores.values());
      const topFilms = [...scores.entries()].filter(([, s]) => s === maxScore).map(([id]) => id);
      if (topFilms.length === 1) {
        completeShortlist(sessionId, round.round_number, topFilms[0]);
      } else {
        broadcastSpin(topFilms);
      }
      return;
    }

    // ── Survival filter vote ──────────────────────────────────────────────────
    const result = tallyVotes(round.film_ids, votes, totalParticipants);
    if ("winner" in result) {
      completeShortlist(sessionId, round.round_number, result.winner);
    } else if ("tied" in result) {
      broadcastSpin(result.tied);
    } else {
      // Multiple survivors → auto-advance to next round (#76).
      // The previous host_decision UI showed a "Vote again or spin?" choice that
      // confused hosts during testing — they didn't realise it was a decision and
      // sessions stalled. Spin remains for genuine ties (handled above).
      advanceToNextRound(sessionId, round.round_number + 1, result.survivors);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votes.length, isHost, round?.phase, totalParticipants]);

  // ── Host: advance nomination → veto when all nominations are in ─────────
  useEffect(() => {
    if (!isHost || uiPhase !== "nominate" || !round) return;
    if (votes.length < totalParticipants) return;
    if (nominationStartedRef.current) return;
    nominationStartedRef.current = true;
    const nominated = [...new Set(votes.flatMap(v => v.film_ids))];
    const allFilmIds = [...new Set([...pinnedFilmIds, ...nominated])];
    advanceFromNomination(sessionId, round.id, allFilmIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votes.length, uiPhase, round?.id, totalParticipants]);

  // ── Non-host fallback: poll DB when all vetoes counted ───────────────────
  // Supabase realtime delivers shortlist_rounds UPDATE events on a best-effort
  // basis. If the event is missed, the non-host UI deadlocks on "Waiting…".
  // When vetoes.length reaches totalParticipants we know the host is about to
  // write the phase change — wait 2 s then fetch the round directly.
  // If the subscription fires first, round?.phase changes and the cleanup
  // function cancels the timer before it fires (self-cancelling fallback).
  useEffect(() => {
    if (isHost || vetoes.length < totalParticipants || round?.phase !== "veto") return;
    const timer = setTimeout(async () => {
      const latest = await getCurrentRound(sessionId);
      if (latest && latest.phase !== roundRef.current?.phase) {
        setRound(latest);
        await loadSubmissions(latest);
        syncPhase(latest);
      }
    }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vetoes.length, round?.phase]);

  // ── Non-host fallback: poll DB when all votes counted ────────────────────
  // Same pattern as above — covers both the regular vote phase and the
  // three-film mechanic (both use round.phase === "vote").
  useEffect(() => {
    if (isHost || votes.length < totalParticipants || round?.phase !== "vote") return;
    const timer = setTimeout(async () => {
      const latest = await getCurrentRound(sessionId);
      if (latest && latest.phase !== roundRef.current?.phase) {
        setRound(latest);
        await loadSubmissions(latest);
        syncPhase(latest);
      }
    }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [votes.length, round?.phase]);

  // Winner screen is dismissed manually via the Done button — no auto-dismiss.

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleSubmitVeto() {
    if (!pendingVeto || !round) return;
    await submitVeto(sessionId, round.round_number, participantId, pendingVeto);
    setMyVeto(pendingVeto);
    setPendingVeto(null);
  }

  async function handleSubmitVotes() {
    if (pendingVotes.length === 0 || !round) return;
    await submitVotes(sessionId, round.round_number, participantId, pendingVotes);
    setMyVotes(pendingVotes);
    setPendingVotes([]);
  }

  function togglePendingVote(id: string) {
    setPendingVotes(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= maxVotes) return [...prev.slice(1), id]; // swap oldest out
      return [...prev, id];
    });
  }

  function handleTapThreeFilm(id: string) {
    if (myVotes !== null) return;
    if (id === pendingFavourite) { setPendingFavourite(null); return; }
    if (id === pendingLeast) { setPendingLeast(null); return; }
    if (!pendingFavourite) { setPendingFavourite(id); return; }
    if (!pendingLeast) { setPendingLeast(id); }
  }

  async function handleSubmitThreeFilm() {
    if (!pendingFavourite || !pendingLeast || !round) return;
    await submitVotes(sessionId, round.round_number, participantId, [pendingFavourite, pendingLeast]);
    setMyVotes([pendingFavourite, pendingLeast]);
  }

  async function handleSubmitNomination(filmId: string | null = pendingNomination) {
    const filmIds = filmId ? [filmId] : [];
    await submitVotes(sessionId, 1, participantId, filmIds);
    setMyVotes(filmIds);
  }

  function handleForceStartShortlist() {
    if (nominationStartedRef.current || !round) return;
    nominationStartedRef.current = true;
    const nominated = [...new Set(votes.flatMap(v => v.film_ids))];
    const allFilmIds = [...new Set([...pinnedFilmIds, ...nominated])];
    advanceFromNomination(sessionId, round.id, allFilmIds);
  }

  // ── Render: nomination phase ──────────────────────────────────────────────
  if (uiPhase === "nominate") {
    const pinnedFilms = films.filter(f => pinnedFilmIds.includes(f.id));
    const nominatableFilms = films.filter(f => !pinnedFilmIds.includes(f.id));
    return (
      <>
      <div className="fixed inset-0 z-50 flex flex-col items-center" style={{ background: "var(--bg)" }}>
      <div className="relative w-full flex flex-col flex-1 min-h-0 mx-auto" style={{ maxWidth: 480 }}>
        <div className="flex items-center justify-between px-5 pt-10 pb-4">
          <Logo size="sm" showText />
          <span className="text-xs px-2.5 py-1 rounded-full"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
            {pinnedFilms.length} shortlisted
          </span>
        </div>
        {nominationSubmitted ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-5 gap-3">
            <p className="text-lg font-bold" style={{ color: "var(--text)" }}>
              {myVotes && myVotes.length > 0 ? "Film added" : "Skipped"}
            </p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Waiting for others to nominate…
            </p>
            {isHost && (
              <>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {votes.length} / {totalParticipants} submitted
                </p>
                <button
                  onClick={handleForceStartShortlist}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold mt-2"
                  style={{ background: "var(--surface)", color: "var(--text)" }}>
                  Start now
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Everything scrolls together so the pinned grid never pushes nominatable films off-screen */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5">
              <div className="mb-4">
                <p className="text-lg font-bold" style={{ color: "var(--text)" }}>Add a film to the shortlist</p>
                <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                  These are already in. Pick one from below to add, or skip.
                </p>
              </div>
              {/* Pinned films */}
              <p className="text-xs font-medium uppercase tracking-wider mb-2"
                style={{ color: "var(--text-muted)" }}>Already shortlisted</p>
              <div className="grid gap-2 mb-5" style={{ gridTemplateColumns: `repeat(${gridCols(pinnedFilms.length)}, minmax(0, 1fr))` }}>
                {pinnedFilms.map(film => (
                  <DisplayCard key={film.id} onInfo={() => setInfoFilm(film)}
                    className="relative rounded-xl overflow-hidden" style={{ aspectRatio: "2/3" }}>
                    {film.poster_path
                      ? <img src={posterUrl(film.poster_path, "w342")} alt={film.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-xs text-center p-2"
                          style={{ background: "var(--surface)", color: "var(--text-muted)" }}>{film.title}</div>}
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: "var(--like)" }}>
                      <span style={{ fontSize: 10, color: "#fff", fontWeight: 700 }}>✓</span>
                    </div>
                  </DisplayCard>
                ))}
              </div>
              {/* Nominatable films */}
              <p className="text-xs font-medium uppercase tracking-wider mb-2"
                style={{ color: "var(--text-muted)" }}>Add one</p>
              <div className="grid gap-3 pb-6" style={{ gridTemplateColumns: `repeat(${gridCols(nominatableFilms.length)}, minmax(0, 1fr))` }}>
                {nominatableFilms.map(film => {
                  const selected = pendingNomination === film.id;
                  return (
                    <PressableCard key={film.id}
                      onInfo={() => setInfoFilm(film)}
                      onClick={() => setPendingNomination(selected ? null : film.id)}
                      className="relative rounded-xl overflow-hidden transition-all"
                      style={{ aspectRatio: "2/3", border: `2px solid ${selected ? "var(--like)" : "transparent"}` }}>
                      {film.poster_path
                        ? <img src={posterUrl(film.poster_path, "w342")} alt={film.title} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-xs text-center p-2"
                            style={{ background: "var(--surface)", color: "var(--text-muted)" }}>{film.title}</div>}
                      {selected && (
                        <div className="absolute inset-0 flex items-center justify-center"
                          style={{ background: "rgba(0,0,0,0.45)" }}>
                          <span className="text-white text-2xl font-bold">✓</span>
                        </div>
                      )}
                    </PressableCard>
                  );
                })}
              </div>
            </div>
            {/* Button row pinned at bottom — shrink-0 so it never overlaps content */}
            <div className="shrink-0 px-5 pb-8 pt-3 flex gap-3"
              style={{ background: "linear-gradient(to top, var(--bg) 80%, transparent)" }}>
              <button
                onClick={() => handleSubmitNomination(null)}
                className="flex-1 py-4 rounded-2xl text-sm font-semibold"
                style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                Skip
              </button>
              <button
                onClick={() => handleSubmitNomination(pendingNomination)}
                disabled={!pendingNomination}
                className="flex-1 py-4 rounded-2xl text-sm font-semibold"
                style={{ background: "var(--accent)", color: "#0c0c0e", opacity: pendingNomination ? 1 : 0.4 }}>
                Add film
              </button>
            </div>
          </>
        )}
      </div>
      </div>
      <FilmInfoOverlay film={infoFilm} onClose={() => setInfoFilm(null)} sessionServices={sessionServices} />
      </>
    );
  }

  // ── Render: loading ───────────────────────────────────────────────────────
  if (uiPhase === "loading") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Setting up shortlist…</p>
      </div>
    );
  }

  // ── Render: 2-film spin wheel ─────────────────────────────────────────────
  if (uiPhase === "two_film") {
    if (!spinWinnerId) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3" style={{ background: "var(--bg)" }}>
          <Logo size="sm" showText />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>It's a tie — spinning…</p>
        </div>
      );
    }
    const spinFilms = films.filter(f => spinFilmIds.includes(f.id));
    const spinMatches = spinFilms.map(f => ({
      id: f.id, session_id: sessionId, film_id: f.id,
      score: 1, matched_at: new Date().toISOString(), film: f,
    }));
    return (
      <SpinWheel
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        films={spinMatches as any}
        winnerId={spinWinnerId}
        onComplete={() => {
          const r = roundRef.current;
          if (isHost && r) completeShortlist(sessionId, r.round_number, spinWinnerId);
          setWinnerFilm(films.find(f => f.id === spinWinnerId) ?? null);
          updateUiPhase("winner");
        }}
      />
    );
  }

  // ── Render: winner reveal ─────────────────────────────────────────────────
  if (uiPhase === "winner") {
    const completionId = winnerFilm?.id ?? roundRef.current?.winner_id ?? "";
    if (!winnerFilm) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--bg)" }}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading result…</p>
        </div>
      );
    }
    return (
      <FilmWinnerScreen
        film={winnerFilm}
        sessionServices={sessionServices}
        region={region}
        onDone={() => completionId && onComplete(completionId)}
        doneDisabled={!completionId}
      />
    );
  }

  // ── Render: three-film favourite/least mechanic ───────────────────────────
  if (uiPhase === "three_film") {
    const submittedThree = myVotes !== null;
    const myFav = myVotes?.[0] ?? pendingFavourite;
    const myLeast = myVotes?.[1] ?? pendingLeast;
    const waitingForThree = totalParticipants - votes.length;

    return (
      <>
      <div className="fixed inset-0 z-50 flex flex-col items-center" style={{ background: "var(--bg)" }}>
      <div className="relative w-full flex flex-col flex-1 min-h-0 mx-auto" style={{ maxWidth: 480 }}>
        <div className="flex items-center justify-between px-5 pt-10 pb-4">
          <Logo size="sm" showText />
          <span className="text-xs px-2.5 py-1 rounded-full"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
            Final three
          </span>
        </div>
        <div className="px-5 mb-4">
          <p className="text-lg font-bold" style={{ color: "var(--text)" }}>
            Pick your favourite and least favourite
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {submittedThree
              ? waitingForThree > 0 ? `Waiting for ${waitingForThree} more…` : "All votes in. Waiting for host"
              : "The remaining film gets the middle position"
            }
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-5">
          <div className="grid gap-3 pb-32" style={{ gridTemplateColumns: `repeat(${gridCols(filmsInRound.length)}, minmax(0, 1fr))` }}>
            {filmsInRound.map(film => {
              const isFav = myFav === film.id;
              const isLeast = myLeast === film.id;
              const isMiddle = submittedThree && !isFav && !isLeast;
              const borderColor = isFav ? "var(--like)" : isLeast ? "var(--dislike)" : "transparent";
              return (
                <PressableCard key={film.id}
                  onInfo={() => setInfoFilm(film)}
                  onClick={() => handleTapThreeFilm(film.id)}
                  disabled={submittedThree}
                  className="relative rounded-xl overflow-hidden transition-all"
                  style={{ aspectRatio: "2/3", border: `2px solid ${borderColor}`, opacity: isMiddle ? 0.4 : 1 }}>
                  {film.poster_path ? (
                    <img src={posterUrl(film.poster_path, "w342")} alt={film.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-center p-2"
                      style={{ background: "var(--surface)", color: "var(--text-muted)" }}>{film.title}</div>
                  )}
                  {(isFav || isLeast) && (
                    <div className="absolute inset-0 flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.45)" }}>
                      <span className="text-white text-2xl font-bold">{isFav ? "♥" : "✕"}</span>
                    </div>
                  )}
                </PressableCard>
              );
            })}
          </div>
        </div>
        {!submittedThree && (
          <div className="absolute bottom-0 left-0 right-0 p-5"
            style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
            <button
              onClick={handleSubmitThreeFilm}
              disabled={!pendingFavourite || !pendingLeast}
              className="w-full py-4 rounded-2xl text-sm font-semibold transition-opacity"
              style={{
                background: "var(--accent)",
                color: "#0c0c0e",
                opacity: (!pendingFavourite || !pendingLeast) ? 0.4 : 1,
              }}>
              Confirm
            </button>
          </div>
        )}
      </div>
      </div>
      <FilmInfoOverlay film={infoFilm} onClose={() => setInfoFilm(null)} sessionServices={sessionServices} />
      </>
    );
  }

  // ── Render: host decision (keep narrowing vs spin) ───────────────────────
  if (uiPhase === "host_decision") {
    const decisionFilmObjs = films.filter(f => decisionFilms.includes(f.id));
    return (
      <>
      <div className="fixed inset-0 z-50 flex flex-col items-center" style={{ background: "var(--bg)" }}>
      <div className="w-full flex flex-col flex-1 min-h-0 mx-auto" style={{ maxWidth: 480 }}>
        <div className="flex items-center justify-between px-5 pt-10 pb-4">
          <Logo size="sm" showText />
          <span className="text-xs px-2.5 py-1 rounded-full"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
            {decisionFilms.length} films left
          </span>
        </div>
        <div className="px-5 mb-5">
          <p className="text-lg font-bold" style={{ color: "var(--text)" }}>Vote again or spin?</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5">
          <div className="grid gap-3 pb-8" style={{ gridTemplateColumns: `repeat(${gridCols(decisionFilmObjs.length)}, minmax(0, 1fr))` }}>
            {decisionFilmObjs.map(film => (
              <DisplayCard key={film.id} onInfo={() => setInfoFilm(film)}
                className="relative rounded-xl overflow-hidden"
                style={{ aspectRatio: "2/3" }}>
                {film.poster_path ? (
                  <img src={posterUrl(film.poster_path, "w342")} alt={film.title}
                    className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-center p-2"
                    style={{ background: "var(--surface)", color: "var(--text-muted)" }}>{film.title}</div>
                )}
              </DisplayCard>
            ))}
          </div>
        </div>
        <div className="shrink-0 px-5 pb-8 flex flex-row gap-3">
          <button
            onClick={() => advanceToNextRound(sessionId, (round?.round_number ?? 0) + 1, decisionFilms)}
            className="flex-1 py-4 rounded-2xl text-sm font-semibold flex items-center justify-center"
            style={{ background: "rgba(232,184,109,0.12)", color: "var(--accent)" }}>
            Vote
          </button>
          <button
            onClick={() => broadcastSpin(decisionFilms)}
            className="flex-1 py-4 rounded-2xl text-sm font-semibold flex items-center justify-center"
            style={{ background: "rgba(232,184,109,0.12)", color: "var(--accent)" }}>
            Spin
          </button>
        </div>
      </div>
      </div>
      <FilmInfoOverlay film={infoFilm} onClose={() => setInfoFilm(null)} sessionServices={sessionServices} />
      </>
    );
  }

  // ── Render: veto / vote grid ──────────────────────────────────────────────
  const submitted = uiPhase === "veto" ? myVeto !== null : myVotes !== null;
  const submittedCount = uiPhase === "veto" ? vetoes.length : votes.length;
  const waitingFor = totalParticipants - submittedCount;

  return (
    <>
    <div className="fixed inset-0 z-50 flex flex-col items-center" style={{ background: "var(--bg)" }}>
    <div className="relative w-full flex flex-col flex-1 min-h-0 mx-auto" style={{ maxWidth: 480 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-10 pb-4">
        <Logo size="sm" showText />
        <span className="text-xs px-2.5 py-1 rounded-full"
          style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
          Round {round?.round_number ?? 1}
        </span>
      </div>

      {/* Phase heading */}
      <div className="px-5 mb-4">
        <p className="text-lg font-bold" style={{ color: "var(--text)" }}>
          {uiPhase === "veto"
            ? "Remove one film"
            : `Vote for your favourite${maxVotes > 1 ? `s (up to ${maxVotes})` : ""}`
          }
        </p>
        {submitted && (
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {waitingFor > 0 ? `Waiting for ${waitingFor} more…` : "All votes in. Waiting for host"}
          </p>
        )}
      </div>

      {/* Film grid */}
      <div className="flex-1 overflow-y-auto px-5">
        <div className="grid gap-3 pb-32" style={{ gridTemplateColumns: `repeat(${gridCols(filmsInRound.length)}, minmax(0, 1fr))` }}>
          {filmsInRound.map(film => {
            const excluded = uiPhase === "veto" && film.id === vetoExclusion;
            const active = uiPhase === "veto"
              ? film.id === pendingVeto || film.id === myVeto
              : pendingVotes.includes(film.id) || (myVotes ?? []).includes(film.id);
            const disabled = submitted || excluded;
            // Veto active = thicker (4px) red border + REMOVE stamp.
            // Vote active = standard (2px) green border + tick.
            // Strong visual difference between phases prevents the veto/vote mix-up
            // that caused someone to remove a film they meant to save (#76).
            const borderWidth = uiPhase === "veto" && active ? 4 : 2;
            const borderColor = active
              ? uiPhase === "veto" ? "var(--dislike)" : "var(--like)"
              : "transparent";

            return (
              <PressableCard key={film.id}
                onInfo={() => setInfoFilm(film)}
                onClick={() => {
                  if (disabled) return;
                  if (uiPhase === "veto") setPendingVeto(film.id === pendingVeto ? null : film.id);
                  else togglePendingVote(film.id);
                }}
                disabled={disabled}
                className="relative rounded-xl overflow-hidden transition-all"
                style={{ aspectRatio: "2/3", border: `${borderWidth}px solid ${borderColor}`, opacity: disabled && !active ? 0.35 : 1 }}>
                {film.poster_path ? (
                  <img src={posterUrl(film.poster_path, "w342")} alt={film.title}
                    className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-center p-2"
                    style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
                    {film.title}
                  </div>
                )}
                {active && uiPhase === "veto" && (
                  <>
                    <div className="absolute inset-0"
                      style={{ background: "linear-gradient(225deg, rgba(248,113,113,0.4) 0%, rgba(0,0,0,0.55) 100%)" }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span
                        className="px-3 py-1.5 rounded-lg border-2 font-bold text-base tracking-widest rotate-[-15deg]"
                        style={{
                          borderColor: "var(--dislike)",
                          color: "var(--dislike)",
                          background: "rgba(12,12,14,0.7)",
                        }}>
                        REMOVE
                      </span>
                    </div>
                  </>
                )}
                {active && uiPhase !== "veto" && (
                  <div className="absolute inset-0 flex items-center justify-center"
                    style={{ background: "rgba(0,0,0,0.45)" }}>
                    <span className="text-white text-2xl font-bold">✓</span>
                  </div>
                )}
              </PressableCard>
            );
          })}
        </div>
      </div>

      {/* Submit button */}
      {!submitted && (
        <div className="absolute bottom-0 left-0 right-0 p-5"
          style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
          <button
            onClick={uiPhase === "veto" ? handleSubmitVeto : handleSubmitVotes}
            disabled={uiPhase === "veto" ? !pendingVeto : pendingVotes.length === 0}
            className="w-full py-4 rounded-2xl text-sm font-semibold transition-opacity"
            style={{
              // Veto submit = dislike colour, vote submit = accent. Reinforces
              // the phase identity throughout the UI (#76).
              background: uiPhase === "veto" ? "var(--dislike)" : "var(--accent)",
              color: uiPhase === "veto" ? "#fff" : "#0c0c0e",
              opacity: (uiPhase === "veto" ? !pendingVeto : pendingVotes.length === 0) ? 0.4 : 1,
            }}>
            {uiPhase === "veto"
              ? "Remove this film"
              : `Vote${pendingVotes.length > 0 ? ` (${pendingVotes.length})` : ""}`
            }
          </button>
        </div>
      )}
    </div>
    </div>
    <FilmInfoOverlay film={infoFilm} onClose={() => setInfoFilm(null)} sessionServices={sessionServices} />
    </>
  );
}

// ── Sub-components for long-pressable film cards ──────────────────────────

function PressableCard({
  onInfo,
  onClick,
  disabled,
  style,
  className,
  children,
}: {
  onInfo: () => void;
  onClick?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  const { handlers, consumeFired } = useLongPress(onInfo);
  return (
    <button
      type="button"
      disabled={disabled}
      className={className}
      style={style}
      {...handlers}
      onClick={(e) => {
        if (consumeFired()) { e.preventDefault(); return; }
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

function DisplayCard({
  onInfo,
  style,
  className,
  children,
}: {
  onInfo: () => void;
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  const { handlers } = useLongPress(onInfo);
  return (
    <div className={className} style={style} {...handlers}>
      {children}
    </div>
  );
}
