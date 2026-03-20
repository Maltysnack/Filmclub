"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Logo from "@/components/Logo";
import SwipeCard from "@/components/SwipeCard";
import FilmModal from "@/components/FilmModal";
import {
  getSession, getParticipantId, getIsHost, getParticipants, getSessionFilms,
  getMySwipes, recordSwipe, checkForMatch, getMatches, closeSession, startSession,
} from "@/lib/session";
import { getPopularFilms, getTrendingFilms, posterUrl } from "@/lib/tmdb";
import { supabase } from "@/lib/supabase";
import { Film, Session, Participant, Match } from "@/types";
import { Plus, Users, Trophy, Share2, CheckCircle, Play } from "lucide-react";

export default function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isHost, setIsHostState] = useState(false);
  const [queue, setQueue] = useState<Film[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function seedPool(sessionId: string) {
    const { addFilmToSession } = await import("@/lib/session");
    const [trending, popular] = await Promise.all([getTrendingFilms(), getPopularFilms(1)]);
    const combined = [...trending, ...popular].slice(0, 40);
    await Promise.all(combined.map((m) => addFilmToSession(sessionId, m.id, null)));
  }

  const loadFilms = useCallback(async (sessionId: string, participantId: string) => {
    let pool = await getSessionFilms(sessionId);
    if (pool.length < 10) {
      await seedPool(sessionId);
      pool = await getSessionFilms(sessionId);
    }
    const mySwiped = await getMySwipes(sessionId, participantId);
    const unswiped = pool.filter((f) => !mySwiped.has(f.id));
    // Shuffle
    for (let i = unswiped.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unswiped[i], unswiped[j]] = [unswiped[j], unswiped[i]];
    }
    setQueue(unswiped);
    setCurrentIndex(0);
    if (unswiped.length === 0) setAllDone(true);
  }, []);

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");

      setSession(s);
      setIsHostState(getIsHost(code));

      // Check for existing live match (only matters if already started)
      if (s.started && s.mode === "live") {
        const existingMatches = await getMatches(s.id);
        if (existingMatches.length > 0 && s.status === "closed") {
          setMatch(existingMatches[0]);
          setLoading(false);
          return;
        }
      }

      const allParticipants = await getParticipants(s.id);
      const me = allParticipants.find((p) => p.id === pid) ?? null;
      setParticipant(me);
      setParticipants(allParticipants);

      await loadFilms(s.id, pid);
      setLoading(false);
    }
    init();
  }, [code, router, loadFilms]);

  // Real-time subscriptions
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`session-${session.id}`)
      // Session started / closed
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "sessions",
        filter: `id=eq.${session.id}`,
      }, (payload) => {
        const updated = payload.new as Session;
        setSession(updated);
        // If just started and already has a match, fire it
        if (updated.started && updated.mode === "live") {
          getMatches(session.id).then((matches) => {
            if (matches.length > 0 && updated.status === "closed") setMatch(matches[0]);
          });
        }
      })
      // New swipe — check match if session is started
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "swipes",
        filter: `session_id=eq.${session.id}`,
      }, async () => {
        const s = await getSession(code);
        if (s?.started && s?.mode === "live") {
          const matches = await getMatches(session.id);
          if (matches.length > 0) setMatch(matches[0]);
        }
      })
      // New film added to pool
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "session_films",
        filter: `session_id=eq.${session.id}`,
      }, async () => {
        if (!participant) return;
        await loadFilms(session.id, participant.id);
      })
      // New participant joined
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "participants",
        filter: `session_id=eq.${session.id}`,
      }, async () => {
        const updated = await getParticipants(session.id);
        setParticipants(updated);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [session, participant, loadFilms, code]);

  async function handleSwipe(liked: boolean) {
    if (!session || !participant || currentIndex >= queue.length) return;
    const film = queue[currentIndex];

    await recordSwipe(session.id, participant.id, film.id, liked);

    if (liked && session.started) {
      const isMatch = await checkForMatch(session.id, film.id, session.threshold);
      if (isMatch && session.mode === "live") {
        const matches = await getMatches(session.id);
        if (matches.length > 0) {
          await closeSession(session.id);
          setMatch(matches[0]);
          return;
        }
      }
    }

    const next = currentIndex + 1;
    setCurrentIndex(next);
    if (next >= queue.length) setAllDone(true);
  }

  async function handleStart() {
    if (!session) return;
    setStarting(true);
    await startSession(session.id);

    // Check if a match already exists from pre-start swiping
    if (session.mode === "live") {
      const pool = await getSessionFilms(session.id);
      for (const film of pool) {
        const isMatch = await checkForMatch(session.id, film.id, session.threshold);
        if (isMatch) {
          const matches = await getMatches(session.id);
          if (matches.length > 0) {
            await closeSession(session.id);
            setMatch(matches[0]);
            setStarting(false);
            return;
          }
        }
      }
    }
    setStarting(false);
  }

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: "Filmclub", text: `Join my Filmclub session! Code: ${code}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="text-center space-y-4">
          <Logo size="md" />
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading session…</p>
        </div>
      </div>
    );
  }

  // Match screen (live mode)
  if (match && match.film) {
    return <MatchScreen match={match} onShare={handleShare} />;
  }

  const currentFilm = queue[currentIndex];
  const nextFilm = queue[currentIndex + 1];
  const sessionStarted = session?.started ?? false;

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <Logo size="sm" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/session/${code}/add`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => router.push(`/session/${code}/results`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}
          >
            <Trophy size={18} />
          </button>
        </div>
      </header>

      {/* Session code + start bar */}
      <div className="px-5 pb-3 shrink-0">
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
          style={{ background: "var(--surface)" }}
        >
          {/* Code + share */}
          <button
            onClick={handleShare}
            className="flex items-center gap-2 min-w-0"
          >
            <Share2 size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <span className="font-mono font-bold tracking-widest text-sm" style={{ color: "var(--accent)" }}>
              {code}
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {copied ? "Copied!" : "tap to share"}
            </span>
          </button>

          {/* Start button — host only, only before start */}
          {isHost && !sessionStarted && (
            <button
              onClick={handleStart}
              disabled={starting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-opacity"
              style={{
                background: "var(--like)",
                color: "#0c0c0e",
                opacity: starting ? 0.6 : 1,
              }}
            >
              <Play size={12} fill="currentColor" />
              {starting ? "Starting…" : "Start session"}
            </button>
          )}

          {/* Started indicator */}
          {sessionStarted && (
            <span
              className="text-xs px-2.5 py-1 rounded-full shrink-0"
              style={{ background: "rgba(74,222,128,0.12)", color: "var(--like)" }}
            >
              Live
            </span>
          )}
        </div>

        {/* Waiting banner for non-hosts before start */}
        {!sessionStarted && !isHost && (
          <p className="text-xs text-center mt-2" style={{ color: "var(--text-muted)" }}>
            Waiting for the host to start — swipe away in the meantime
          </p>
        )}

        {/* Nudge for host */}
        {!sessionStarted && isHost && (
          <p className="text-xs text-center mt-2" style={{ color: "var(--text-muted)" }}>
            Share the code, wait for everyone to join, then hit Start
          </p>
        )}
      </div>

      {/* Participants */}
      <div className="flex items-center gap-2 px-5 pb-3 shrink-0">
        <Users size={12} style={{ color: "var(--text-muted)" }} />
        <div className="flex gap-1 flex-wrap">
          {participants.map((p) => (
            <span
              key={p.id}
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background: p.id === participant?.id ? "var(--accent)" : "var(--surface)",
                color: p.id === participant?.id ? "#0c0c0e" : "var(--text-muted)",
              }}
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-5 mb-4 shrink-0">
        <div className="h-0.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              background: "var(--accent)",
              width: queue.length > 0 ? `${(currentIndex / queue.length) * 100}%` : "0%",
            }}
          />
        </div>
        <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
          {currentIndex} of {queue.length} films
        </p>
      </div>

      {/* Card area */}
      <div className="flex-1 px-5 relative" style={{ minHeight: 0 }}>
        <div className="relative w-full" style={{ height: "calc(100dvh - 310px)", maxHeight: 480 }}>
          <AnimatePresence>
            {allDone ? (
              <AllDoneScreen
                mode={session?.mode ?? "live"}
                onResults={() => router.push(`/session/${code}/results`)}
              />
            ) : (
              <>
                {nextFilm && (
                  <SwipeCard
                    key={`${nextFilm.id}-next`}
                    film={nextFilm}
                    onLike={() => {}}
                    onDislike={() => {}}
                    onInfo={() => setInfoFilm(nextFilm)}
                    isTop={false}
                  />
                )}
                {currentFilm && (
                  <motion.div
                    key={currentFilm.id}
                    className="absolute inset-0"
                    exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.2 } }}
                  >
                    <SwipeCard
                      film={currentFilm}
                      onLike={() => handleSwipe(true)}
                      onDislike={() => handleSwipe(false)}
                      onInfo={() => setInfoFilm(currentFilm)}
                      isTop
                    />
                  </motion.div>
                )}
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="h-24 shrink-0" />

      <FilmModal
        film={infoFilm}
        onClose={() => setInfoFilm(null)}
        onLike={infoFilm && !allDone ? () => handleSwipe(true) : undefined}
        onDislike={infoFilm && !allDone ? () => handleSwipe(false) : undefined}
      />
    </div>
  );
}

function AllDoneScreen({ mode, onResults }: { mode: string; onResults: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
      <CheckCircle size={48} style={{ color: "var(--accent)" }} className="mb-4" />
      <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text)" }}>
        You&apos;re all caught up
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {mode === "planned"
          ? "Results will be revealed at the deadline."
          : "Waiting for the rest of the group. Add more films in the meantime."}
      </p>
      <button
        onClick={onResults}
        className="px-6 py-3 rounded-xl text-sm font-semibold"
        style={{ background: "var(--accent)", color: "#0c0c0e" }}
      >
        {mode === "planned" ? "See current scores" : "See what everyone liked"}
      </button>
    </div>
  );
}

function MatchScreen({ match, onShare }: { match: Match; onShare: () => void }) {
  const film = match.film!;
  const router = useRouter();

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 relative overflow-hidden"
      style={{ background: "var(--bg)" }}>
      <div className="absolute inset-0 opacity-10">
        <img src={posterUrl(film.poster_path, "w500")} alt="" className="w-full h-full object-cover" />
      </div>
      <div className="relative z-10 flex flex-col items-center text-center max-w-xs">
        <div className="text-4xl mb-4">🎬</div>
        <h1 className="text-xl font-medium mb-1" style={{ color: "var(--accent)" }}>
          You&apos;ve got a match
        </h1>
        <p className="text-xs mb-8" style={{ color: "var(--text-muted)" }}>
          Everyone agreed on tonight&apos;s film
        </p>
        <div className="w-48 rounded-2xl overflow-hidden shadow-2xl mb-5" style={{ aspectRatio: "2/3" }}>
          <img src={posterUrl(film.poster_path, "w342")} alt={film.title} className="w-full h-full object-cover" />
        </div>
        <h2 className="text-2xl font-bold mb-1" style={{ color: "var(--text)" }}>{film.title}</h2>
        <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
          {film.release_year}{film.rating ? ` · ★ ${film.rating}` : ""}
        </p>
        <div className="flex gap-3 w-full">
          <button
            onClick={onShare}
            className="flex-1 py-3 rounded-xl text-sm font-medium border"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            Share
          </button>
          <button
            onClick={() => router.push("/")}
            className="flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
