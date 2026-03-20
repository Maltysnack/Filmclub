"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Logo from "@/components/Logo";
import SwipeCard from "@/components/SwipeCard";
import FilmModal from "@/components/FilmModal";
import {
  getSession, getParticipantId, getParticipants, getSessionFilms,
  getMySwipes, recordSwipe, checkForMatch, getMatches, closeSession,
} from "@/lib/session";
import { getPopularFilms, getTrendingFilms, posterUrl } from "@/lib/tmdb";
import { supabase } from "@/lib/supabase";
import { Film, Session, Participant, Match } from "@/types";
import { Plus, Users, Trophy, Share2, CheckCircle } from "lucide-react";

export default function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [films, setFilms] = useState<Film[]>([]);
  const [swiped, setSwiped] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<Film[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [loading, setLoading] = useState(true);

  // Seed pool with popular films if needed
  async function seedPool(sessionId: string) {
    const { addFilmToSession } = await import("@/lib/session");
    const [trending, popular] = await Promise.all([getTrendingFilms(), getPopularFilms(1)]);
    const combined = [...trending, ...popular].slice(0, 40);
    await Promise.all(
      combined.map((m) => addFilmToSession(sessionId, m.id, null))
    );
  }

  const loadFilms = useCallback(async (sessionId: string, participantId: string) => {
    let pool = await getSessionFilms(sessionId);

    if (pool.length < 10) {
      await seedPool(sessionId);
      pool = await getSessionFilms(sessionId);
    }

    const mySwiped = await getMySwipes(sessionId, participantId);
    setSwiped(mySwiped);

    const unswiped = pool.filter((f) => !mySwiped.has(f.id));
    // Shuffle
    for (let i = unswiped.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unswiped[i], unswiped[j]] = [unswiped[j], unswiped[i]];
    }
    setFilms(pool);
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

      // Check for existing matches
      const existingMatches = await getMatches(s.id);
      if (existingMatches.length > 0 && s.mode === "live") {
        setMatch(existingMatches[0]);
        setLoading(false);
        return;
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

  // Real-time: listen for new swipes and session_films
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`session-${session.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "swipes",
        filter: `session_id=eq.${session.id}`,
      }, async () => {
        // Reload matches after any new swipe
        if (session.mode === "live") {
          const matches = await getMatches(session.id);
          if (matches.length > 0) setMatch(matches[0]);
        }
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "session_films",
        filter: `session_id=eq.${session.id}`,
      }, async () => {
        if (!participant) return;
        await loadFilms(session.id, participant.id);
      })
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
  }, [session, participant, loadFilms]);

  async function handleSwipe(liked: boolean) {
    if (!session || !participant || currentIndex >= queue.length) return;
    const film = queue[currentIndex];

    await recordSwipe(session.id, participant.id, film.id, liked);
    setSwiped((prev) => new Set([...prev, film.id]));

    if (liked) {
      const isMatch = await checkForMatch(session.id, film.id, session.threshold);
      if (isMatch && session.mode === "live") {
        const matches = await getMatches(session.id);
        if (matches.length > 0) {
          setMatch(matches[0]);
          return;
        }
      }
    }

    const next = currentIndex + 1;
    setCurrentIndex(next);
    if (next >= queue.length) setAllDone(true);
  }

  async function handleShare() {
    const url = window.location.href;
    const text = `Join my Filmclub session! Code: ${code}\n${url}`;
    if (navigator.share) {
      await navigator.share({ title: "Filmclub", text, url });
    } else {
      await navigator.clipboard.writeText(url);
      alert("Link copied!");
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
    return <MatchScreen match={match} session={session!} onShare={handleShare} />;
  }

  const currentFilm = queue[currentIndex];
  const nextFilm = queue[currentIndex + 1];

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <Logo size="sm" />
        <div className="flex items-center gap-3">
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}
          >
            <Share2 size={13} />
            {code}
          </button>
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

      {/* Progress */}
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
        <div className="relative w-full" style={{ height: "calc(100dvh - 280px)", maxHeight: 520 }}>
          <AnimatePresence>
            {allDone ? (
              <AllDoneScreen
                mode={session?.mode ?? "live"}
                code={code}
                onResults={() => router.push(`/session/${code}/results`)}
              />
            ) : (
              <>
                {/* Next card (behind) */}
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
                {/* Current card */}
                {currentFilm && (
                  <motion.div
                    key={currentFilm.id}
                    className="absolute inset-0"
                    initial={{ scale: 1, opacity: 1 }}
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

      {/* Spacer for action buttons */}
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

function AllDoneScreen({
  mode,
  code,
  onResults,
}: {
  mode: string;
  code: string;
  onResults: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
      <CheckCircle size={48} style={{ color: "var(--accent)" }} className="mb-4" />
      <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text)" }}>
        You&apos;re all caught up
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {mode === "planned"
          ? "Results will be revealed at the deadline. Check back later."
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

function MatchScreen({ match, session, onShare }: { match: Match; session: Session; onShare: () => void }) {
  const film = match.film!;
  const router = useRouter();

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-5 relative overflow-hidden"
      style={{ background: "var(--bg)" }}>
      {/* Background poster */}
      <div className="absolute inset-0 opacity-10">
        <img
          src={posterUrl(film.poster_path, "w500")}
          alt=""
          className="w-full h-full object-cover"
        />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center max-w-xs">
        <div className="text-4xl mb-4">🎬</div>
        <h1 className="text-xl font-medium mb-1" style={{ color: "var(--accent)" }}>
          You&apos;ve got a match
        </h1>
        <p className="text-xs mb-8" style={{ color: "var(--text-muted)" }}>
          Everyone agreed on tonight&apos;s film
        </p>

        {/* Poster */}
        <div className="w-48 rounded-2xl overflow-hidden shadow-2xl mb-5"
          style={{ aspectRatio: "2/3" }}>
          <img
            src={posterUrl(film.poster_path, "w342")}
            alt={film.title}
            className="w-full h-full object-cover"
          />
        </div>

        <h2 className="text-2xl font-bold mb-1" style={{ color: "var(--text)" }}>{film.title}</h2>
        <p className="text-sm mb-8" style={{ color: "var(--text-muted)" }}>
          {film.release_year} {film.rating ? `· ★ ${film.rating}` : ""}
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
