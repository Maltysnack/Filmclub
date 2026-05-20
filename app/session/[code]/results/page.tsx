"use client";

import { useEffect, useState, use, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trophy, Search, Layers } from "lucide-react";
import { useLongPress } from "@/hooks/useLongPress";
import { getSession, getParticipantId, getIsHost, getFilmScores, closeSession, getParticipants, getMySwipes, recordSwipe, removeParticipant, checkAllMatches, resolveMatch } from "@/lib/session";
import { logEvent } from "@/lib/telemetry";
import { getCurrentRound } from "@/lib/shortlist";
import { supabase } from "@/lib/supabase";
import { posterUrl, getFilmDetail, tmdbToFilm } from "@/lib/tmdb";
import { participantColor, getCharacterFilm } from "@/lib/names";
import { Film, Session, Participant } from "@/types";
import Logo from "@/components/Logo";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";
import KickedScreen from "@/components/KickedScreen";
import ShortlistOverlay from "@/components/ShortlistOverlay";
import ParticipantPill from "@/components/ParticipantPill";

interface FilmScore {
  film: Film;
  score: number;
  total: number;
  likedByIds: string[];
}

export default function ResultsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [scores, setScores] = useState<FilmScore[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [charInfoFilm, setCharInfoFilm] = useState<Film | null>(null);
  // Films this user has already swiped on (either direction). Used to disable
  // the heart in the FilmInfoOverlay so an accidental tap can't upsert a
  // previous dislike into a like (the original ghost-like bug). See #82.
  const [mySwiped, setMySwiped] = useState<Set<string>>(new Set());

  async function handleCharacterFilmClick(name: string) {
    const charFilm = getCharacterFilm(name);
    if (!charFilm) return;
    const detail = await getFilmDetail(charFilm.tmdbId);
    if (!detail) return;
    setCharInfoFilm({ ...tmdbToFilm(detail), id: `char-${detail.id}` });
  }
  const [isKicked, setIsKicked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const refreshScoresRef = useRef<(() => Promise<void>) | null>(null);
  const [showShortlist, setShowShortlist] = useState(false);
  const [showShortlistConfirm, setShowShortlistConfirm] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const resultSlCh = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const kicksChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const scoresRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHost = getIsHost(code);
  const myParticipantId = getParticipantId(code) ?? "";

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");

      setSession(s);

      const [allScores, allParticipants, swiped] = await Promise.all([
        getFilmScores(s.id),
        getParticipants(s.id),
        getMySwipes(s.id, pid),
      ]);

      setParticipants(allParticipants);
      setMySwiped(swiped);

      if (!allParticipants.some(p => p.id === pid)) {
        setIsKicked(true);
        setLoading(false);
        return;
      }

      const tiebreakerIds = s.tiebreaker_film_ids?.length ? new Set(s.tiebreaker_film_ids) : null;
      const filtered = allScores
        .filter((fs) => fs.score > 0)
        .filter((fs) => !tiebreakerIds || tiebreakerIds.has(fs.film.id));
      setScores(filtered);
      setLoading(false);

      // Auto-open shortlist overlay if a round is already active
      const activeRound = await getCurrentRound(s.id);
      if (activeRound && activeRound.phase !== "complete") setShowShortlist(true);
    }
    init();
  }, [code, router]);

  // Auto-open overlay: check for already-active round on mount, and listen for new ones
  useEffect(() => {
    if (!session) return;
    // Someone might arrive here after the round was already created — check immediately
    getCurrentRound(session.id).then(r => {
      if (r && r.phase !== "complete") setShowShortlist(true);
    });
    const sessionId = session.id;
    const tiebreakerIds = session.tiebreaker_film_ids?.length
      ? new Set(session.tiebreaker_film_ids) : null;

    async function refreshScores() {
      const fresh = await getFilmScores(sessionId);
      const filtered = fresh
        .filter((fs) => fs.score > 0)
        .filter((fs) => !tiebreakerIds || tiebreakerIds.has(fs.film.id));
      setScores(filtered);
    }
    refreshScoresRef.current = refreshScores;

    const ch = supabase
      .channel(`results-sl:${session.id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "sessions",
        filter: `id=eq.${session.id}`,
      }, (payload) => {
        // If a match closes the session while we're on /results, the deck page
        // owns the MatchScreen render path — route there so it renders. See #81.
        const updated = payload.new as Session;
        if (updated.status === "closed") router.push(`/session/${code}`);
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shortlist_rounds",
        filter: `session_id=eq.${session.id}`,
      }, () => setShowShortlist(true))
      .on("broadcast", { event: "shortlist_open" }, () => setShowShortlist(true))
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "swipes",
        filter: `session_id=eq.${session.id}`,
      }, () => {
        // Debounce — if several swipes land in quick succession only one refresh fires
        if (scoresRefreshTimer.current) clearTimeout(scoresRefreshTimer.current);
        scoresRefreshTimer.current = setTimeout(refreshScores, 400);
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "participants",
        filter: `session_id=eq.${session.id}`,
      }, (payload) => {
        const p = payload.new as Participant;
        setParticipants(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p]);
      })
      .subscribe((status) => {
        logEvent(session.id, myParticipantId, "realtime.channel_status", { channel: "results-sl", status });
      });
    resultSlCh.current = ch;

    // Broadcast channel: receives kick events from the host so all clients
    // update their pill list immediately without relying on postgres_changes DELETE
    // (which requires REPLICA IDENTITY FULL for unfiltered delivery).
    const kicksCh = supabase
      .channel(`kicks:${session.id}`)
      .on("broadcast", { event: "participant_removed" }, async ({ payload }) => {
        const removedId = payload.id as string;
        setParticipants(prev => prev.filter(p => p.id !== removedId));
        refreshScores();
        if (removedId === myParticipantId) {
          // Verify against the DB before showing KickedScreen — see #49 + the
          // matching guard on the deck page. Self-kick path is the only one
          // that needs validation; pill-list filtering is cosmetic.
          const { data } = await supabase.from("participants").select("id").eq("id", myParticipantId).maybeSingle();
          if (!data) setIsKicked(true);
        }
      })
      .subscribe();
    kicksChRef.current = kicksCh;

    // Belt-and-suspenders: subscribe to own participant row deletion via PK filter.
    // PK-filter DELETE events are always delivered without REPLICA IDENTITY FULL.
    const selfCh = supabase
      .channel(`self-kick:${myParticipantId}`)
      .on("postgres_changes", {
        event: "DELETE", schema: "public", table: "participants",
        filter: `id=eq.${myParticipantId}`,
      }, () => setIsKicked(true))
      .subscribe();

    return () => {
      resultSlCh.current = null;
      kicksChRef.current = null;
      supabase.removeChannel(ch);
      supabase.removeChannel(kicksCh);
      supabase.removeChannel(selfCh);
      if (scoresRefreshTimer.current) clearTimeout(scoresRefreshTimer.current);
    };
  }, [session?.id]);

  async function handleClose() {
    if (!session) return;
    setClosing(true);
    await closeSession(session.id);
    setSession((s) => s ? { ...s, status: "closed" } : s);
    setClosing(false);
  }

  function gridCols(n: number): number {
    if (n <= 2) return n || 1;
    if (n === 4) return 2;
    if (n > 20) return 4;
    return 3;
  }
  function alsoLikedCols(n: number): number {
    if (n <= 3) return n || 1;
    if (n <= 8) return 4;
    return 5;
  }

  const topFilm = scores[0];
  const topScore = topFilm?.score ?? 0;
  const tiedFilms = scores.filter(s => s.score === topScore);
  const isTiedTop = tiedFilms.length > 1;
  const remainingFilms = isTiedTop ? scores.filter(s => s.score < topScore) : scores.slice(1);

  if (isKicked) {
    return (
      <KickedScreen
        sessionCode={code}
        sessionId={session?.id ?? ""}
        takenNames={participants.map(p => p.name)}
      />
    );
  }

  // Long press for top film hero (single card, safe to call at component level)
  const topFilmLp = useLongPress(() => topFilm && setInfoFilm(topFilm.film));

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
    <div className="flex flex-col h-dvh mx-auto" style={{ maxWidth: 480 }}>
      {/* Header */}
      <header className="flex items-center px-5 pt-5 pb-4 shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <Logo size="sm" showText={false} />
          <div>
            <p className="text-lg font-light tracking-[0.15em] uppercase leading-tight" style={{ color: "var(--text)" }}>Results</p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{code}</p>
          </div>
        </div>
        <div className="flex-1" />
        {!loading && isHost && scores.length >= 1 && session?.status !== "closed" && (
          <button
            onClick={() => setShowShortlistConfirm(true)}
            className="shrink-0 whitespace-nowrap px-5 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e" }}>
            Shortlist Vote
          </button>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => router.push(`/session/${code}/add`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Search size={18} />
          </button>
          <button onClick={() => router.push(`/session/${code}`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Layers size={18} />
          </button>
        </div>
      </header>

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
        </div>
      )}

      {!loading && (
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          {/* Participants */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {participants.map((p) => {
              const canRemove = isHost && p.id !== myParticipantId;
              return (
                <ParticipantPill
                  key={p.id}
                  name={p.name}
                  isMe={p.id === myParticipantId}
                  onClick={canRemove ? () => setConfirmRemoveId(p.id) : undefined}
                  onFilmClick={getCharacterFilm(p.name) ? () => handleCharacterFilmClick(p.name) : undefined}
                />
              );
            })}
          </div>

          {scores.length === 0 ? (
            <div className="text-center py-12">
              <Trophy size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No likes yet. Get swiping.
              </p>
            </div>
          ) : (
            <>
              {/* Top pick — single clear winner */}
              {!isTiedTop && topFilm && (
                <div className="mb-5">
                  <p className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--accent)" }}>
                    Top pick
                  </p>
                  <motion.div
                    className="w-full relative rounded-2xl overflow-hidden text-left"
                    style={{ aspectRatio: "16/9", background: "var(--surface)" }}
                    {...topFilmLp.handlers}
                  >
                    <img
                      src={posterUrl(topFilm.film.backdrop_path ?? topFilm.film.poster_path, "w500")}
                      alt={topFilm.film.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0" style={{
                      background: "linear-gradient(to top, rgba(12,12,14,0.95) 0%, transparent 60%)",
                    }} />
                    <div className="absolute bottom-4 left-4 right-4">
                      <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text)" }}>
                        {topFilm.film.title}
                      </h2>
                      <ScoreBar score={topFilm.score} total={topFilm.total} highlight />
                      <LikedByNames ids={topFilm.likedByIds} participants={participants} />
                    </div>
                  </motion.div>
                </div>
              )}

              {/* Top picks — tied films grid */}
              {isTiedTop && (
                <div className="mb-5">
                  <p className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--accent)" }}>
                    Top picks
                  </p>
                  <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${gridCols(tiedFilms.length)}, minmax(0, 1fr))` }}>
                    {tiedFilms.map(({ film }) => (
                      <ResultsFilmCard key={film.id} film={film} onInfo={setInfoFilm}
                        className="relative rounded-xl overflow-hidden text-left"
                        style={{ aspectRatio: "2/3", background: "var(--surface)" }}>
                        {film.poster_path ? (
                          <img src={posterUrl(film.poster_path, "w342")} alt={film.title}
                            className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center p-2 text-xs text-center"
                            style={{ color: "var(--text-muted)" }}>{film.title}</div>
                        )}
                        <div className="absolute inset-0"
                          style={{ background: "linear-gradient(to top, rgba(12,12,14,0.85) 0%, transparent 50%)" }} />
                        <p className="absolute bottom-2 left-2 right-2 text-xs font-medium leading-tight"
                          style={{ color: "var(--text)" }}>{film.title}</p>
                      </ResultsFilmCard>
                    ))}
                  </div>
                </div>
              )}

              {/* Also liked */}
              {remainingFilms.length > 0 && (
                <>
                  <p className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--text-muted)" }}>
                    Also liked
                  </p>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${alsoLikedCols(remainingFilms.length)}, minmax(0, 1fr))` }}>
                    {remainingFilms.map(({ film }, i) => (
                      <ResultsFilmCard key={film.id} film={film} onInfo={setInfoFilm}
                        motionDelay={i * 0.03}
                        className="relative rounded-lg overflow-hidden text-left"
                        style={{ aspectRatio: "2/3", background: "var(--surface)" }}>
                        {film.poster_path ? (
                          <img src={posterUrl(film.poster_path, "w342")} alt={film.title}
                            className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center p-1 text-center"
                            style={{ fontSize: 10, color: "var(--text-muted)" }}>{film.title}</div>
                        )}
                        <div className="absolute inset-0"
                          style={{ background: "linear-gradient(to top, rgba(12,12,14,0.85) 0%, transparent 50%)" }} />
                        <p className="absolute bottom-1.5 left-1.5 right-1.5 leading-tight"
                          style={{ fontSize: 9, color: "var(--text)" }}>{film.title}</p>
                      </ResultsFilmCard>
                    ))}
                  </div>
                </>
              )}

            </>
          )}
        </div>
      )}

      {/* Remove participant confirmation */}
      {confirmRemoveId && session && (() => {
        const target = participants.find(p => p.id === confirmRemoveId);
        if (!target) return null;
        const col = participantColor(target.name);
        return (
          <div className="fixed inset-0 z-40 flex items-center justify-center px-5"
            style={{ background: "rgba(12,12,14,0.6)" }}
            onClick={() => setConfirmRemoveId(null)}>
            <div className="w-full max-w-sm p-4 rounded-2xl" style={{ background: "var(--surface)" }}
              onClick={e => e.stopPropagation()}>
              <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
                Remove <span style={{ color: col }}>{target.name}</span>?
              </p>
              <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
                They can rejoin with a new name.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmRemoveId(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const id = confirmRemoveId;
                    setConfirmRemoveId(null);
                    // Optimistic update — host sees the pill vanish immediately
                    setParticipants(prev => prev.filter(p => p.id !== id));
                    await removeParticipant(session.id, id);
                    // Notify all clients so their pill lists update and the kicked
                    // person sees KickedScreen without relying on postgres_changes DELETE
                    kicksChRef.current?.send({ type: "broadcast", event: "participant_removed", payload: { id } });
                    // Refresh scores with the new (lower) denominator
                    await refreshScoresRef.current?.();
                    // Check if any film now hits the match threshold
                    const matched = await checkAllMatches(session.id, session.threshold);
                    if (matched.length > 0) await resolveMatch(session.id, matched[0]);
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>
                  Remove
                </button>
              </div>
            </div>
          </div>
        );
      })()}


      <FilmInfoOverlay
        film={infoFilm}
        onClose={() => setInfoFilm(null)}
        sessionServices={session?.streaming_services ?? []}
        // Only show the heart for films the user has NEVER swiped on. Previously
        // the guard was `!likedByIds.includes(me)`, which left the heart enabled
        // on films the user had DISLIKED — an accidental tap would upsert
        // dislike → like (ghost like). See #82.
        onLike={infoFilm && session && !mySwiped.has(infoFilm.id) ? async () => {
          logEvent(session.id, myParticipantId, "swipe.write", { source: "results-overlay", film_id: infoFilm.id, liked: true });
          await recordSwipe(session.id, myParticipantId, infoFilm.id, true);
          setMySwiped(prev => new Set(prev).add(infoFilm.id));
        } : undefined}
      />

      {/* Character source film — read-only, no like/dislike */}
      <FilmInfoOverlay
        film={charInfoFilm}
        onClose={() => setCharInfoFilm(null)}
        sessionServices={[]}
      />

      {showShortlist && session && (
        <ShortlistOverlay
          films={scores.map(s => s.film)}
          pinnedFilmIds={tiedFilms.map(s => s.film.id)}
          sessionId={session.id}
          participantId={myParticipantId}
          isHost={isHost}
          totalParticipants={participants.length}
          sessionServices={session.streaming_services ?? []}
          region={session.region ?? "AU"}
          onComplete={async (winnerId) => {
            if (isHost) await closeSession(session.id);
            router.push("/");
          }}
        />
      )}

      {/* ── Shortlist Vote confirmation ──────────────────────────────────── */}
      {showShortlistConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(12,12,14,0.75)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }}>
            <div>
              <p className="text-sm font-semibold mb-1.5" style={{ color: "var(--text)" }}>
                Start a shortlist vote?
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                All films with at least one like will go to a group vote.
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                Live swiping ends.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowShortlistConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowShortlistConfirm(false);
                  resultSlCh.current?.send({ type: "broadcast", event: "shortlist_open", payload: {} });
                  setShowShortlist(true);
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "var(--accent)", color: "#0c0c0e" }}>
                Start Vote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}


function ResultsFilmCard({
  film,
  onInfo,
  motionDelay,
  className,
  style,
  children,
}: {
  film: Film;
  onInfo: (film: Film) => void;
  motionDelay?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { handlers, consumeFired } = useLongPress(() => onInfo(film));
  return (
    <motion.button
      initial={motionDelay !== undefined ? { opacity: 0, y: 10 } : false}
      animate={motionDelay !== undefined ? { opacity: 1, y: 0 } : undefined}
      transition={motionDelay !== undefined ? { delay: motionDelay } : undefined}
      className={className}
      style={style}
      {...handlers}
      onClick={(e) => { if (consumeFired()) { e.preventDefault(); return; } onInfo(film); }}
    >
      {children}
    </motion.button>
  );
}

function LikedByNames({ ids, participants }: { ids: string[]; participants: Participant[] }) {
  if (!ids.length) return null;
  const names = ids
    .map((id) => participants.find((p) => p.id === id)?.name)
    .filter(Boolean) as string[];
  if (!names.length) return null;
  return (
    <p className="text-xs mt-1.5 truncate" style={{ color: "var(--text-muted)" }}>
      {names.join(", ")}
    </p>
  );
}

function ScoreBar({ score, total, highlight = false }: { score: number; total: number; highlight?: boolean }) {
  const pct = total > 0 ? (score / total) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: highlight ? "var(--accent)" : "var(--text-muted)",
          }}
        />
      </div>
      <span className="text-xs shrink-0"
        style={{ color: highlight ? "var(--accent)" : "var(--text-muted)" }}>
        {score}/{total}
      </span>
    </div>
  );
}
