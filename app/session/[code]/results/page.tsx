"use client";

import { useEffect, useState, use, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Trophy, Lock, Clock, Plus, Layers, Info } from "lucide-react";
import { getSession, getParticipantId, getIsHost, getFilmScores, closeSession, getParticipants, recordSwipe, removeParticipant } from "@/lib/session";
import { getCurrentRound } from "@/lib/shortlist";
import { supabase } from "@/lib/supabase";
import { posterUrl } from "@/lib/tmdb";
import { participantColor } from "@/lib/names";
import { Film, Session, Participant } from "@/types";
import Logo from "@/components/Logo";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";
import ShortlistOverlay from "@/components/ShortlistOverlay";

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
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [showShortlist, setShowShortlist] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const resultSlCh = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isHost = getIsHost(code);
  const myParticipantId = getParticipantId(code) ?? "";

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");

      setSession(s);

      const [allScores, allParticipants] = await Promise.all([
        getFilmScores(s.id),
        getParticipants(s.id),
      ]);
      const tiebreakerIds = s.tiebreaker_film_ids?.length ? new Set(s.tiebreaker_film_ids) : null;
      const filtered = allScores
        .filter((fs) => fs.score > 0)
        .filter((fs) => !tiebreakerIds || tiebreakerIds.has(fs.film.id))
        .slice(0, 20);
      setScores(filtered);
      setParticipants(allParticipants);
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
    const ch = supabase
      .channel(`results-sl:${session.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shortlist_rounds",
        filter: `session_id=eq.${session.id}`,
      }, () => setShowShortlist(true))
      .on("broadcast", { event: "shortlist_open" }, () => setShowShortlist(true))
      .subscribe();
    resultSlCh.current = ch;
    return () => { resultSlCh.current = null; supabase.removeChannel(ch); };
  }, [session?.id]);

  async function handleClose() {
    if (!session) return;
    setClosing(true);
    await closeSession(session.id);
    setSession((s) => s ? { ...s, status: "closed" } : s);
    setClosing(false);
  }

  const deadlineDate = session?.deadline ? new Date(session.deadline) : null;
  const isPast = deadlineDate ? deadlineDate < new Date() : false;
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

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
    <div className="flex flex-col h-dvh mx-auto" style={{ maxWidth: 480 }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg"
          style={{ background: "var(--surface)", color: "var(--text-muted)" }}
        >
          <ArrowLeft size={18} />
        </button>
        <Logo size="sm" showText={false} />
        <div className="flex-1">
          <h1 className="text-base font-semibold" style={{ color: "var(--text)" }}>Results</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{code}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push(`/session/${code}/add`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Plus size={18} />
          </button>
          <button onClick={() => router.push(`/session/${code}`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Layers size={18} />
          </button>
          {(() => {
            const isClosed = session?.status === "closed";
            const isLive = session?.started && !isClosed;
            return (
              <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                style={{
                  background: (isLive || isClosed) ? "rgba(74,222,128,0.1)" : "var(--surface)",
                  color: (isLive || isClosed) ? "var(--like)" : "var(--text-muted)",
                }}>
                {isClosed ? <Lock size={11} /> : <Clock size={11} />}
                {isClosed ? "Closed" : isLive ? "Live" : "Waiting"}
              </div>
            );
          })()}
        </div>
      </header>

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
        </div>
      )}

      {!loading && (
        <div className="flex-1 overflow-y-auto px-5 pb-8" style={{ paddingBottom: isHost && scores.length >= 2 && session?.status !== "closed" ? "5rem" : undefined }}>
          {/* Deadline */}
          {session?.mode === "planned" && deadlineDate && (
            <div
              className="mb-5 p-3 rounded-xl flex items-center gap-2 text-sm"
              style={{ background: "var(--surface)", color: isPast ? "var(--like)" : "var(--text-muted)" }}
            >
              {isPast ? <Lock size={14} /> : <Clock size={14} />}
              {isPast
                ? "Deadline passed — these are the final results"
                : `Closes ${deadlineDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
            </div>
          )}

          {/* Participants */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {participants.map((p) => {
              const color = participantColor(p.name);
              const canRemove = isHost && p.id !== myParticipantId;
              return (
                <button key={p.id}
                  onClick={() => canRemove && setConfirmRemoveId(p.id)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{
                    background: `${color}22`, color, border: `1px solid ${color}55`,
                    cursor: canRemove ? "pointer" : "default",
                  }}>
                  {p.name}
                </button>
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
                    <button
                      onClick={() => setInfoFilm(topFilm.film)}
                      className="absolute top-3 right-3 p-1.5 rounded-full"
                      style={{ background: "rgba(0,0,0,0.55)", color: "white" }}
                    >
                      <Info size={14} />
                    </button>
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
                      <button key={film.id} onClick={() => setInfoFilm(film)}
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
                      </button>
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
                      <motion.button
                        key={film.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        onClick={() => setInfoFilm(film)}
                        className="relative rounded-lg overflow-hidden text-left"
                        style={{ aspectRatio: "2/3", background: "var(--surface)" }}
                      >
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
                      </motion.button>
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
          <div className="fixed bottom-0 left-0 right-0 z-40 px-5 pb-8 pt-4"
            style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
            <div className="mx-auto max-w-sm p-4 rounded-2xl" style={{ background: "var(--surface)" }}>
              <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
                Remove <span style={{ color: col }}>{target.name}</span>?
              </p>
              <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
                Their shortlist votes will be voided.
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
                    await removeParticipant(session.id, id);
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

      {/* Shortlist button — pinned, host only, ≥2 liked films */}
      {!loading && isHost && scores.length >= 2 && session?.status !== "closed" && (
        <div className="shrink-0 px-5 pb-6 pt-3 flex justify-center"
          style={{ background: "linear-gradient(to top, var(--bg) 70%, transparent)" }}>
          <button
            onClick={() => {
              resultSlCh.current?.send({
                type: "broadcast", event: "shortlist_open", payload: {},
              });
              setShowShortlist(true);
            }}
            className="py-3.5 rounded-xl text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e", width: "80%" }}
          >
            Shortlist
          </button>
        </div>
      )}

      <FilmInfoOverlay
        film={infoFilm}
        onClose={() => setInfoFilm(null)}
        sessionServices={session?.streaming_services ?? []}
        onLike={infoFilm && !scores.find(s => s.film.id === infoFilm.id)?.likedByIds.includes(myParticipantId) && session ? async () => {
          await recordSwipe(session.id, myParticipantId, infoFilm.id, true);
        } : undefined}
      />

      {showShortlist && session && (
        <ShortlistOverlay
          films={scores.map(s => s.film)}
          pinnedFilmIds={tiedFilms.map(s => s.film.id)}
          sessionId={session.id}
          participantId={myParticipantId}
          isHost={isHost}
          totalParticipants={participants.length}
          onComplete={async (winnerId) => {
            if (isHost) await closeSession(session.id);
            router.push("/");
          }}
        />
      )}
    </div>
    </div>
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
